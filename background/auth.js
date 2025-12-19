// background/auth.js - Service Account Authentication for Google APIs
// Replaces chrome.identity OAuth with service account JWT authentication

const LOG = '[AUTH]';
const STORAGE_KEY = 'serviceAccountCredentials';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file'
].join(' ');

// In-memory token cache
let cachedToken = null;
let tokenExpiry = null;

/**
 * Store service account credentials in chrome.storage.local
 * Call this once during setup with the contents of your JSON key file
 * @param {Object|string} jsonKeyContent - The service account JSON key (parsed object or string)
 */
export async function setupServiceAccount(jsonKeyContent) {
    const credentials = typeof jsonKeyContent === 'string' 
        ? JSON.parse(jsonKeyContent) 
        : jsonKeyContent;
    
    // Validate required fields
    const required = ['client_email', 'private_key', 'token_uri'];
    for (const field of required) {
        if (!credentials[field]) {
            throw new Error(`Service account JSON missing required field: ${field}`);
        }
    }
    
    await chrome.storage.local.set({ [STORAGE_KEY]: credentials });
    console.log(`${LOG} Service account credentials stored for: ${credentials.client_email}`);
    
    // Clear any cached token so next request uses new credentials
    cachedToken = null;
    tokenExpiry = null;
    
    return true;
}

/**
 * Check if service account is configured
 * @returns {Promise<boolean>}
 */
export async function isServiceAccountConfigured() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return !!(result[STORAGE_KEY]?.client_email && result[STORAGE_KEY]?.private_key);
}

/**
 * Get stored service account credentials
 * @returns {Promise<Object>}
 */
async function getCredentials() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (!result[STORAGE_KEY]) {
        throw new Error('Service account not configured. Call setupServiceAccount() first.');
    }
    return result[STORAGE_KEY];
}

/**
 * Convert a PEM private key to CryptoKey for signing
 * @param {string} pem - PEM formatted private key
 * @returns {Promise<CryptoKey>}
 */
async function importPrivateKey(pem) {
    // Remove PEM header/footer and newlines
    const pemContents = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s/g, '');
    
    // Decode base64 to ArrayBuffer
    const binaryString = atob(pemContents);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Import as CryptoKey
    return crypto.subtle.importKey(
        'pkcs8',
        bytes.buffer,
        {
            name: 'RSASSA-PKCS1-v1_5',
            hash: 'SHA-256'
        },
        false,
        ['sign']
    );
}

/**
 * Base64URL encode (URL-safe base64 without padding)
 * @param {ArrayBuffer|Uint8Array|string} data
 * @returns {string}
 */
function base64UrlEncode(data) {
    let base64;
    if (typeof data === 'string') {
        base64 = btoa(data);
    } else {
        const bytes = new Uint8Array(data);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        base64 = btoa(binary);
    }
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Create and sign a JWT for Google OAuth
 * @param {Object} credentials - Service account credentials
 * @returns {Promise<string>} Signed JWT
 */
async function createSignedJwt(credentials) {
    const now = Math.floor(Date.now() / 1000);
    
    const header = {
        alg: 'RS256',
        typ: 'JWT'
    };
    
    const payload = {
        iss: credentials.client_email,
        scope: SCOPES,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600 // 1 hour
    };
    
    const encodedHeader = base64UrlEncode(JSON.stringify(header));
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    
    // Sign with private key
    const privateKey = await importPrivateKey(credentials.private_key);
    const signatureBuffer = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        privateKey,
        new TextEncoder().encode(signatureInput)
    );
    
    const encodedSignature = base64UrlEncode(signatureBuffer);
    
    return `${signatureInput}.${encodedSignature}`;
}

/**
 * Exchange JWT for access token
 * @param {string} jwt - Signed JWT
 * @returns {Promise<{access_token: string, expires_in: number}>}
 */
async function exchangeJwtForToken(jwt) {
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`${LOG} Token exchange failed:`, errorText);
        throw new Error(`Token exchange failed: ${response.status} - ${errorText}`);
    }
    
    return response.json();
}

/**
 * Get OAuth access token (main export - maintains same signature as before)
 * @param {boolean} interactive - Ignored for service accounts (kept for API compatibility)
 * @returns {Promise<string>} Access token
 */
export async function getAuthToken(interactive = false) {
    // Check if we have a valid cached token (with 5 min buffer)
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 300000) {
        console.log(`${LOG} Using cached token (expires in ${Math.round((tokenExpiry - Date.now()) / 60000)} min)`);
        return cachedToken;
    }
    
    console.log(`${LOG} Fetching new access token via service account...`);
    
    const credentials = await getCredentials();
    const jwt = await createSignedJwt(credentials);
    const tokenResponse = await exchangeJwtForToken(jwt);
    
    // Cache the token
    cachedToken = tokenResponse.access_token;
    tokenExpiry = Date.now() + (tokenResponse.expires_in * 1000);
    
    console.log(`${LOG} Token obtained successfully (expires in ${tokenResponse.expires_in}s)`);
    return cachedToken;
}

/**
 * Remove cached token (for API compatibility)
 * @param {string} token - Token to remove (ignored, just clears cache)
 */
export async function removeCachedToken(token) {
    console.log(`${LOG} Clearing cached token`);
    cachedToken = null;
    tokenExpiry = null;
}

/**
 * Get service account email (useful for debugging)
 * @returns {Promise<string|null>}
 */
export async function getServiceAccountEmail() {
    try {
        const credentials = await getCredentials();
        return credentials.client_email;
    } catch {
        return null;
    }
}

// Legacy exports for compatibility (no longer used but kept to avoid breaking imports)
export async function setupTokenRefreshAlarm() {
    console.log(`${LOG} Token refresh alarm not needed for service accounts (tokens auto-refresh on demand)`);
}

export async function refreshTokenIfNeeded() {
    // Service accounts refresh tokens automatically when needed
    return cachedToken;
}

export async function ensureFreshToken() {
    // Just get a token (will refresh if needed)
    return await getAuthToken(false);
}
