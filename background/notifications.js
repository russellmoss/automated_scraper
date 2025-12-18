// background/notifications.js - Zapier Webhook Notifications

import { STORAGE_KEYS, CONFIG, LOG_PREFIXES } from '../utils/constants.js';

const LOG = LOG_PREFIXES.NOTIFY;

// ============================================================
// STORAGE
// ============================================================

async function getFromStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => {
            resolve(result);
        });
    });
}

async function saveToStorage(data) {
    return new Promise((resolve) => {
        chrome.storage.local.set(data, resolve);
    });
}

// ============================================================
// WEBHOOK MANAGEMENT
// ============================================================

/**
 * Save webhook URL
 * @param {string} url - Zapier webhook URL
 */
export async function setWebhookUrl(url) {
    await saveToStorage({ [STORAGE_KEYS.WEBHOOK_URL]: url });
    console.log(`${LOG} Webhook URL saved`);
}

/**
 * Get saved webhook URL
 * @returns {Promise<string|null>}
 */
export async function getWebhookUrl() {
    const result = await getFromStorage([STORAGE_KEYS.WEBHOOK_URL]);
    return result[STORAGE_KEYS.WEBHOOK_URL] || null;
}

// ============================================================
// NOTIFICATION SENDING
// ============================================================

/**
 * Generate human-readable message for notification type
 */
function generateMessage(type, data) {
    const messages = {
        'schedule_started': `🚀 Scheduled scrape started for ${data.sourceName}`,
        'schedule_completed': `✅ Scheduled scrape completed for ${data.sourceName}: ${data.profilesScraped || 0} profiles scraped`,
        'schedule_failed': `❌ Scheduled scrape FAILED for ${data.sourceName}: ${data.error || 'Unknown error'}`,
        'scrape_complete': `📊 Scrape complete: ${data.profilesScraped || 0} profiles from ${data.sourceName}`,
        'scrape_failed': `❌ Scrape failed for "${data.personName}" in search "${data.searchName}": ${data.failureType || 'Unknown'} - ${data.error || 'Unknown error'}`,
        'new_connections': `🆕 Found ${data.newConnections || 0} new connections for ${data.sourceName}`,
        'error': `🚨 ERROR: ${data.error || 'Unknown error'}`,
        'test': '🧪 Test notification from Savvy Pirate - webhook is working!',

        // Auth monitoring
        'auth_linkedin_signout': `🔐 LINKEDIN SIGNED OUT - Manual login required. ${data.details || ''}`.trim(),
        'auth_linkedin_checkpoint': `⚠️ LINKEDIN SECURITY CHALLENGE - Manual intervention required. ${data.details || ''}`.trim(),
        'auth_google_expired': `🔑 GOOGLE AUTH REQUIRED - Re-authentication required. ${data.details || ''}`.trim()
    };
    
    return messages[type] || `Notification: ${type}`;
}

// ============================================================
// AUTH NOTIFICATION RATE LIMITING (PERSISTED)
// ============================================================

const AUTH_NOTIFICATION_TYPES = new Set([
    'auth_linkedin_signout',
    'auth_linkedin_checkpoint',
    'auth_google_expired'
]);

const AUTH_NOTIFICATION_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

async function getAuthLastSentMap() {
    const stored = await getFromStorage([STORAGE_KEYS.NOTIFICATION_SETTINGS]);
    const settings = stored[STORAGE_KEYS.NOTIFICATION_SETTINGS] || {};
    return settings.authLastSent || {};
}

async function setAuthLastSent(type, isoTimestamp) {
    const stored = await getFromStorage([STORAGE_KEYS.NOTIFICATION_SETTINGS]);
    const settings = stored[STORAGE_KEYS.NOTIFICATION_SETTINGS] || {};
    const authLastSent = settings.authLastSent || {};
    authLastSent[type] = isoTimestamp;
    await saveToStorage({
        [STORAGE_KEYS.NOTIFICATION_SETTINGS]: {
            ...settings,
            authLastSent
        }
    });
}

async function shouldSendAuthNotification(type) {
    if (!AUTH_NOTIFICATION_TYPES.has(type)) return true;

    const lastMap = await getAuthLastSentMap();
    const lastIso = lastMap[type];
    if (!lastIso) return true;

    const lastMs = Date.parse(lastIso);
    if (!Number.isFinite(lastMs)) return true;

    const now = Date.now();
    if (now - lastMs < AUTH_NOTIFICATION_COOLDOWN_MS) {
        console.log(`${LOG} Skipping ${type} notification (cooldown active)`);
        return false;
    }
    return true;
}

// ============================================================
// PAYLOAD VALIDATION
// ============================================================

