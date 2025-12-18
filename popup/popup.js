// popup/popup.js - Popup UI Controller

const LOG = '[POPUP]';

// ============================================================
// DOM ELEMENTS (cached on load)
// ============================================================
const elements = {};

// ============================================================
// STATE
// ============================================================
let state = {
    inputSheetId: null,
    inputSheetTitle: null,
    workbookConfig: null,
    lastSyncChanges: null,
    searches: [],
    workbooks: [],
    sourceMapping: {},
    schedules: [],
    isScrapingActive: false
};

// ============================================================
// UTILITIES
// ============================================================

/**
 * Send message to service worker
 */
async function sendMessage(action, data = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action, ...data }, (response) => {
            if (chrome.runtime.lastError) {
                console.error(`${LOG} Message error:`, chrome.runtime.lastError.message);
                reject(new Error(chrome.runtime.lastError.message));
            } else if (response && !response.success && response.error) {
                reject(new Error(response.error));
            } else {
                resolve(response || { success: true });
            }
        });
    });
}

/**
 * Send message to content script
 */
async function sendTabMessage(tabId, message, timeout = 1000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeout);
        
        chrome.tabs.sendMessage(tabId, message, (response) => {
            clearTimeout(timer);
            if (chrome.runtime.lastError) {
                console.log(`${LOG} Tab message failed:`, chrome.runtime.lastError.message);
                resolve(null);
            } else {
                resolve(response);
            }
        });
    });
}

/**
 * Parse Google Sheet URL to extract ID
 */
function parseGoogleSheetUrl(input) {
    if (!input) return null;
    
    // Already an ID (no slashes)
    if (!input.includes('/')) {
        return input.trim();
    }
    
    // URL format: https://docs.google.com/spreadsheets/d/{ID}/...
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
}

/**
 * Format date for display
 */
function formatDate(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

/**
 * Format duration
 */
function formatDuration(ms) {
    if (!ms) return '-';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
}

function getWorkbookLabel(w) {
    if (!w) return '';
    return w.title || w.name || w.id;
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
    const container = elements.toastContainer;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.remove();
    }, 3000);
}

/**
 * Toggle section collapse
 */
function toggleSection(sectionId) {
    const section = document.getElementById(`section-${sectionId}`);
    if (section) {
        section.classList.toggle('collapsed');
    }
}

/**
 * Set button loading state
 */
function setButtonLoading(btn, loading) {
    if (loading) {
        btn.disabled = true;
        btn.dataset.originalText = btn.textContent;
        btn.textContent = '...';
    } else {
        btn.disabled = false;
        btn.textContent = btn.dataset.originalText || btn.textContent;
    }
}

function renderSyncStatus(config) {
    if (!elements.syncStatusContainer) return;

    if (!config) {
        elements.syncStatusContainer.classList.add('hidden');
        elements.syncStatusContainer.textContent = '';
        elements.syncStatusContainer.classList.remove('sync-status-success', 'sync-status-error', 'sync-status-syncing');
        return;
    }

    const status = config.syncStatus || 'unknown';
    elements.syncStatusContainer.classList.remove('hidden');
    elements.syncStatusContainer.classList.remove('sync-status-success', 'sync-status-error', 'sync-status-syncing');

    if (status === 'success') elements.syncStatusContainer.classList.add('sync-status-success');
    if (status === 'error') elements.syncStatusContainer.classList.add('sync-status-error');
    if (status === 'syncing') elements.syncStatusContainer.classList.add('sync-status-syncing');

    const title = config.workbookTitle || 'Untitled';
    const lastSync = config.lastSync ? formatDate(config.lastSync) : '-';
    const err = config.lastSyncError ? ` • Error: ${config.lastSyncError}` : '';

    elements.syncStatusContainer.textContent = `${title} • Status: ${status} • Last sync: ${lastSync}${err}`;
}

function renderSyncChanges(changes) {
    if (!elements.syncChangesContainer) return;

    if (!changes || changes.length === 0) {
        elements.syncChangesContainer.classList.add('hidden');
        elements.syncChangesContainer.textContent = '';
        return;
    }

    elements.syncChangesContainer.classList.remove('hidden');
    elements.syncChangesContainer.innerHTML = changes
        .map(c => `<div>${c.message || JSON.stringify(c)}</div>`)
        .join('');
}

async function loadWorkbookConfigFromPopup() {
    const url = elements.workbookUrl?.value?.trim();
    if (!url) return showToast('Please enter a workbook URL or ID', 'error');

    setButtonLoading(elements.loadWorkbookBtn, true);
    try {
        const r = await sendMessage('LOAD_WORKBOOK', { workbookUrl: url });
        state.workbookConfig = r.config || null;
        state.lastSyncChanges = r.changes || null;
        renderSyncStatus(state.workbookConfig);
        renderSyncChanges(state.lastSyncChanges);
        showToast('Workbook loaded', 'success');

        await loadInitialData();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        setButtonLoading(elements.loadWorkbookBtn, false);
    }
}

