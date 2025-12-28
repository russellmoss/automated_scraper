(async function configureBigQuery() {
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyLyTEijCY6DZTMw-9u6gxTnd9LqNvWlnUAQWzHyDzgD0n7WllJ8zIdFIlPR_p-h_rx/exec';
    
    try {
        await chrome.storage.local.set({
            bigquery_config: {
                appsScriptWebAppUrl: APPS_SCRIPT_URL,
                configured_at: new Date().toISOString(),
                type: 'apps_script'
            }
        });
        
        console.log('✅ BigQuery configuration saved!');
        
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'test_connection', data: {} })
        });
        
        const result = await response.json();
        console.log(result.success ? '✅ Connection test successful!' : '❌ Connection failed:', result);
        console.log('📋 Config:', await chrome.storage.local.get(['bigquery_config']));
        
    } catch (error) {
        console.error('❌ Configuration failed:', error);
    }
})();