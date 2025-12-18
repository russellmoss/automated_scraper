// ============================================================
// POPUP.JS ADDITIONS FOR LIVE SHEET SYNC
// Add these modifications to your existing popup/popup.js
// ============================================================


// ============================================================
// STEP 1: ADD TO STATE OBJECT
// ============================================================
/*
let state = {
    // ... existing state ...
    
    // NEW: Workbook config
    workbookConfig: null,
};
*/


// ============================================================
// STEP 2: ADD TO cacheElements() FUNCTION
// (Add these to your existing elements object)
// ============================================================
/*
function cacheElements() {
    // ... existing element caching ...
    
    // NEW: Workbook sync elements
    elements.workbookUrl = document.getElementById('workbook-url');
    elements.loadWorkbookBtn = document.getElementById('load-workbook-btn');
    elements.workbookHelp = document.getElementById('workbook-help');
    elements.syncStatusContainer = document.getElementById('sync-status-container');
    elements.workbookLink = document.getElementById('workbook-link');
    elements.syncNowBtn = document.getElementById('sync-now-btn');
    elements.clearWorkbookBtn = document.getElementById('clear-workbook-btn');
    elements.connectionCount = document.getElementById('connection-count');
    elements.searchCount = document.getElementById('search-count');
    elements.scheduleCount = document.getElementById('schedule-count');
    elements.syncStatusText = document.getElementById('sync-status-text');
    elements.lastSyncTime = document.getElementById('last-sync-time');
    elements.syncChanges = document.getElementById('sync-changes');
    elements.changesList = document.getElementById('changes-list');
    elements.unmappedWarning = document.getElementById('unmapped-warning');
    elements.unmappedCount = document.getElementById('unmapped-count');
    elements.syncSettings = document.getElementById('sync-settings');
    elements.syncIntervalSelect = document.getElementById('sync-interval-select');
    elements.nextSyncTime = document.getElementById('next-sync-time');
}
*/


// ============================================================
// STEP 3: ADD TO setupEventListeners() FUNCTION
// ============================================================
/*
function setupEventListeners() {
    // ... existing event listeners ...
    
    // NEW: Workbook sync event listeners
    elements.loadWorkbookBtn?.addEventListener('click', loadWorkbook);
    elements.syncNowBtn?.addEventListener('click', syncWorkbookNow);
    elements.clearWorkbookBtn?.addEventListener('click', clearWorkbook);
    elements.syncIntervalSelect?.addEventListener('change', updateSyncInterval);
    
    // Allow Enter key to load workbook
    elements.workbookUrl?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            loadWorkbook();
        }
    });
}
*/


// ============================================================
// STEP 4: ADD THESE NEW FUNCTIONS
// ============================================================

/**
 * Load workbook configuration
 */
async function loadWorkbook() {
    const url = elements.workbookUrl?.value?.trim();
    if (!url) {
        showToast('Please enter a workbook URL', 'error');
        return;
    }
    
    setButtonLoading(elements.loadWorkbookBtn, true);
    
    try {
        const result = await sendMessage('LOAD_WORKBOOK', { workbookUrl: url });
        
        if (result.success && result.config) {
            state.workbookConfig = result.config;
            renderWorkbookStatus(result.config);
            
            // Refresh searches for source dropdown compatibility
            await refreshSearchesFromConfig(result.config);
            
            // Hide help text, show sync settings
            elements.workbookHelp?.classList.add('hidden');
            
            showToast(result.message || 'Workbook loaded successfully', 'success');
            
            // Clear any badge notification
            try {
                chrome.action?.setBadgeText?.({ text: '' });
            } catch (e) {}
        } else {
            showToast(result.error || 'Failed to load workbook', 'error');
        }
    } catch (error) {
        console.error(`${LOG} Load workbook error:`, error);
        showToast(error.message || 'Failed to load workbook', 'error');
    } finally {
        setButtonLoading(elements.loadWorkbookBtn, false);
    }
}

/**
 * Sync workbook now (manual trigger)
 */