async function syncWorkbookNowFromPopup() {
    setButtonLoading(elements.syncWorkbookBtn, true);
    try {
        const r = await sendMessage('SYNC_WORKBOOK');
        if (r && r.synced === false) {
            if (r.reason === 'no_workbook') {
                showToast('No workbook configured. Click Load first.', 'error');
                return;
            }
            if (r.error) {
                showToast(r.error, 'error');
                return;
            }
        }
        state.workbookConfig = r.config || state.workbookConfig;
        state.lastSyncChanges = r.changes || null;
        renderSyncStatus(state.workbookConfig);
        renderSyncChanges(state.lastSyncChanges);
        showToast('Sync complete', 'success');

        await loadInitialData();
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        setButtonLoading(elements.syncWorkbookBtn, false);
    }
}

async function clearWorkbookFromPopup() {
    setButtonLoading(elements.clearWorkbookBtn, true);
    try {
        await sendMessage('CLEAR_WORKBOOK');
        state.workbookConfig = null;
        state.lastSyncChanges = null;
        renderSyncStatus(null);
        renderSyncChanges(null);
        showToast('Workbook cleared', 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        setButtonLoading(elements.clearWorkbookBtn, false);
    }
}

async function onSyncIntervalChange() {
    const minutes = Number(elements.syncIntervalSelect.value);
    try {
        const r = await sendMessage('SET_SYNC_INTERVAL', { minutes });
        showToast(`Sync interval set to ${r.minutes} min`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log(`${LOG} Initializing popup...`);
    
    // Cache DOM elements
    cacheElements();
    
    // Setup event listeners
    setupEventListeners();
    
    // Load initial data
    await loadInitialData();
    
    // Populate hour dropdown
    populateHourDropdown();
    
    console.log(`${LOG} Popup initialized`);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.workbookConfig) {
        state.workbookConfig = changes.workbookConfig.newValue || null;
        renderSyncStatus(state.workbookConfig);
    }
    if (changes.lastSyncChanges) {
        state.lastSyncChanges = changes.lastSyncChanges.newValue || null;
        renderSyncChanges(state.lastSyncChanges);
    }
});

function cacheElements() {
    // Live Sync (Workbook Config)
    elements.workbookUrl = document.getElementById('workbook-url');
    elements.loadWorkbookBtn = document.getElementById('load-workbook-btn');
    elements.syncWorkbookBtn = document.getElementById('sync-workbook-btn');
    elements.clearWorkbookBtn = document.getElementById('clear-workbook-btn');
    elements.syncIntervalSelect = document.getElementById('sync-interval-select');
    elements.syncStatusContainer = document.getElementById('sync-status-container');
    elements.syncChangesContainer = document.getElementById('sync-changes-container');
    
    // Mappings
    elements.mappingList = document.getElementById('mapping-list');
    elements.addWorkbookBtn = document.getElementById('add-workbook-btn');
    
    // Scraping
    elements.sourceSelect = document.getElementById('source-select');
    elements.startScrapeBtn = document.getElementById('start-scrape-btn');
    elements.stopScrapeBtn = document.getElementById('stop-scrape-btn');
    elements.scrapeProgress = document.getElementById('scrape-progress');
    elements.progressFill = document.getElementById('progress-fill');
    elements.progressText = document.getElementById('progress-text');
    
    // Compare
    elements.compareWorkbookSelect = document.getElementById('compare-workbook-select');
    elements.compareTab1 = document.getElementById('compare-tab1');
    elements.compareTab2 = document.getElementById('compare-tab2');
    elements.compareOutputName = document.getElementById('compare-output-name');
    elements.compareKeyColumn = document.getElementById('compare-key-column');
    elements.compareTabsBtn = document.getElementById('compare-tabs-btn');
    elements.compareResults = document.getElementById('compare-results');
    
    // Schedules
    elements.scheduleList = document.getElementById('schedule-list');
    elements.addScheduleBtn = document.getElementById('add-schedule-btn');
    elements.nextRunInfo = document.getElementById('next-run-info');
    
    // History
    elements.historyTbody = document.getElementById('history-tbody');
    
    // Settings
    elements.webhookUrl = document.getElementById('webhook-url');
    elements.saveWebhookBtn = document.getElementById('save-webhook-btn');
    elements.testWebhookBtn = document.getElementById('test-webhook-btn');
    elements.webhookStatus = document.getElementById('webhook-status');
    
    // Footer
    elements.queuePending = document.getElementById('queue-pending');
    elements.queueFailed = document.getElementById('queue-failed');
    elements.queueFailedContainer = document.getElementById('queue-failed-container');
    elements.retryFailedBtn = document.getElementById('retry-failed-btn');
    elements.deduplicateBtn = document.getElementById('deduplicate-btn');
    
    // Modals
    elements.scheduleModal = document.getElementById('schedule-modal');
    elements.modalCloseBtn = document.getElementById('modal-close-btn');
    elements.scheduleSourceSelect = document.getElementById('schedule-source-select');
    elements.scheduleDaySelect = document.getElementById('schedule-day-select');
    elements.scheduleFrequencySelect = document.getElementById('schedule-frequency-select');
    elements.scheduleTimeInput = document.getElementById('schedule-time-input');
    elements.scheduleHourSelect = document.getElementById('schedule-hour-select');
    elements.scheduleMinuteSelect = document.getElementById('schedule-minute-select');
    elements.scheduleTestEnabled = document.getElementById('schedule-test-enabled');
    elements.scheduleTestOptions = document.getElementById('schedule-test-options');
    elements.scheduleTestSearchSelect = document.getElementById('schedule-test-search-select');
    elements.scheduleTestMaxPages = document.getElementById('schedule-test-max-pages');
    elements.cancelScheduleBtn = document.getElementById('cancel-schedule-btn');
    elements.saveScheduleBtn = document.getElementById('save-schedule-btn');
    
    elements.workbookModal = document.getElementById('workbook-modal');
    elements.workbookModalCloseBtn = document.getElementById('workbook-modal-close-btn');
    elements.newWorkbookUrl = document.getElementById('new-workbook-url');
    elements.newWorkbookSource = document.getElementById('new-workbook-source');
    elements.cancelWorkbookBtn = document.getElementById('cancel-workbook-btn');
    elements.confirmWorkbookBtn = document.getElementById('confirm-workbook-btn');
    
    // Toast container
    elements.toastContainer = document.getElementById('toast-container');
    
    // Status indicator
    elements.statusIndicator = document.getElementById('status-indicator');
}

function populateHourDropdown() {
    const select = elements.scheduleHourSelect;
    select.innerHTML = '';
    for (let i = 0; i < 24; i++) {
        const option = document.createElement('option');
        option.value = i;
        const hour = i % 12 || 12;
        const ampm = i < 12 ? 'AM' : 'PM';
        option.textContent = `${String(i).padStart(2, '0')} (${hour} ${ampm})`;
        select.appendChild(option);
    }
}

function populateMinuteDropdown() {
    const select = elements.scheduleMinuteSelect;
    select.innerHTML = '';
    for (let i = 0; i < 60; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = `:${String(i).padStart(2, '0')}`;
        select.appendChild(option);
    }
}

// Sync time input with dropdowns
function syncTimeInputToDropdowns() {
    const hour = parseInt(elements.scheduleHourSelect.value) || 0;
    const minute = parseInt(elements.scheduleMinuteSelect.value) || 0;
    elements.scheduleTimeInput.value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// Sync dropdowns with time input
function syncDropdownsToTimeInput() {
    const timeStr = elements.scheduleTimeInput.value.trim();
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    const match = timeStr.match(timeRegex);
    
    if (match) {
        const hour = parseInt(match[1]);
        const minute = parseInt(match[2]);
        elements.scheduleHourSelect.value = hour.toString();
        elements.scheduleMinuteSelect.value = minute.toString();
    }
}

async function loadInitialData() {
    try {
        // Live Sync: load workbook config + last changes (non-fatal)
        const cfg = await sendMessage('GET_WORKBOOK_CONFIG').catch(() => ({ config: null, lastChanges: null }));
        state.workbookConfig = cfg.config || null;
        state.lastSyncChanges = cfg.lastChanges || null;
        renderSyncStatus(state.workbookConfig);
        renderSyncChanges(state.lastSyncChanges);
        
        // Load searches
        const searchResult = await sendMessage('GET_SEARCHES').catch(() => ({ searches: [] }));
        state.searches = searchResult.searches || [];

        // If workbook configured, populate input field
        if (state.workbookConfig?.workbookUrl && elements.workbookUrl) {
            elements.workbookUrl.value = state.workbookConfig.workbookUrl;
        } else if (elements.workbookUrl && !elements.workbookUrl.value) {
            // Fallback: if workbookConfig is missing but legacy inputSheetId exists, show it.
            try {
                const stored = await chrome.storage.local.get(['inputSheetId']);
                if (stored.inputSheetId) {
                    elements.workbookUrl.value = `https://docs.google.com/spreadsheets/d/${stored.inputSheetId}`;
                }
            } catch (e) {
                // ignore
            }
        }
        
        // Load workbooks
        const workbookResult = await sendMessage('GET_WORKBOOKS');
        state.workbooks = workbookResult.workbooks || [];
        
        // Load source mapping
        const mappingResult = await sendMessage('GET_SOURCE_MAPPING');
        state.sourceMapping = mappingResult.mapping || {};
        
        // Load schedules
        const scheduleResult = await sendMessage('GET_SCHEDULES');
        state.schedules = scheduleResult.schedules || [];
        
        // Load queue status
        await loadQueueStatus();
        
        // Load execution history
        await loadExecutionHistory();
        
        // Render UI
        renderSourceDropdown();
        renderWorkbookMappings();
        renderScheduleList();
        renderWorkbookDropdowns();
        
    } catch (error) {
        console.error(`${LOG} Error loading data:`, error);
        showToast('Error loading data', 'error');
    }
}

// ============================================================
// EVENT LISTENERS SETUP
// ============================================================

function setupEventListeners() {
    // Section toggles
    document.querySelectorAll('.section-header').forEach(header => {
        header.addEventListener('click', () => {
            const sectionId = header.dataset.section;
            toggleSection(sectionId);
        });
    });
    
    // Live Sync (Workbook Config)
    elements.loadWorkbookBtn.addEventListener('click', loadWorkbookConfigFromPopup);
    elements.syncWorkbookBtn.addEventListener('click', syncWorkbookNowFromPopup);
    elements.clearWorkbookBtn.addEventListener('click', clearWorkbookFromPopup);
    elements.syncIntervalSelect.addEventListener('change', onSyncIntervalChange);
    
    // Workbooks
    elements.addWorkbookBtn.addEventListener('click', openWorkbookModal);
    elements.workbookModalCloseBtn.addEventListener('click', closeWorkbookModal);
    elements.cancelWorkbookBtn.addEventListener('click', closeWorkbookModal);
    elements.confirmWorkbookBtn.addEventListener('click', addWorkbook);
    
    // Scraping
    elements.startScrapeBtn.addEventListener('click', startScrape);
    elements.stopScrapeBtn.addEventListener('click', stopScrape);
    
    // Compare
    elements.compareWorkbookSelect.addEventListener('change', loadTabsForCompare);
    elements.compareTabsBtn.addEventListener('click', compareTabs);
    
    // Schedules
    elements.addScheduleBtn.addEventListener('click', openScheduleModal);
    elements.modalCloseBtn.addEventListener('click', closeScheduleModal);
    elements.cancelScheduleBtn.addEventListener('click', closeScheduleModal);
    elements.saveScheduleBtn.addEventListener('click', saveSchedule);
    
    // Sync time input and dropdowns
    elements.scheduleTimeInput.addEventListener('input', syncDropdownsToTimeInput);
    elements.scheduleHourSelect.addEventListener('change', syncTimeInputToDropdowns);
    elements.scheduleMinuteSelect.addEventListener('change', syncTimeInputToDropdowns);

    // Schedule test mode toggle + per-source search list
    elements.scheduleTestEnabled.addEventListener('change', () => {
        elements.scheduleTestOptions.classList.toggle('hidden', !elements.scheduleTestEnabled.checked);
    });
    elements.scheduleSourceSelect.addEventListener('change', () => {
        populateScheduleTestSearchDropdown(elements.scheduleSourceSelect.value);
    });
    
    // Settings
    elements.saveWebhookBtn.addEventListener('click', saveWebhookUrl);
    elements.testWebhookBtn.addEventListener('click', testWebhook);
    
    // Footer
    elements.retryFailedBtn.addEventListener('click', retryFailed);
    elements.deduplicateBtn.addEventListener('click', deduplicate);
}

function populateScheduleTestSearchDropdown(sourceName) {
    const select = elements.scheduleTestSearchSelect;
    select.innerHTML = '';

    const sourceSearches = state.searches.filter(s => s.source === sourceName);
    if (sourceSearches.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No searches found for this source';
        select.appendChild(opt);
        return;
    }

    sourceSearches.forEach((s, idx) => {
        const opt = document.createElement('option');
        // store both url and title (title can be empty)
        opt.value = s.url || '';
        opt.textContent = `${idx + 1}. ${s.title || '(No title)'}`;
        opt.dataset.title = s.title || '';
        select.appendChild(opt);
    });
}

// ============================================================
// INPUT SHEET
// ============================================================

async function loadInputSheet() {
    // Legacy flow retained for reference; Input Sheet UI was removed in Live Sync.
    if (!elements.inputSheetUrl) {
        showToast('Input Sheet UI is disabled (use Workbook Configuration)', 'error');
        return;
    }

    const url = elements.inputSheetUrl.value.trim();
    if (!url) {
        showToast('Please enter a Sheet URL or ID', 'error');
        return;
    }
    
    const sheetId = parseGoogleSheetUrl(url);
    if (!sheetId) {
        showToast('Invalid Sheet URL', 'error');
        return;
    }
    
    if (elements.loadSheetBtn) setButtonLoading(elements.loadSheetBtn, true);
    
    try {
        const result = await sendMessage('LOAD_INPUT_SHEET', { sheetId });
        
        state.inputSheetId = sheetId;
        state.inputSheetTitle = result.title;
        
        // Persist URL in input field
        if (elements.inputSheetUrl) elements.inputSheetUrl.value = url;
        
        // Load searches
        const searchResult = await sendMessage('GET_SEARCHES');
        state.searches = searchResult.searches || [];
        
        // Update UI (if legacy elements exist)
        if (elements.inputSheetInfo) elements.inputSheetInfo.classList.remove('hidden');
        if (elements.inputSheetLink) {
            elements.inputSheetLink.href = `https://docs.google.com/spreadsheets/d/${sheetId}`;
            elements.inputSheetLink.textContent = result.title;
        }
        if (elements.searchCount) elements.searchCount.textContent = `${state.searches.length} searches`;
        
        // Update dropdowns
        renderSourceDropdown();
        
        showToast(`Loaded ${state.searches.length} searches`, 'success');
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        if (elements.loadSheetBtn) setButtonLoading(elements.loadSheetBtn, false);
    }
}

// ============================================================
// RENDERING FUNCTIONS
// ============================================================

function renderSourceDropdown() {
    const sources = [...new Set(state.searches.map(s => s.source))];
    
    // Main scrape dropdown
    elements.sourceSelect.innerHTML = '<option value="">Select source...</option>';
    sources.forEach(source => {
        const option = document.createElement('option');
        option.value = source;
        option.textContent = source;
        elements.sourceSelect.appendChild(option);
    });
    
    // Schedule modal dropdown
    elements.scheduleSourceSelect.innerHTML = '';
    sources.forEach(source => {
        const option = document.createElement('option');
        option.value = source;
        option.textContent = source;
        elements.scheduleSourceSelect.appendChild(option);
    });
    
    // Workbook modal dropdown
    elements.newWorkbookSource.innerHTML = '<option value="">No mapping</option>';
    sources.forEach(source => {
        const option = document.createElement('option');
        option.value = source;
        option.textContent = source;
        elements.newWorkbookSource.appendChild(option);
    });
}

function renderWorkbookMappings() {
    elements.mappingList.innerHTML = '';
    
    const sources = [...new Set(state.searches.map(s => s.source))];
    
    sources.forEach(source => {
        const workbookId = state.sourceMapping[source];
        const workbook = state.workbooks.find(w => w.id === workbookId);
        
        const item = document.createElement('div');
        item.className = 'mapping-item';
        item.innerHTML = `
            <span class="mapping-source">${source}</span>
            <span class="mapping-arrow">→</span>
            <span class="mapping-workbook">${workbook ? getWorkbookLabel(workbook) : 'Not mapped'}</span>
            <select class="mapping-select" data-source="${source}">
                <option value="">Select workbook...</option>
                ${state.workbooks.map(w => `
                    <option value="${w.id}" ${w.id === workbookId ? 'selected' : ''}>
                        ${getWorkbookLabel(w)}
                    </option>
                `).join('')}
            </select>
        `;
        
        const select = item.querySelector('.mapping-select');
        select.addEventListener('change', (e) => {
            updateSourceMapping(source, e.target.value);
        });
        
        elements.mappingList.appendChild(item);
    });
}

function renderScheduleList() {
    elements.scheduleList.innerHTML = '';
    
    if (state.schedules.length === 0) {
        elements.scheduleList.innerHTML = '<div class="text-muted">No schedules configured</div>';
        return;
    }
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    function getFrequencyLabel(schedule) {
        const freq = schedule.frequency || 'weekly';
        if (freq === 'biweekly') {
            if (schedule.weekPattern === 'odd') return '1st & 3rd week of month';
            if (schedule.weekPattern === 'even') return '2nd & 4th week of month';
            return 'Biweekly';
        }
        return 'Every week';
    }
    
    state.schedules.forEach(schedule => {
        const hour = schedule.hour % 12 || 12;
        const ampm = schedule.hour < 12 ? 'AM' : 'PM';
        const minute = String(schedule.minute).padStart(2, '0');
        const freqLabel = getFrequencyLabel(schedule);
        
        const item = document.createElement('div');
        item.className = 'schedule-item';
        item.innerHTML = `
            <div class="schedule-info" data-schedule-id="${schedule.id}" style="cursor: pointer; flex: 1;">
                <div class="schedule-source">${schedule.sourceName}</div>
                <div class="schedule-time">${days[schedule.dayOfWeek]} at ${hour}:${minute} ${ampm} • ${freqLabel}</div>
            </div>
            <div class="schedule-actions">
                <label class="toggle-switch">
                    <input type="checkbox" ${schedule.enabled ? 'checked' : ''} data-id="${schedule.id}">
                    <span class="toggle-slider"></span>
                </label>
                <button class="delete-btn" data-id="${schedule.id}">×</button>
            </div>
        `;
        
        // Make schedule info clickable to edit
        item.querySelector('.schedule-info').addEventListener('click', (e) => {
            // Don't trigger if clicking inside nested elements (though there aren't any)
            e.stopPropagation();
            openScheduleModal(schedule.id);
        });
        
        item.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
            toggleScheduleEnabled(schedule.id, e.target.checked);
        });
        
        item.querySelector('.delete-btn').addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent triggering edit
            deleteSchedule(schedule.id);
        });
        
        elements.scheduleList.appendChild(item);
    });
    
    // Update next run info
    const nextSchedule = state.schedules
        .filter(s => s.enabled)
        .sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun))[0];
    
    if (nextSchedule) {
        elements.nextRunInfo.innerHTML = `Next: ${nextSchedule.sourceName} at ${formatDate(nextSchedule.nextRun)}`;
    } else {
        elements.nextRunInfo.innerHTML = 'No upcoming runs';
    }
}

