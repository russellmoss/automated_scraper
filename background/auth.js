// background/auth.js - OAuth Token Management (Chromium-safe)
//
// Why this exists:
// - On some Chromium/Linux (incl. common Raspberry Pi builds), `chrome.identity.getAuthToken()`
//   can fail with "The user is not signed in." even after Google login.
// - `launchWebAuthFlow` works reliably with a "Web application" OAuth client + redirect URI:
//   https://<EXTENSION_ID>.chromiumapp.org/

const LOG = '[AUTH]';
const TOKEN_STORAGE_KEY = 'oauth_access_token';
const TOKEN_EXPIRY_KEY = 'oauth_token_expiry';

async function getCachedToken() {
    const result = await chrome.storage.local.get([TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY]);
    const token = result[TOKEN_STORAGE_KEY];
    const expiry = result[TOKEN_EXPIRY_KEY];

    if (token && expiry && Date.now() < expiry) {
        return token;
    }
    return null;
}

async function launchWebAuthFlowAuth() {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2?.client_id;
    if (!clientId) {
        throw new Error('No OAuth client_id in manifest.oauth2');
    }

    const redirectUri = chrome.identity.getRedirectURL();
    const scopes = Array.isArray(manifest.oauth2?.scopes) && manifest.oauth2.scopes.length > 0
        ? manifest.oauth2.scopes.join(' ')
        : 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('prompt', 'consent');

    console.log(`${LOG} Starting launchWebAuthFlow...`);
    console.log(`${LOG} Redirect URI: ${redirectUri}`);

    const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow(
            { url: authUrl.toString(), interactive: true },
            (url) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (!url) {
                    reject(new Error('No response URL from launchWebAuthFlow'));
                    return;
                }
                resolve(url);
            }
        );
    });

    const url = new URL(responseUrl);
    const params = new URLSearchParams(url.hash?.startsWith('#') ? url.hash.substring(1) : url.hash);
    const accessToken = params.get('access_token');
    const expiresIn = params.get('expires_in');

    if (!accessToken) {
        throw new Error('No access_token in OAuth response');
    }

    // Store token with a small safety buffer (60s)
    const expiry = Date.now() + (parseInt(expiresIn || '3600', 10) * 1000) - 60000;
    await chrome.storage.local.set({
        [TOKEN_STORAGE_KEY]: accessToken,
        [TOKEN_EXPIRY_KEY]: expiry
    });

    console.log(`${LOG} Token obtained, expires in ${expiresIn || '3600'}s`);
    return accessToken;
}

/**
 * Get OAuth access token.
 * - If cached token exists and is valid, returns it.
 * - If interactive=false and no cached token, throws.
 * - If interactive=true and no cached token, runs OAuth flow via launchWebAuthFlow.
 */
export async function getAuthToken(interactive = false) {
    const cached = await getCachedToken();
    if (cached) {
        console.log(`${LOG} Using cached token`);
        return cached;
    }

    if (!interactive) {
        throw new Error('No cached token and interactive=false');
    }

    return await launchWebAuthFlowAuth();
}

/**
 * Remove cached token (call when token is invalid/expired).
 * @param {string} token - (ignored) kept for backward compatibility
 */
export async function removeCachedToken(token) {
    await chrome.storage.local.remove([TOKEN_STORAGE_KEY, TOKEN_EXPIRY_KEY]);
    console.log(`${LOG} Token cache cleared`);
}