async function syncWorkbookNow() {
    if (!elements.syncNowBtn) return;
    
    // Visual feedback
    const originalText = elements.syncNowBtn.textContent;
    elements.syncNowBtn.textContent = '⏳';
    elements.syncNowBtn.disabled = true;
    
    try {
        const result = await sendMessage('SYNC_WORKBOOK');
        
        if (result.success && result.synced && result.config) {
            state.workbookConfig = result.config;
            renderWorkbookStatus(result.config, result.changes);
            
            // Refresh searches
            await refreshSearchesFromConfig(result.config);
            
            if (result.changes?.length > 0) {
                showToast(`Synced: ${result.changes.length} change(s) detected`, 'success');
            } else {
                showToast('Synced: No changes', 'info');
            }
        } else if (result.error) {
            showToast(`Sync failed: ${result.error}`, 'error');
        } else {
            showToast('Sync completed', 'info');
        }
        
        // Clear badge
        try {
            chrome.action?.setBadgeText?.({ text: '' });
        } catch (e) {}
        
    } catch (error) {
        console.error(`${LOG} Sync error:`, error);
        showToast(`Sync error: ${error.message}`, 'error');
    } finally {
        elements.syncNowBtn.textContent = originalText || '🔄';
        elements.syncNowBtn.disabled = false;
    }
}

/**
 * Clear workbook configuration
 */
async function clearWorkbook() {
    if (!confirm('Disconnect this workbook?\n\nThis will clear the configuration but your schedules and mappings will remain until you load a new workbook.')) {
        return;
    }
    
    try {
        await sendMessage('CLEAR_WORKBOOK');
        
        state.workbookConfig = null;
        state.searches = [];
        
        // Reset UI
        elements.syncStatusContainer?.classList.add('hidden');
        elements.syncSettings?.classList.add('hidden');
        elements.workbookHelp?.classList.remove('hidden');
        if (elements.workbookUrl) {
            elements.workbookUrl.value = '';
        }
        
        // Clear dropdowns
        renderSourceDropdown();
        
        showToast('Workbook disconnected', 'info');
    } catch (error) {
        console.error(`${LOG} Clear workbook error:`, error);
        showToast(error.message || 'Failed to disconnect workbook', 'error');
    }
}

/**
 * Update sync interval
 */
async function updateSyncInterval() {
    const minutes = parseInt(elements.syncIntervalSelect?.value, 10);
    if (isNaN(minutes)) return;
    
    try {
        const result = await sendMessage('SET_SYNC_INTERVAL', { minutes });
        
        if (result.success) {
            showToast(`Sync interval set to ${minutes} minute(s)`, 'success');
            
            // Update next sync time display
            updateNextSyncTime();
        }
    } catch (error) {
        console.error(`${LOG} Set interval error:`, error);
        showToast(error.message || 'Failed to update interval', 'error');
    }
}

/**
 * Render workbook status UI
 */
function renderWorkbookStatus(config, changes = null) {
    if (!config) {
        elements.syncStatusContainer?.classList.add('hidden');
        elements.syncSettings?.classList.add('hidden');
        elements.workbookHelp?.classList.remove('hidden');
        return;
    }
    
    // Show status container and settings
    elements.syncStatusContainer?.classList.remove('hidden');
    elements.syncSettings?.classList.remove('hidden');
    elements.workbookHelp?.classList.add('hidden');
    
    // Workbook link
    if (elements.workbookLink) {
        elements.workbookLink.href = config.workbookUrl || '#';
        elements.workbookLink.textContent = config.workbookTitle || 'Workbook';
        elements.workbookLink.title = config.workbookTitle || 'Open in Google Sheets';
    }
    
    // Stats badges
    if (elements.connectionCount) {
        const count = config.stats?.totalConnections || 0;
        elements.connectionCount.textContent = `${count} connection${count !== 1 ? 's' : ''}`;
    }
    if (elements.searchCount) {
        const count = config.stats?.totalSearches || 0;
        elements.searchCount.textContent = `${count} search${count !== 1 ? 'es' : ''}`;
    }
    if (elements.scheduleCount) {
        const count = config.stats?.connectionsWithSchedule || 0;
        elements.scheduleCount.textContent = `${count} scheduled`;
    }
    
    // Sync status indicator
    if (elements.syncStatusText) {
        elements.syncStatusText.className = 'sync-status-indicator';
        elements.syncStatusText.classList.add(config.syncStatus || 'success');
        
        const statusText = {
            'success': '● Synced',
            'syncing': '● Syncing...',
            'error': '● Sync Error'
        };
        elements.syncStatusText.textContent = statusText[config.syncStatus] || '● Unknown';
    }
    
    // Last sync time
    if (elements.lastSyncTime) {
        if (config.lastSync) {
            const syncDate = new Date(config.lastSync);
            elements.lastSyncTime.textContent = formatRelativeTime(syncDate);
        } else {
            elements.lastSyncTime.textContent = '';
        }
    }
    
    // URL in input field
    if (elements.workbookUrl && config.workbookUrl) {
        elements.workbookUrl.value = config.workbookUrl;
    }
    
    // Changes list
    renderChanges(changes);
    
    // Unmapped warning
    renderUnmappedWarning(config.stats?.unmappedConnections);
    
    // Update next sync time
    updateNextSyncTime();
}

