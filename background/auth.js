// background/auth.js - OAuth Token Management

/**
 * Get OAuth token from Chrome Identity API
 * @param {boolean} interactive - Whether to show sign-in prompt
 * @returns {Promise<string>} OAuth access token
 */
export async function getAuthToken(interactive = false) {
    return new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
            if (chrome.runtime.lastError) {
                console.error('[AUTH] Token error:', chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
            } else if (!token) {
                reject(new Error('No token received'));
            } else {
                console.log('[AUTH] Token obtained successfully');
                resolve(token);
            }
        });
    });
}

/**
 * Remove cached token (call when token is invalid/expired)
 * @param {string} token - Token to remove
 * @returns {Promise<void>}
 */
export async function removeCachedToken(token) {
    return new Promise((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => {
            console.log('[AUTH] Cached token removed');
            resolve();
        });
    });
}

