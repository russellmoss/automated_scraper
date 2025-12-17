// utils/constants.js - Shared constants

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
    WEBHOOK_TIMEOUT_MS: 10000
};

export const ALARM_NAMES = {
    KEEPALIVE: 'keepalive-alarm',
    QUEUE_PROCESS: 'queue-process-alarm',
    SCHEDULE_CHECK: 'schedule-check-alarm',
    AUTO_RUN_KEEPALIVE: 'auto-run-keepalive'
};

export const STORAGE_KEYS = {
    // Settings
    INPUT_SHEET_ID: 'inputSheetId',
    SAVED_WORKBOOKS: 'savedWorkbooks',
    SOURCE_MAPPING: 'sourceMapping',
    
    // Schedules (NEW)
    SCHEDULES: 'schedules',
    EXECUTION_HISTORY: 'executionHistory',
    
    // State
    SYNC_QUEUE: 'syncQueue',
    FAILED_ROWS: 'failedRows',
    AUTO_RUN_STATE: 'autoRunState',
    CURRENT_SEARCH_INDEX: 'searchIndex',
    DEDICATED_SCRAPE_TAB_ID: 'dedicatedScrapeTabId',
    
    // Notifications
    WEBHOOK_URL: 'webhookUrl',
    NOTIFICATION_SETTINGS: 'notificationSettings'
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
    GET_AUTO_RUN_STATUS: 'GET_AUTO_RUN_STATUS',
    AUTO_RUN_PROGRESS: 'AUTO_RUN_PROGRESS',
    
    // Scheduling (NEW)
    GET_SCHEDULES: 'GET_SCHEDULES',
    SET_SCHEDULE: 'SET_SCHEDULE',
    DELETE_SCHEDULE: 'DELETE_SCHEDULE',
    GET_EXECUTION_HISTORY: 'GET_EXECUTION_HISTORY',
    EXECUTION_HISTORY_UPDATED: 'EXECUTION_HISTORY_UPDATED',
    TRIGGER_SCHEDULED_RUN: 'TRIGGER_SCHEDULED_RUN',
    
    // Notifications (NEW)
    SET_WEBHOOK_URL: 'SET_WEBHOOK_URL',
    TEST_WEBHOOK: 'TEST_WEBHOOK',
    SEND_NOTIFICATION: 'SEND_NOTIFICATION',
    
    // Queue
    GET_QUEUE_STATUS: 'GET_QUEUE_STATUS',
    RETRY_FAILED: 'RETRY_FAILED',
    CLEAR_FAILED: 'CLEAR_FAILED',
    
    // Keep-alive
    START_KEEPALIVE: 'START_KEEPALIVE',
    STOP_KEEPALIVE: 'STOP_KEEPALIVE'
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
    SCHEDULE: '[SCHEDULE]',
    NOTIFY: '[NOTIFY]'
};