/**
 * Render changes list
 */
function renderChanges(changes) {
    if (!elements.syncChanges || !elements.changesList) return;
    
    const displayChanges = changes || [];
    
    if (displayChanges.length > 0 && displayChanges[0].type !== 'initial_load') {
        elements.syncChanges.classList.remove('hidden');
        
        elements.changesList.innerHTML = displayChanges
            .slice(0, 5) // Show max 5 changes
            .map(change => {
                let className = 'changed';
                if (change.type.includes('added')) className = 'added';
                else if (change.type.includes('removed')) className = 'removed';
                
                return `<li class="${className}">${escapeHtml(change.message)}</li>`;
            })
            .join('');
            
        if (displayChanges.length > 5) {
            elements.changesList.innerHTML += `<li class="text-muted">...and ${displayChanges.length - 5} more</li>`;
        }
    } else {
        elements.syncChanges.classList.add('hidden');
    }
}

/**
 * Render unmapped connections warning
 */
function renderUnmappedWarning(unmappedConnections) {
    if (!elements.unmappedWarning || !elements.unmappedCount) return;
    
    if (unmappedConnections && unmappedConnections.length > 0) {
        elements.unmappedWarning.classList.remove('hidden');
        elements.unmappedCount.textContent = unmappedConnections.length;
        elements.unmappedWarning.title = `Missing mappings: ${unmappedConnections.join(', ')}`;
    } else {
        elements.unmappedWarning.classList.add('hidden');
    }
}

/**
 * Update next sync time display
 */
async function updateNextSyncTime() {
    if (!elements.nextSyncTime) return;
    
    try {
        const result = await sendMessage('GET_SYNC_STATUS');
        
        if (result.success && result.nextSync) {
            const nextDate = new Date(result.nextSync);
            const now = new Date();
            const diffMs = nextDate - now;
            const diffMins = Math.round(diffMs / 60000);
            
            if (diffMins <= 0) {
                elements.nextSyncTime.textContent = 'Syncing soon...';
            } else if (diffMins === 1) {
                elements.nextSyncTime.textContent = 'Next sync in ~1 minute';
            } else {
                elements.nextSyncTime.textContent = `Next sync in ~${diffMins} minutes`;
            }
        } else {
            elements.nextSyncTime.textContent = '';
        }
    } catch (e) {
        elements.nextSyncTime.textContent = '';
    }
}

/**
 * Refresh searches from config (for backward compatibility with source dropdown)
 */
async function refreshSearchesFromConfig(config) {
    if (!config?.connections) return;
    
    // Flatten searches with source info
    const searches = [];
    config.connections.forEach(conn => {
        conn.searches.forEach(s => {
            searches.push({
                source: conn.name,
                title: s.targetTitle,
                url: s.linkedInUrl
            });
        });
    });
    
    state.searches = searches;
    
    // Re-render source dropdown
    renderSourceDropdown();
}

/**
 * Format relative time (e.g., "2 min ago", "1 hour ago")
 */
function formatRelativeTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffSecs < 30) return 'just now';
    if (diffSecs < 60) return `${diffSecs}s ago`;
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}


// ============================================================
// STEP 5: UPDATE loadInitialData() FUNCTION
// Replace or modify your existing loadInitialData
// ============================================================

