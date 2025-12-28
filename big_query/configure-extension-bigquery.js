/**
 * Configuration Script for Chrome Extension BigQuery Integration
 * 
 * Run this in the Chrome Extension service worker console:
 * 1. Go to chrome://extensions
 * 2. Find "Savvy Pirate" extension
 * 3. Click "service worker" (or "Inspect views: service worker")
 * 4. Paste this entire script into the console
 * 5. Press Enter
 */

(async function configureBigQuery() {
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec';
    
    try {
        // Save configuration
        await chrome.storage.local.set({
            bigquery_config: {
                appsScriptWebAppUrl: APPS_SCRIPT_URL,
                configured_at: new Date().toISOString(),
                type: 'apps_script'
            }
        });
        
        console.log('✅ BigQuery configuration saved!');
        console.log('URL:', APPS_SCRIPT_URL);
        
        // Test the connection
        console.log('\n🧪 Testing connection...');
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'test_connection', data: {} })
        });
        
        const result = await response.json();
        if (result.success) {
            console.log('✅ Connection test successful!');
            console.log('Message:', result.message);
            console.log('Project:', result.project);
        } else {
            console.error('❌ Connection test failed:', result);
        }
        
        // Verify config was saved
        const stored = await chrome.storage.local.get(['bigquery_config']);
        console.log('\n📋 Stored configuration:');
        console.log(JSON.stringify(stored.bigquery_config, null, 2));
        
        console.log('\n✅ Configuration complete! The extension will now sync to BigQuery.');
        console.log('💡 Reload the extension to ensure the config is loaded on startup.');
        
    } catch (error) {
        console.error('❌ Configuration failed:', error);
    }
})();