/**
 * Validate payload structure matches Zapier catch hook expectations
 * Zapier catch hooks accept any JSON, but we validate to ensure correct structure
 * @param {string} type - Notification type
 * @param {Object} payload - Payload to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateZapierPayload(type, payload) {
    const errors = [];
    
    // Required top-level fields
    if (!payload.type || typeof payload.type !== 'string') {
        errors.push('Missing or invalid "type" field (must be string)');
    }
    
    if (!payload.timestamp || typeof payload.timestamp !== 'string') {
        errors.push('Missing or invalid "timestamp" field (must be ISO string)');
    } else {
        // Validate ISO timestamp format
        if (!payload.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
            errors.push('Invalid timestamp format (must be ISO 8601)');
        }
    }
    
    if (!payload.source || typeof payload.source !== 'string') {
        errors.push('Missing or invalid "source" field (must be string)');
    }
    
    if (!payload.data || typeof payload.data !== 'object') {
        errors.push('Missing or invalid "data" field (must be object)');
    } else {
        // Validate data structure based on type
        const { data } = payload;
        
        if (!data.message || typeof data.message !== 'string') {
            errors.push('Missing or invalid "data.message" field (must be string)');
        }
        
        // Type-specific validations
        switch (type) {
            case 'scrape_failed':
                if (!data.personName || typeof data.personName !== 'string') {
                    errors.push('scrape_failed: Missing "data.personName" (must be string)');
                }
                if (!data.searchName || typeof data.searchName !== 'string') {
                    errors.push('scrape_failed: Missing "data.searchName" (must be string)');
                }
                if (!data.failureType || typeof data.failureType !== 'string') {
                    errors.push('scrape_failed: Missing "data.failureType" (must be string)');
                }
                if (!data.error || typeof data.error !== 'string') {
                    errors.push('scrape_failed: Missing "data.error" (must be string)');
                }
                if (!data.timestamp || typeof data.timestamp !== 'string') {
                    errors.push('scrape_failed: Missing "data.timestamp" (must be ISO string)');
                }
                break;
                
            case 'schedule_started':
            case 'schedule_completed':
            case 'schedule_failed':
                if (!data.sourceName || typeof data.sourceName !== 'string') {
                    errors.push(`${type}: Missing "data.sourceName" (must be string)`);
                }
                break;
                
            case 'schedule_completed':
                if (data.profilesScraped !== undefined && typeof data.profilesScraped !== 'number') {
                    errors.push('schedule_completed: "data.profilesScraped" must be number');
                }
                break;
                
            case 'new_connections':
                if (data.newConnections !== undefined && typeof data.newConnections !== 'number') {
                    errors.push('new_connections: "data.newConnections" must be number');
                }
                break;
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Send notification via Zapier webhook
 * @param {string} type - Notification type
 * @param {Object} data - Notification data
 * @returns {Promise<boolean>} Success
 */
export async function sendNotification(type, data = {}) {
    try {
        const webhookUrl = await getWebhookUrl();
        
        if (!webhookUrl) {
            console.log(`${LOG} No webhook URL configured, skipping notification`);
            return false;
        }
        
        // Determine category for easier Zapier filtering
        const errorTypes = [
            'schedule_failed',
            'scrape_failed',
            'error',
            // Auth monitoring
            'auth_linkedin_signout',
            'auth_linkedin_checkpoint',
            'auth_google_expired'
        ];
        const statusTypes = ['schedule_started', 'schedule_completed', 'new_connections', 'scrape_complete'];
        const category = errorTypes.includes(type) ? 'error' : statusTypes.includes(type) ? 'status' : 'other';
        
        const payload = {
            type,
            category, // 'error', 'status', or 'other' - for easy Zapier filtering
            timestamp: new Date().toISOString(),
            source: 'Savvy Pirate v2.0',
            data: {
                message: generateMessage(type, data),
                ...data
            }
        };
        
        // Validate payload structure
        const validation = validateZapierPayload(type, payload);
        if (!validation.valid) {
            console.warn(`${LOG} ⚠️ Payload validation failed for ${type}:`, validation.errors);
            // Continue anyway, but log the issues for debugging
        }
        
        console.log(`${LOG} Sending ${type} notification...`);
        
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.WEBHOOK_TIMEOUT_MS);
        
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            
            clearTimeout(timeout);
            
            if (response.ok) {
                console.log(`${LOG} ✅ Notification sent: ${type}`);
                return true;
            } else {
                console.error(`${LOG} Webhook returned ${response.status}`);
                return false;
            }
        } catch (fetchError) {
            clearTimeout(timeout);
            if (fetchError.name === 'AbortError') {
                console.error(`${LOG} Webhook timeout after ${CONFIG.WEBHOOK_TIMEOUT_MS}ms`);
            } else {
                console.error(`${LOG} Webhook error:`, fetchError.message);
            }
            return false;
        }
        
    } catch (error) {
        console.error(`${LOG} Notification error:`, error.message);
        return false;
    }
}

