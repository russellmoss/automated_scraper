// ============================================================
// CONSTANTS ADDITIONS FOR LIVE SHEET SYNC
// Add these to your existing utils/constants.js
// ============================================================

// ============================================================
// ADD TO EXISTING STORAGE_KEYS OBJECT
// ============================================================
/*
export const STORAGE_KEYS = {
    // ... your existing keys ...
    
    // NEW: Unified Workbook Config
    WORKBOOK_CONFIG: 'workbookConfig',
    SYNC_INTERVAL_MINUTES: 'syncIntervalMinutes',
    LAST_SYNC_CHANGES: 'lastSyncChanges',
};
*/

// ============================================================
// ADD TO EXISTING MESSAGE_ACTIONS OBJECT
// ============================================================
/*
export const MESSAGE_ACTIONS = {
    // ... your existing actions ...
    
    // NEW: Workbook Sync
    LOAD_WORKBOOK: 'LOAD_WORKBOOK',
    SYNC_WORKBOOK: 'SYNC_WORKBOOK',
    GET_WORKBOOK_CONFIG: 'GET_WORKBOOK_CONFIG',
    SET_SYNC_INTERVAL: 'SET_SYNC_INTERVAL',
    GET_SYNC_STATUS: 'GET_SYNC_STATUS',
    CLEAR_WORKBOOK: 'CLEAR_WORKBOOK',
};
*/

// ============================================================
// ADD TO EXISTING ALARM_NAMES OBJECT
// ============================================================
/*
export const ALARM_NAMES = {
    // ... your existing alarms ...
    
    // NEW: Workbook Sync
    WORKBOOK_SYNC: 'workbook-sync-alarm',
};
*/

// ============================================================
// COMPLETE UPDATED constants.js FILE
// (Copy this entire file to replace your existing one)
// ============================================================

export const CONFIG = {
    // Scraping timing (anti-detection)
    MIN_WAIT_SECONDS: 5,
    MAX_WAIT_SECONDS: 8,
    SCROLL_WAIT_MS: 2000,
    MAX_PAGES: 1000,
    
    // Queue processing
    QUEUE_PROCESS_INTERVAL_MINUTES: 0.5,  // 30 seconds
    KEEPALIVE_INTERVAL_MINUTES: 0.4,      // 24 seconds
    MAX_RETRIES: 5,
    BASE_DELAY_MS: 2000,
    
    // Schedule execution
    SCHEDULE_CHECK_INTERVAL_MINUTES: 1,    // Check every minute
    
    // Notifications
    WEBHOOK_TIMEOUT_MS: 10000,
    
    // NEW: Sync defaults
    DEFAULT_SYNC_INTERVAL_MINUTES: 5,
};

export const ALARM_NAMES = {
    KEEPALIVE: 'keepalive-alarm',
    QUEUE_PROCESS: 'queue-process-alarm',
    SCHEDULE_CHECK: 'schedule-check-alarm',
    AUTO_RUN_KEEPALIVE: 'auto-run-keepalive',
    
    // NEW: Workbook Sync
    WORKBOOK_SYNC: 'workbook-sync-alarm',
};

export const STORAGE_KEYS = {
    // Settings
    INPUT_SHEET_ID: 'inputSheetId',
    SAVED_WORKBOOKS: 'savedWorkbooks',
    SOURCE_MAPPING: 'sourceMapping',
    
    // Schedules
    SCHEDULES: 'schedules',
    EXECUTION_HISTORY: 'executionHistory',
    PENDING_SCHEDULES: 'pendingSchedules',
    
    // State
    SYNC_QUEUE: 'syncQueue',
    FAILED_ROWS: 'failedRows',
    AUTO_RUN_STATE: 'autoRunState',
    CURRENT_SEARCH_INDEX: 'searchIndex',
    DEDICATED_SCRAPE_TAB_ID: 'dedicatedScrapeTabId',
    MANUAL_SCRAPE_STATE: 'manualScrapeState',
    
    // Notifications
    WEBHOOK_URL: 'webhookUrl',
    NOTIFICATION_SETTINGS: 'notificationSettings',
    
    // NEW: Unified Workbook Config
    WORKBOOK_CONFIG: 'workbookConfig',
    SYNC_INTERVAL_MINUTES: 'syncIntervalMinutes',
    LAST_SYNC_CHANGES: 'lastSyncChanges',
};

export const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export const HEADERS_ROW = [
    'Date',
    'Name', 
    'Title',
    'Location',
    'Connection Source',
    'LinkedIn URL',
    'Accreditation 1',
    'Accreditation 2',
    'Accreditation 3',
    'Accreditation 4',
    'Accreditation 5',
    'Accreditation 6'
];

