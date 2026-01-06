// background/device_id.js
// Device identification utility for multi-device isolation

const DEVICE_ID_KEY = 'deviceId';
const LOG = '[DEVICE]';

/**
 * Detect platform from user agent
 * @returns {string} Platform identifier
 */
function detectPlatform() {
    const ua = navigator.userAgent;
    
    if (ua.includes('CrOS')) return 'pi';      // ChromeOS/Chromium on Pi
    if (ua.includes('Windows')) return 'win';   // Windows
    if (ua.includes('Mac')) return 'mac';       // macOS
    if (ua.includes('Linux')) return 'linux';   // Linux (non-ChromeOS)
    
    return 'dev';  // Unknown/development
}

/**
 * Generate a unique device identifier
 * Format: {platform}-{random4chars}
 * Example: "pi-a3f2", "win-b7c1"
 * @returns {string} New device ID
 */
function generateDeviceId() {
    const platform = detectPlatform();
    const randomPart = Math.random().toString(36).substring(2, 6);
    return `${platform}-${randomPart}`;
}

/**
 * Get or create the device ID
 * - Returns existing ID if already generated
 * - Creates and persists new ID if first run
 * @returns {Promise<string>} The device ID
 */
async function getDeviceId() {
    try {
        const result = await chrome.storage.local.get([DEVICE_ID_KEY]);
        
        if (result[DEVICE_ID_KEY]) {
            console.log(`${LOG} Using existing device ID: ${result[DEVICE_ID_KEY]}`);
            return result[DEVICE_ID_KEY];
        }
        
        // Generate new device ID
        const newId = generateDeviceId();
        await chrome.storage.local.set({ [DEVICE_ID_KEY]: newId });
        
        console.log(`${LOG} ✅ Generated new device ID: ${newId}`);
        console.log(`${LOG}    Platform detected: ${detectPlatform()}`);
        console.log(`${LOG}    User agent: ${navigator.userAgent.substring(0, 80)}...`);
        
        return newId;
        
    } catch (error) {
        console.error(`${LOG} ❌ Error getting device ID:`, error);
        // Return a temporary ID if storage fails
        const tempId = `temp-${Math.random().toString(36).substring(2, 6)}`;
        console.warn(`${LOG} Using temporary ID: ${tempId}`);
        return tempId;
    }
}

/**
 * Get device info for logging/debugging
 * @returns {object} Device information
 */
function getDeviceInfo() {
    return {
        platform: detectPlatform(),
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString()
    };
}

export { getDeviceId, getDeviceInfo, detectPlatform };
