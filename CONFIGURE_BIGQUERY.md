# Configure Chrome Extension for BigQuery Sync

## Quick Configuration (5 minutes)

### Step 1: Open Service Worker Console

1. Open Chrome and go to: `chrome://extensions`
2. Find **"Savvy Pirate"** extension
3. Click **"service worker"** link (or "Inspect views: service worker")
   - This opens the DevTools console for the service worker

### Step 2: Paste Configuration Script

Copy and paste this **entire script** into the service worker console:

```javascript
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
        
        console.log('\n✅ Configuration complete!');
        console.log('💡 Reload the extension to ensure the config is loaded on startup.');
        
    } catch (error) {
        console.error('❌ Configuration failed:', error);
    }
})();
```

### Step 3: Verify Output

You should see:
- ✅ BigQuery configuration saved!
- ✅ Connection test successful!
- 📋 Stored configuration with your URL

### Step 4: Reload Extension

1. Go back to `chrome://extensions`
2. Click the **reload icon** (circular arrow) on the Savvy Pirate extension
3. This ensures the new BigQuery sync code is loaded

### Step 5: Verify on Startup

1. Open the service worker console again (after reload)
2. You should see in the console:
   ```
   [SERVICE_WORKER] ✅ Service worker initialized
   [SERVICE_WORKER]    BigQuery: ✅ Configured
   [BIGQUERY] ✅ Config loaded: https://script.google.com/macros/s/...
   ```

## Testing the Integration

### Run a Test Scrape

1. Perform a manual scrape or wait for a scheduled one
2. Watch the service worker console for:
   ```
   [BIGQUERY] Syncing X profiles for [Recruiter Name]...
   [BIGQUERY] ✅ Sync complete: X synced, 0 errors
   ```

### Verify in BigQuery

Run this query in BigQuery Console:

```sql
-- Check if profiles were synced
SELECT 
    COUNT(*) as advisor_count, 
    MAX(last_seen_at) as latest_sync,
    COUNT(DISTINCT linkedin_url) as unique_profiles
FROM `savvy-gtm-analytics.savvy_pirate.advisors`;

-- Check connections
SELECT 
    COUNT(*) as connection_count, 
    MAX(last_seen_date) as latest_connection,
    COUNT(DISTINCT recruiter_id) as recruiters_with_connections
FROM `savvy-gtm-analytics.savvy_pirate.connections`;
```

## Troubleshooting

### "Apps Script Web App URL not configured"
- Run the configuration script again
- Check that the URL was saved: `chrome.storage.local.get(['bigquery_config'])`

### "Connection test failed"
- Verify Apps Script is deployed and accessible
- Check the URL is correct
- Try opening the URL in a browser (should return JSON)

### No BigQuery sync messages in console
- Ensure extension was reloaded after configuration
- Check service worker console (not regular page console)
- Verify `isConfigured()` returns true

### Data not appearing in BigQuery
- Check service worker console for error messages
- Verify BigQuery permissions for Apps Script
- Check Apps Script execution logs (View → Executions in Apps Script editor)