export const MESSAGE_ACTIONS = {
    // Scraping
    START_SCRAPING: 'START_SCRAPING',
    STOP_SCRAPING: 'STOP_SCRAPING',
    START_MANUAL_SCRAPE: 'START_MANUAL_SCRAPE',
    STOP_MANUAL_SCRAPE: 'STOP_MANUAL_SCRAPE',
    CHECK_LINKEDIN_AUTH: 'CHECK_LINKEDIN_AUTH',
    MANUAL_SCRAPE_PROGRESS: 'MANUAL_SCRAPE_PROGRESS',
    DATA_SCRAPED: 'DATA_SCRAPED',
    SCRAPING_COMPLETE: 'SCRAPING_COMPLETE',
    SCRAPE_ERROR: 'SCRAPE_ERROR',
    GET_STATUS: 'GET_STATUS',
    PING: 'PING',
    
    // Sheets
    LOAD_INPUT_SHEET: 'LOAD_INPUT_SHEET',
    GET_INPUT_SHEET_INFO: 'GET_INPUT_SHEET_INFO',
    GET_SEARCHES: 'GET_SEARCHES',
    ENSURE_WEEKLY_TAB: 'ENSURE_WEEKLY_TAB',
    GET_TABS: 'GET_TABS',
    COMPARE_TABS: 'COMPARE_TABS',
    DEDUPLICATE: 'DEDUPLICATE',
    
    // Workbooks
    ADD_WORKBOOK: 'ADD_WORKBOOK',
    REMOVE_WORKBOOK: 'REMOVE_WORKBOOK',
    GET_WORKBOOKS: 'GET_WORKBOOKS',
    SET_SOURCE_MAPPING: 'SET_SOURCE_MAPPING',
    GET_SOURCE_MAPPING: 'GET_SOURCE_MAPPING',
    
    // Auto-run
    START_AUTO_RUN: 'START_AUTO_RUN',
    STOP_AUTO_RUN: 'STOP_AUTO_RUN',
    GET_AUTO_RUN_STATE: 'GET_AUTO_RUN_STATE',
    AUTO_RUN_PROGRESS: 'AUTO_RUN_PROGRESS',
    
    // Queue
    GET_QUEUE_STATUS: 'GET_QUEUE_STATUS',
    RETRY_FAILED: 'RETRY_FAILED',
    CLEAR_FAILED: 'CLEAR_FAILED',
    
    // Schedules
    GET_SCHEDULES: 'GET_SCHEDULES',
    SET_SCHEDULE: 'SET_SCHEDULE',
    DELETE_SCHEDULE: 'DELETE_SCHEDULE',
    TRIGGER_SCHEDULED_RUN: 'TRIGGER_SCHEDULED_RUN',
    GET_EXECUTION_HISTORY: 'GET_EXECUTION_HISTORY',
    
    // Notifications
    SET_WEBHOOK_URL: 'SET_WEBHOOK_URL',
    GET_WEBHOOK_URL: 'GET_WEBHOOK_URL',
    TEST_WEBHOOK: 'TEST_WEBHOOK',
    
    // NEW: Workbook Sync
    LOAD_WORKBOOK: 'LOAD_WORKBOOK',
    SYNC_WORKBOOK: 'SYNC_WORKBOOK',
    GET_WORKBOOK_CONFIG: 'GET_WORKBOOK_CONFIG',
    SET_SYNC_INTERVAL: 'SET_SYNC_INTERVAL',
    GET_SYNC_STATUS: 'GET_SYNC_STATUS',
    CLEAR_WORKBOOK: 'CLEAR_WORKBOOK',
};

export const SCHEDULE_DAYS = [
    'Sunday',
    'Monday', 
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday'
];

export const LOG_PREFIXES = {
    SERVICE_WORKER: '[SW]',
    CONTENT_SCRIPT: '[CS]',
    POPUP: '[POPUP]',
    SHEETS: '[SHEETS]',
    QUEUE: '[QUEUE]',
    SCHEDULE: '[SCHED]',
    AUTH: '[AUTH]',
    NOTIFY: '[NOTIFY]',
    SYNC: '[SYNC]'  // NEW
};

// NEW: Sync Configuration
export const SYNC_CONFIG = {
    DEFAULT_INTERVAL_MINUTES: 5,
    MIN_INTERVAL_MINUTES: 1,
    MAX_INTERVAL_MINUTES: 60,
    SEARCHES_TAB_NAME: 'Searches',
    MAPPINGS_TAB_NAME: 'Mapping and Schedules',
    SEARCHES_RANGE: 'A:C',
    MAPPINGS_RANGE: 'A:H',
};