function renderWorkbookDropdowns() {
    const options = state.workbooks.map(w =>
        `<option value="${w.id}">${getWorkbookLabel(w)}</option>`
    ).join('');
    
    elements.compareWorkbookSelect.innerHTML = `
        <option value="">Select workbook...</option>
        ${options}
    `;
}

// ============================================================
// WORKBOOK MANAGEMENT
// ============================================================

function openWorkbookModal() {
    elements.newWorkbookUrl.value = '';
    elements.newWorkbookSource.value = '';
    elements.workbookModal.classList.remove('hidden');
}

function closeWorkbookModal() {
    elements.workbookModal.classList.add('hidden');
}

async function addWorkbook() {
    const url = elements.newWorkbookUrl.value.trim();
    const sourceName = elements.newWorkbookSource.value;
    
    if (!url) {
        showToast('Please enter a Sheet URL', 'error');
        return;
    }
    
    const sheetId = parseGoogleSheetUrl(url);
    if (!sheetId) {
        showToast('Invalid Sheet URL', 'error');
        return;
    }
    
    setButtonLoading(elements.confirmWorkbookBtn, true);
    
    try {
        await sendMessage('ADD_WORKBOOK', { sheetId, sourceName });
        
        // Reload workbooks
        const result = await sendMessage('GET_WORKBOOKS');
        state.workbooks = result.workbooks || [];
        
        // Reload mappings if source was specified
        if (sourceName) {
            const mappingResult = await sendMessage('GET_SOURCE_MAPPING');
            state.sourceMapping = mappingResult.mapping || {};
        }
        
        // Update UI
        renderWorkbookMappings();
        renderWorkbookDropdowns();
        closeWorkbookModal();
        
        showToast('Workbook added', 'success');
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.confirmWorkbookBtn, false);
    }
}

