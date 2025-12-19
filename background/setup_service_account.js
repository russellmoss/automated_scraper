// background/setup_service_account.js
// Run this once to load service account credentials into chrome.storage.local
// Usage: import and call initializeServiceAccount() from service_worker.js or popup

import { setupServiceAccount, isServiceAccountConfigured, getServiceAccountEmail } from './auth.js';

/**
 * Initialize service account from a JSON string
 * Call this from the popup or service worker with the contents of your JSON key file
 */
export async function initializeServiceAccount(jsonString) {
    try {
        await setupServiceAccount(jsonString);
        const email = await getServiceAccountEmail();
        console.log('[SETUP] Service account configured:', email);
        return { success: true, email };
    } catch (error) {
        console.error('[SETUP] Failed to configure service account:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Check current service account status
 */
export async function checkServiceAccountStatus() {
    const configured = await isServiceAccountConfigured();
    const email = configured ? await getServiceAccountEmail() : null;
    return { configured, email };
}