async function loadInitialData() {
    try {
        console.log(`${LOG} Loading initial data...`);
        
        // NEW: Load workbook config first (unified approach)
        const configResult = await sendMessage('GET_WORKBOOK_CONFIG').catch(() => ({ config: null }));
        
        if (configResult.config) {
            console.log(`${LOG} Found unified workbook config`);
            state.workbookConfig = configResult.config;
            renderWorkbookStatus(configResult.config, configResult.lastChanges);
            await refreshSearchesFromConfig(configResult.config);
        } else {
            // FALLBACK: Load from legacy storage (for backward compatibility)
            console.log(`${LOG} No unified config, trying legacy storage`);
            
            const inputSheetResult = await sendMessage('GET_INPUT_SHEET_INFO').catch(() => ({ sheetId: null }));
            if (inputSheetResult.sheetId) {
                if (elements.workbookUrl) {
                    elements.workbookUrl.value = `https://docs.google.com/spreadsheets/d/${inputSheetResult.sheetId}`;
                }
                
                // Load searches from legacy
                const searchResult = await sendMessage('GET_SEARCHES').catch(() => ({ searches: [] }));
                state.searches = searchResult.searches || [];
                
                console.log(`${LOG} Loaded ${state.searches.length} searches from legacy storage`);
            }
        }
        
        // Load sync interval setting
        const statusResult = await sendMessage('GET_SYNC_STATUS').catch(() => ({}));
        if (statusResult.syncInterval && elements.syncIntervalSelect) {
            elements.syncIntervalSelect.value = statusResult.syncInterval.toString();
        }
        
        // Load other data (workbooks, mappings, schedules)
        const workbookResult = await sendMessage('GET_WORKBOOKS').catch(() => ({ workbooks: [] }));
        state.workbooks = workbookResult.workbooks || [];
        
        const mappingResult = await sendMessage('GET_SOURCE_MAPPING').catch(() => ({ mapping: {} }));
        state.sourceMapping = mappingResult.mapping || {};
        
        const scheduleResult = await sendMessage('GET_SCHEDULES').catch(() => ({ schedules: [] }));
        state.schedules = scheduleResult.schedules || [];
        
        // Render UI
        renderSourceDropdown();
        renderWorkbookMappings();
        renderScheduleList();
        
        // Load queue status and execution history
        await loadQueueStatus();
        await loadExecutionHistory();
        
        // Clear badge on popup open
        try {
            chrome.action?.setBadgeText?.({ text: '' });
        } catch (e) {}
        
        console.log(`${LOG} Initial data loaded successfully`);
        
    } catch (error) {
        console.error(`${LOG} Error loading initial data:`, error);
        showToast('Error loading data', 'error');
    }
}


// ============================================================
// STEP 6: ADD STORAGE CHANGE LISTENER
// (For live updates when popup is open)
// ============================================================

// Listen for storage changes (live updates)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    
    // If workbook config changed, refresh UI
    if (changes.workbookConfig) {
        const newConfig = changes.workbookConfig.newValue;
        if (newConfig) {
            console.log(`${LOG} Workbook config updated via storage change`);
            state.workbookConfig = newConfig;
            renderWorkbookStatus(newConfig);
            refreshSearchesFromConfig(newConfig);
        }
    }
    
    // If sync changes detected
    if (changes.lastSyncChanges) {
        const newChanges = changes.lastSyncChanges.newValue;
        if (newChanges?.length > 0 && state.workbookConfig) {
            console.log(`${LOG} Sync changes detected:`, newChanges);
            renderWorkbookStatus(state.workbookConfig, newChanges);
            
            // Show notification if changes are significant
            const significantChanges = newChanges.filter(c => c.type !== 'initial_load');
            if (significantChanges.length > 0) {
                showToast(`Sheet updated: ${significantChanges.length} change(s)`, 'info');
            }
        }
    }
});


// ============================================================
// STEP 7: REFRESH ON VISIBILITY CHANGE
// (Sync when user returns to popup)
// ============================================================

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && state.workbookConfig) {
        console.log(`${LOG} Popup visible, refreshing data...`);
        
        // Quick refresh of workbook status
        try {
            const result = await sendMessage('GET_WORKBOOK_CONFIG');
            if (result.config) {
                state.workbookConfig = result.config;
                renderWorkbookStatus(result.config, result.lastChanges);
            }
        } catch (e) {
            console.error(`${LOG} Visibility refresh error:`, e);
        }
        
        // Clear badge
        try {
            chrome.action?.setBadgeText?.({ text: '' });
        } catch (e) {}
    }
});