/**
 * Send test notification to verify webhook
 * Sends a realistic schedule_started notification for Taylor Matthews to test Zapier logic
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function testWebhook() {
    const webhookUrl = await getWebhookUrl();
    
    if (!webhookUrl) {
        return { success: false, error: 'No webhook URL configured' };
    }
    
    // Send a realistic schedule_started notification for Taylor Matthews
    // This matches the format that would be sent when a scheduled scrape starts
    // This allows testing the Zapier filter logic for status notifications
    const success = await notifyScheduleStarted(
        'Taylor Matthews',  // Connection Source name from Input Sheet (column A)
        9  // Example total searches (you mentioned about 9 searches)
    );
    
    return { success, error: success ? null : 'Webhook request failed' };
}

// ============================================================
// CONVENIENCE METHODS
// ============================================================

export async function notifyScheduleStarted(sourceName, totalSearches) {
    return sendNotification('schedule_started', {
        sourceName,
        totalSearches
    });
}

export async function notifyScheduleCompleted(sourceName, profilesScraped, searchesCompleted) {
    return sendNotification('schedule_completed', {
        sourceName,
        profilesScraped,
        searchesCompleted
    });
}

export async function notifyScheduleFailed(sourceName, error) {
    return sendNotification('schedule_failed', {
        sourceName,
        error: error?.message || String(error)
    });
}

export async function notifyNewConnections(sourceName, newConnections, outputTab) {
    return sendNotification('new_connections', {
        sourceName,
        newConnections,
        outputTab
    });
}

export async function notifyError(error, context = {}) {
    return sendNotification('error', {
        error: error?.message || String(error),
        sourceName: context.sourceName || 'Unknown Source', // Connection Source from Input Sheet
        ...context
    });
}

/**
 * Notify when a scrape fails for a specific person
 * @param {string} personName - Name of the person being scraped
 * @param {string} searchName - Name of the search being run
 * @param {string} failureType - Type of failure (e.g., 'selector_error', 'network_error', 'timeout', 'parse_error')
 * @param {string|Error} error - Error message or Error object
 * @param {Object} additionalContext - Additional context (optional)
 * 
 * USAGE EXAMPLE:
 * When scraping fails for a person, call this function to send a webhook notification:
 * 
 * ```javascript
 * try {
 *     const profileData = extractProfileData(card);
 *     if (!profileData) throw new Error('Failed to extract profile data');
 * } catch (error) {
 *     let failureType = 'parse_error';
 *     if (error.message.includes('selector')) failureType = 'selector_error';
 *     if (error.message.includes('timeout')) failureType = 'timeout_error';
 *     if (error.message.includes('network')) failureType = 'network_error';
 *     
 *     await notifyScrapeFailed(
 *         profileData?.name || 'Unknown Person',
 *         currentSearch?.title || 'Unknown Search',
 *         failureType,
 *         error
 *     );
 * }
 * ```
 * 
 * The webhook payload will include:
 * - timestamp: ISO timestamp of failure
 * - personName: Name of person being scraped
 * - searchName: Name of search being run
 * - failureType: Type of failure (selector_error, network_error, timeout, parse_error, etc.)
 * - error: Error message
 */
export async function notifyScrapeFailed(personName, searchName, failureType, error, additionalContext = {}) {
    return sendNotification('scrape_failed', {
        personName: personName || 'Unknown',
        searchName: searchName || 'Unknown',
        failureType: failureType || 'unknown',
        error: error?.message || String(error || 'Unknown error'),
        timestamp: new Date().toISOString(),
        sourceName: additionalContext.sourceName || 'Unknown Source', // Connection Source from Input Sheet
        ...additionalContext
    });
}

// ============================================================
// AUTH ALERT CONVENIENCE METHODS
// ============================================================

export async function notifyLinkedInSignedOut(details, sourceName = null) {
    const type = 'auth_linkedin_signout';
    if (!(await shouldSendAuthNotification(type))) return false;

    const success = await sendNotification(type, {
        sourceName: sourceName || 'N/A',
        details: details || 'LinkedIn appears to be signed out',
        requiresAction: 'Log into LinkedIn in the Pi browser',
        detectedAt: new Date().toISOString()
    });

    if (success) {
        await setAuthLastSent(type, new Date().toISOString());
    }
    return success;
}

export async function notifyLinkedInCheckpoint(details, sourceName = null) {
    const type = 'auth_linkedin_checkpoint';
    if (!(await shouldSendAuthNotification(type))) return false;

    const success = await sendNotification(type, {
        sourceName: sourceName || 'N/A',
        details: details || 'LinkedIn security checkpoint/CAPTCHA detected',
        requiresAction: 'Complete the LinkedIn security challenge in the Pi browser',
        detectedAt: new Date().toISOString()
    });

    if (success) {
        await setAuthLastSent(type, new Date().toISOString());
    }
    return success;
}

export async function notifyGoogleAuthExpired(details, sourceName = null) {
    const type = 'auth_google_expired';
    if (!(await shouldSendAuthNotification(type))) return false;

    const success = await sendNotification(type, {
        sourceName: sourceName || 'N/A',
        details: details || 'Google OAuth token expired or requires re-auth',
        requiresAction: 'Re-authenticate Google in the Pi browser (Chrome identity)',
        detectedAt: new Date().toISOString()
    });

    if (success) {
        await setAuthLastSent(type, new Date().toISOString());
    }
    return success;
}