async function updateSourceMapping(source, workbookId) {
    try {
        await sendMessage('SET_SOURCE_MAPPING', { sourceName: source, workbookId });
        state.sourceMapping[source] = workbookId;
        showToast(`Mapped ${source}`, 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================================
// SCRAPING
// ============================================================

async function startScrape() {
    const source = elements.sourceSelect.value;
    if (!source) {
        showToast('Please select a source', 'error');
        return;
    }
    
    // Get searches for this source
    const sourceSearches = state.searches.filter(s => s.source === source);
    if (sourceSearches.length === 0) {
        showToast(`No searches found for ${source}`, 'error');
        return;
    }
    
    // Check if workbook is mapped
    const workbookId = state.sourceMapping[source];
    if (!workbookId) {
        showToast(`Please map ${source} to a workbook first`, 'error');
        return;
    }
    
    setButtonLoading(elements.startScrapeBtn, true);
    
    try {
        // Start manual scrape - service worker will handle navigation through searches
        await sendMessage('START_MANUAL_SCRAPE', { 
            sourceName: source,
            searches: sourceSearches
        });
        
        // Update UI
        elements.startScrapeBtn.classList.add('hidden');
        elements.stopScrapeBtn.classList.remove('hidden');
        elements.scrapeProgress.classList.remove('hidden');
        elements.statusIndicator.classList.add('active');
        elements.progressFill.style.width = '0%';
        elements.progressText.textContent = `0/${sourceSearches.length} searches`;
        
        showToast(`Starting scrape for ${sourceSearches.length} searches`, 'success');
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.startScrapeBtn, false);
    }
}

async function stopScrape() {
    try {
        // Stop manual scrape
        await sendMessage('STOP_MANUAL_SCRAPE');
        
        // Also try to stop content script scraping
        try {
            const [tab] = await chrome.tabs.query({ url: 'https://*.linkedin.com/*' });
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCRAPING' }).catch(() => {});
            }
        } catch (e) {
            // Ignore if no tab found
        }
        
        elements.startScrapeBtn.classList.remove('hidden');
        elements.stopScrapeBtn.classList.add('hidden');
        elements.statusIndicator.classList.remove('active');
        
        showToast('Scraping stopped', 'info');
        
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================================
// COMPARE TABS
// ============================================================

async function loadTabsForCompare() {
    const workbookId = elements.compareWorkbookSelect.value;
    if (!workbookId) return;
    
    try {
        const result = await sendMessage('GET_TABS', { spreadsheetId: workbookId });
        
        if (result.success && result.tabs) {
            const tabOptions = result.tabs.map(tab => 
                `<option value="${tab.title}">${tab.title}</option>`
            ).join('');
            
            elements.compareTab1.innerHTML = `<option value="">Select...</option>${tabOptions}`;
            elements.compareTab2.innerHTML = `<option value="">Select...</option>${tabOptions}`;
        } else {
            throw new Error('Failed to load tabs');
        }
        
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function compareTabs() {
    const spreadsheetId = elements.compareWorkbookSelect.value;
    const tab1Name = elements.compareTab1.value;
    const tab2Name = elements.compareTab2.value;
    const outputTabName = elements.compareOutputName.value.trim();
    const keyColumn = parseInt(elements.compareKeyColumn.value);
    
    if (!spreadsheetId || !tab1Name || !tab2Name || !outputTabName) {
        showToast('Please fill in all fields', 'error');
        return;
    }
    
    setButtonLoading(elements.compareTabsBtn, true);
    
    try {
        const result = await sendMessage('COMPARE_TABS', {
            spreadsheetId,
            tab1Name,
            tab2Name,
            outputTabName,
            keyColumn
        });
        
        if (result.success) {
            elements.compareResults.classList.remove('hidden');
            elements.compareResults.classList.remove('error');
            elements.compareResults.innerHTML = `
                ✅ Found <strong>${result.newEntries}</strong> new entries<br>
                <small>Tab 1: ${result.tab1Count} | Tab 2: ${result.tab2Count}</small>
            `;
            showToast(`Found ${result.newEntries} new entries`, 'success');
        } else {
            throw new Error(result.error);
        }
        
    } catch (error) {
        elements.compareResults.classList.remove('hidden');
        elements.compareResults.classList.add('error');
        elements.compareResults.textContent = error.message;
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.compareTabsBtn, false);
    }
}

// ============================================================
// SCHEDULES
// ============================================================

let editingScheduleId = null;

function openScheduleModal(scheduleId = null) {
    editingScheduleId = scheduleId;
    
    // Update modal header
    const modalHeader = elements.scheduleModal?.querySelector('.modal-header h2');
    if (modalHeader) {
        modalHeader.textContent = scheduleId ? 'Edit Schedule' : 'Add Schedule';
    }
    
    // Reset form
    elements.scheduleSourceSelect.value = '';
    elements.scheduleDaySelect.value = '0';
    if (elements.scheduleFrequencySelect) {
        elements.scheduleFrequencySelect.value = 'weekly';
    }
    elements.scheduleHourSelect.value = '9';
    elements.scheduleMinuteSelect.value = '0';
    syncTimeInputToDropdowns(); // Sync the time input

    // Reset test mode UI
    elements.scheduleTestEnabled.checked = false;
    elements.scheduleTestOptions.classList.add('hidden');
    elements.scheduleTestMaxPages.value = '1';
    elements.scheduleTestSearchSelect.innerHTML = '';
    
    // If editing, populate form with existing schedule data
    if (scheduleId) {
        const schedule = state.schedules.find(s => s.id === scheduleId);
        if (schedule) {
            elements.scheduleSourceSelect.value = schedule.sourceName;
            elements.scheduleDaySelect.value = schedule.dayOfWeek.toString();
            if (elements.scheduleFrequencySelect) {
                const freq = schedule.frequency || 'weekly';
                if (freq === 'biweekly') {
                    elements.scheduleFrequencySelect.value =
                        schedule.weekPattern === 'odd' ? 'biweekly-odd' :
                        schedule.weekPattern === 'even' ? 'biweekly-even' :
                        'weekly';
                } else {
                    elements.scheduleFrequencySelect.value = 'weekly';
                }
            }
            elements.scheduleHourSelect.value = schedule.hour.toString();
            elements.scheduleMinuteSelect.value = schedule.minute.toString();
            syncTimeInputToDropdowns(); // Sync the time input with dropdown values

            // Populate test dropdown for the selected source, then select current value if present
            populateScheduleTestSearchDropdown(schedule.sourceName);
            elements.scheduleTestEnabled.checked = schedule.testEnabled === true;
            elements.scheduleTestOptions.classList.toggle('hidden', !elements.scheduleTestEnabled.checked);
            if (schedule.testMaxPages != null) {
                elements.scheduleTestMaxPages.value = String(schedule.testMaxPages);
            }
            if (schedule.testSearchUrl) {
                elements.scheduleTestSearchSelect.value = schedule.testSearchUrl;
            }
        }
    }

    // If adding new, pre-populate test dropdown once a source is chosen
    if (!scheduleId && elements.scheduleSourceSelect.value) {
        populateScheduleTestSearchDropdown(elements.scheduleSourceSelect.value);
    }
    
    elements.scheduleModal.classList.remove('hidden');
}

function closeScheduleModal() {
    elements.scheduleModal.classList.add('hidden');
    editingScheduleId = null;
}

async function saveSchedule() {
    const sourceName = elements.scheduleSourceSelect.value;
    const dayOfWeek = parseInt(elements.scheduleDaySelect.value);
    
    // Parse time from input field (preferred) or use dropdowns as fallback
    let hour, minute;
    const timeStr = elements.scheduleTimeInput.value.trim();
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    const match = timeStr.match(timeRegex);
    
    if (match) {
        // Time input has valid format
        hour = parseInt(match[1]);
        minute = parseInt(match[2]);
    } else {
        // Fallback to dropdowns
        hour = parseInt(elements.scheduleHourSelect.value) || 0;
        minute = parseInt(elements.scheduleMinuteSelect.value) || 0;
    }
    
    // Validate hour and minute
    if (hour < 0 || hour > 23) {
        showToast('Hour must be between 0 and 23', 'error');
        return;
    }
    if (minute < 0 || minute > 59) {
        showToast('Minute must be between 0 and 59', 'error');
        return;
    }
    
    if (!sourceName) {
        showToast('Please select a source', 'error');
        return;
    }
    
    setButtonLoading(elements.saveScheduleBtn, true);
    
    try {
        // If editing, include the existing schedule ID and preserve enabled state
        let scheduleData = { sourceName, dayOfWeek, hour, minute };

        // Frequency (Option A single dropdown)
        const val = elements.scheduleFrequencySelect?.value || 'weekly';
        const frequency = val === 'weekly' ? 'weekly' : 'biweekly';
        const weekPattern =
            val === 'biweekly-odd' ? 'odd' :
            val === 'biweekly-even' ? 'even' : null;

        scheduleData.frequency = frequency;
        scheduleData.weekPattern = weekPattern;

        // Optional test mode fields
        const testEnabled = elements.scheduleTestEnabled.checked === true;
        if (testEnabled) {
            const testSearchUrl = elements.scheduleTestSearchSelect.value || null;
            const selectedOpt = elements.scheduleTestSearchSelect.selectedOptions?.[0];
            const testSearchTitle = selectedOpt?.dataset?.title || selectedOpt?.textContent || null;
            const testMaxPagesRaw = elements.scheduleTestMaxPages.value;
            const testMaxPages = testMaxPagesRaw ? parseInt(testMaxPagesRaw, 10) : null;

            scheduleData.testEnabled = true;
            scheduleData.testSearchUrl = testSearchUrl;
            scheduleData.testSearchTitle = testSearchTitle;
            scheduleData.testMaxPages = Number.isFinite(testMaxPages) ? testMaxPages : null;
        } else {
            scheduleData.testEnabled = false;
            scheduleData.testSearchUrl = null;
            scheduleData.testSearchTitle = null;
            scheduleData.testMaxPages = null;
        }
        
        if (editingScheduleId) {
            const existingSchedule = state.schedules.find(s => s.id === editingScheduleId);
            if (existingSchedule) {
                scheduleData.id = editingScheduleId;
                scheduleData.enabled = existingSchedule.enabled; // Preserve enabled state
            }
        } else {
            scheduleData.enabled = true; // New schedules are enabled by default
        }
        
        await sendMessage('SET_SCHEDULE', {
            schedule: scheduleData
        });
        
        // Reload schedules
        const result = await sendMessage('GET_SCHEDULES');
        state.schedules = result.schedules || [];
        
        renderScheduleList();
        closeScheduleModal();
        
        showToast('Schedule saved', 'success');
        
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.saveScheduleBtn, false);
    }
}

async function toggleScheduleEnabled(scheduleId, enabled) {
    try {
        const schedule = state.schedules.find(s => s.id === scheduleId);
        if (schedule) {
            await sendMessage('SET_SCHEDULE', {
                schedule: { ...schedule, enabled }
            });
            schedule.enabled = enabled;
            renderScheduleList();
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteSchedule(scheduleId) {
    if (!confirm('Delete this schedule?')) return;
    
    try {
        await sendMessage('DELETE_SCHEDULE', { scheduleId });
        state.schedules = state.schedules.filter(s => s.id !== scheduleId);
        renderScheduleList();
        showToast('Schedule deleted', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ============================================================
// SETTINGS
// ============================================================

async function saveWebhookUrl() {
    const url = elements.webhookUrl.value.trim();
    
    try {
        await sendMessage('SET_WEBHOOK_URL', { url });
        showToast('Webhook URL saved', 'success');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function testWebhook() {
    setButtonLoading(elements.testWebhookBtn, true);
    
    try {
        const result = await sendMessage('TEST_WEBHOOK');
        
        if (result.success) {
            elements.webhookStatus.textContent = '✅ Webhook working';
            elements.webhookStatus.className = 'status-text text-success';
            showToast('Webhook test sent', 'success');
        } else {
            throw new Error(result.error || 'Test failed');
        }
        
    } catch (error) {
        elements.webhookStatus.textContent = '❌ ' + error.message;
        elements.webhookStatus.className = 'status-text text-error';
        showToast(error.message, 'error');
    } finally {
        setButtonLoading(elements.testWebhookBtn, false);
    }
}

// ============================================================
// QUEUE & HISTORY
// ============================================================

async function loadQueueStatus() {
    try {
        const status = await sendMessage('GET_QUEUE_STATUS');
        
        elements.queuePending.textContent = status.pending || 0;
        elements.queueFailed.textContent = status.failed || 0;
        
        if (status.failed > 0) {
            elements.queueFailedContainer.classList.remove('hidden');
        } else {
            elements.queueFailedContainer.classList.add('hidden');
        }
        
    } catch (error) {
        console.error(`${LOG} Error loading queue status:`, error);
    }
}

async function loadExecutionHistory() {
    try {
        const result = await sendMessage('GET_EXECUTION_HISTORY', { limit: 10 });
        const history = result.history || [];
        
        elements.historyTbody.innerHTML = '';
        
        history.forEach(record => {
            const row = document.createElement('tr');
            row.dataset.executionId = record.id; // Store execution ID for easy updates
            
            const profilesCount = record.profilesScraped || 0;
            
            // Create profiles cell with link if sheetUrl exists (even for running)
            let profilesCell = `${profilesCount}`;
            if (record.sheetUrl && profilesCount > 0) {
                profilesCell = `<a href="${record.sheetUrl}" target="_blank" class="sheet-link">${profilesCount}</a>`;
            }
            
            // Create source cell with link if sheetUrl exists (even for running)
            let sourceCell = record.sourceName;
            if (record.sheetUrl) {
                sourceCell = `<a href="${record.sheetUrl}" target="_blank" class="sheet-link">${record.sourceName}</a>`;
            }
            
            row.innerHTML = `
                <td>${formatDate(record.startedAt)}</td>
                <td>${sourceCell}</td>
                <td><span class="status-badge ${record.status}">${record.status}</span></td>
                <td class="profiles-count">${profilesCell}</td>
            `;
            elements.historyTbody.appendChild(row);
        });
        
    } catch (error) {
        console.error(`${LOG} Error loading history:`, error);
    }
}

async function retryFailed() {
    try {
        const result = await sendMessage('RETRY_FAILED');
        showToast(`Retrying ${result.retriedCount} items`, 'info');
        await loadQueueStatus();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deduplicate() {
    // For now, just show a message - would need active workbook context
    showToast('Select a workbook first', 'info');
}

// ============================================================
// MESSAGE LISTENERS
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
        case 'AUTO_RUN_PROGRESS':
        case 'MANUAL_SCRAPE_PROGRESS':
            if (message.progress) {
                const pct = Math.round(
                    (message.progress.completedSearches / message.progress.totalSearches) * 100
                );
                elements.progressFill.style.width = `${pct}%`;
                elements.progressText.textContent = 
                    `${message.progress.completedSearches}/${message.progress.totalSearches} searches`;
                
                // If completed, reset UI
                if (message.progress.completed) {
                    elements.startScrapeBtn.classList.remove('hidden');
                    elements.stopScrapeBtn.classList.add('hidden');
                    elements.statusIndicator.classList.remove('active');
                    loadQueueStatus();
                    loadExecutionHistory();
                }
            }
            break;
            
        case 'QUEUE_UPDATED':
            loadQueueStatus();
            break;
            
        case 'EXECUTION_HISTORY_UPDATED':
            loadExecutionHistory();
            break;
            
        case 'SCRAPING_COMPLETE':
            elements.startScrapeBtn.classList.remove('hidden');
            elements.stopScrapeBtn.classList.add('hidden');
            elements.statusIndicator.classList.remove('active');
            loadQueueStatus();
            loadExecutionHistory();
            break;
    }
});

