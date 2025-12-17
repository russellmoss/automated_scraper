// background/scheduler.js - Per-Source Scheduling System

import { STORAGE_KEYS, LOG_PREFIXES } from '../utils/constants.js';
import { getSheetTabs } from './sheets_api.js';

const LOG = LOG_PREFIXES.SCHEDULE;

// Day names for logging
const SCHEDULE_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ============================================================
// STORAGE HELPERS
// ============================================================

async function getFromStorage(keys) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(keys, (result) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(result);
            }
        });
    });
}

async function saveToStorage(data) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set(data, () => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve();
            }
        });
    });
}

// ============================================================
// TIME UTILITIES
// ============================================================

/**
 * Get current time in Eastern Time
 * @returns {Date} Current time in ET
 */
function getEasternTime() {
    const now = new Date();
    return new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
}

/**
 * Calculate next run time for a schedule
 * @param {Object} schedule - Schedule object
 * @returns {string} ISO string of next run time
 */
export function calculateNextRun(schedule) {
    const now = getEasternTime();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    let daysUntilRun = schedule.dayOfWeek - currentDay;
    
    // If same day, check if time has passed
    if (daysUntilRun === 0) {
        const scheduledMinutes = schedule.hour * 60 + schedule.minute;
        const currentMinutes = currentHour * 60 + currentMinute;
        
        if (currentMinutes >= scheduledMinutes) {
            // Time passed today, schedule for next week
            daysUntilRun = 7;
        }
    } else if (daysUntilRun < 0) {
        // Day already passed this week
        daysUntilRun += 7;
    }
    
    const nextRun = new Date(now);
    nextRun.setDate(nextRun.getDate() + daysUntilRun);
    nextRun.setHours(schedule.hour, schedule.minute, 0, 0);
    
    return nextRun.toISOString();
}

/**
 * Generate UUID for schedule/execution IDs
 */
function generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ============================================================
// SCHEDULE MANAGEMENT
// ============================================================

/**
 * Get all schedules
 * @returns {Promise<Array>} Array of schedule objects
 */
export async function getSchedules() {
    const { schedules } = await getFromStorage([STORAGE_KEYS.SCHEDULES]);
    return schedules || [];
}

/**
 * Create or update a schedule
 * @param {Object} scheduleData - Schedule data (id optional for new)
 * @returns {Promise<Object>} Created/updated schedule
 */
export async function setSchedule(scheduleData) {
    const schedules = await getSchedules();
    const now = new Date().toISOString();
    
    let schedule;
    const existingIndex = schedules.findIndex(s => s.id === scheduleData.id);
    
    if (existingIndex >= 0) {
        // Update existing
        schedule = {
            ...schedules[existingIndex],
            ...scheduleData,
            updatedAt: now,
            nextRun: calculateNextRun({ ...schedules[existingIndex], ...scheduleData })
        };
        schedules[existingIndex] = schedule;
        console.log(`${LOG} Updated schedule for ${schedule.sourceName}`);
    } else {
        // Create new
        schedule = {
            id: generateId(),
            sourceName: scheduleData.sourceName,
            dayOfWeek: scheduleData.dayOfWeek,
            hour: scheduleData.hour,
            minute: scheduleData.minute || 0,
            enabled: scheduleData.enabled !== false,
            lastRun: null,
            createdAt: now,
            updatedAt: now
        };
        schedule.nextRun = calculateNextRun(schedule);
        schedules.push(schedule);
        console.log(`${LOG} Created schedule for ${schedule.sourceName}: ${SCHEDULE_DAYS[schedule.dayOfWeek]} at ${schedule.hour}:${String(schedule.minute).padStart(2, '0')}`);
    }
    
    await saveToStorage({ [STORAGE_KEYS.SCHEDULES]: schedules });
    return schedule;
}

/**
 * Delete a schedule
 * @param {string} scheduleId - Schedule ID to delete
 * @returns {Promise<boolean>} Success
 */
export async function deleteSchedule(scheduleId) {
    const schedules = await getSchedules();
    const filtered = schedules.filter(s => s.id !== scheduleId);
    
    if (filtered.length === schedules.length) {
        console.warn(`${LOG} Schedule ${scheduleId} not found`);
        return false;
    }
    
    await saveToStorage({ [STORAGE_KEYS.SCHEDULES]: filtered });
    console.log(`${LOG} Deleted schedule ${scheduleId}`);
    return true;
}

/**
 * Get schedule for a specific source
 * @param {string} sourceName - Source connection name
 * @returns {Promise<Object|null>} Schedule or null
 */
export async function getScheduleForSource(sourceName) {
    const schedules = await getSchedules();
    return schedules.find(s => s.sourceName === sourceName) || null;
}

// ============================================================
// SCHEDULE CHECKING
// ============================================================

/**
 * Check which schedules should run NOW
 * Called every minute by the schedule-check alarm
 * @returns {Promise<Array>} Schedules that should execute
 */
export async function checkSchedules() {
    const schedules = await getSchedules();
    const now = getEasternTime();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    const schedulesToRun = [];
    
    for (const schedule of schedules) {
        if (!schedule.enabled) continue;
        
        // Check if day matches
        if (schedule.dayOfWeek !== currentDay) continue;
        
        // Check if within 5-minute window of scheduled time
        const scheduledMinutes = schedule.hour * 60 + schedule.minute;
        const currentMinutes = currentHour * 60 + currentMinute;
        const diff = currentMinutes - scheduledMinutes;
        
        // Allow 0-5 minute window (just after scheduled time)
        if (diff < 0 || diff > 5) continue;
        
        // Check if already ran recently (within 23 hours)
        if (schedule.lastRun) {
            const lastRunTime = new Date(schedule.lastRun);
            const hoursSinceLastRun = (now - lastRunTime) / (1000 * 60 * 60);
            
            if (hoursSinceLastRun < 23) {
                console.log(`${LOG} Skipping ${schedule.sourceName} - ran ${hoursSinceLastRun.toFixed(1)} hours ago`);
                continue;
            }
        }
        
        console.log(`${LOG} ✅ Schedule triggered: ${schedule.sourceName}`);
        schedulesToRun.push(schedule);
    }
    
    return schedulesToRun;
}

/**
 * Mark schedule as having run
 * @param {string} scheduleId - Schedule ID
 * @param {string} executionId - Execution record ID
 */
export async function markScheduleRun(scheduleId, executionId) {
    const schedules = await getSchedules();
    const index = schedules.findIndex(s => s.id === scheduleId);
    
    if (index >= 0) {
        const now = new Date().toISOString();
        schedules[index].lastRun = now;
        schedules[index].nextRun = calculateNextRun(schedules[index]);
        schedules[index].lastExecutionId = executionId;
        
        await saveToStorage({ [STORAGE_KEYS.SCHEDULES]: schedules });
        console.log(`${LOG} Marked ${schedules[index].sourceName} as run, next: ${schedules[index].nextRun}`);
    }
}

// ============================================================
// EXECUTION HISTORY
// ============================================================

const MAX_HISTORY_RECORDS = 100;

/**
 * Generate Google Sheets URL with tab GID
 * @param {string} spreadsheetId - Spreadsheet ID
 * @param {string} tabName - Tab name
 * @returns {Promise<string|null>} URL with GID or null if tab not found
 */
export async function generateSheetUrlWithGid(spreadsheetId, tabName) {
    if (!spreadsheetId || !tabName) {
        return null;
    }
    
    try {
        const tabs = await getSheetTabs(spreadsheetId);
        const tab = tabs.find(t => t.title === tabName);
        
        if (!tab || !tab.sheetId) {
            // If tab not found, return URL without GID
            return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
        }
        
        // Google Sheets URL format with GID
        return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=${tab.sheetId}#gid=${tab.sheetId}`;
    } catch (error) {
        console.error(`${LOG} Error generating sheet URL:`, error);
        // Fallback to URL without GID
        return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
    }
}

/**
 * Get execution history
 * @param {number} limit - Max records to return
 * @returns {Promise<Array>} Execution records, newest first
 */
export async function getExecutionHistory(limit = 50) {
    const { executionHistory } = await getFromStorage([STORAGE_KEYS.EXECUTION_HISTORY]);
    const history = executionHistory || [];
    
    // Sort by startedAt descending (newest first)
    history.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    
    return history.slice(0, limit);
}

/**
 * Add new execution record
 * @param {Object} record - Execution record data
 * @returns {Promise<Object>} Created record with ID
 */
export async function addExecutionRecord(record) {
    const history = await getExecutionHistory(MAX_HISTORY_RECORDS);
    
    const execution = {
        id: generateId(),
        scheduleId: record.scheduleId,
        sourceName: record.sourceName,
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: 'running',
        searchesCompleted: 0,
        totalSearches: record.totalSearches || 0,
        profilesScraped: 0,
        error: null,
        workbookId: record.workbookId || null,
        tabName: record.tabName || null
    };
    
    history.unshift(execution);
    
    // Trim to max records
    const trimmed = history.slice(0, MAX_HISTORY_RECORDS);
    await saveToStorage({ [STORAGE_KEYS.EXECUTION_HISTORY]: trimmed });
    
    console.log(`${LOG} Started execution ${execution.id} for ${execution.sourceName}`);
    return execution;
}

/**
 * Update execution record
 * @param {string} executionId - Execution ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object|null>} Updated record or null
 */
export async function updateExecutionRecord(executionId, updates) {
    const { executionHistory } = await getFromStorage([STORAGE_KEYS.EXECUTION_HISTORY]);
    const history = executionHistory || [];
    
    const index = history.findIndex(e => e.id === executionId);
    if (index === -1) {
        console.warn(`${LOG} Execution ${executionId} not found`);
        return null;
    }
    
    history[index] = { ...history[index], ...updates };
    
    // If completing, set completedAt
    if (updates.status && updates.status !== 'running' && !history[index].completedAt) {
        history[index].completedAt = new Date().toISOString();
    }
    
    await saveToStorage({ [STORAGE_KEYS.EXECUTION_HISTORY]: history });
    
    console.log(`${LOG} Updated execution ${executionId}: ${updates.status || 'progress'}`);
    return history[index];
}

// ============================================================
// SCHEDULE VALIDATION
// ============================================================

/**
 * Validate schedule data before saving
 * @param {Object} schedule - Schedule to validate
 * @returns {{valid: boolean, error?: string}}
 */
export function validateSchedule(schedule) {
    if (!schedule.sourceName || schedule.sourceName.trim() === '') {
        return { valid: false, error: 'Source name is required' };
    }
    
    if (typeof schedule.dayOfWeek !== 'number' || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6) {
        return { valid: false, error: 'Day of week must be 0-6 (Sunday-Saturday)' };
    }
    
    if (typeof schedule.hour !== 'number' || schedule.hour < 0 || schedule.hour > 23) {
        return { valid: false, error: 'Hour must be 0-23' };
    }
    
    if (typeof schedule.minute !== 'number' || schedule.minute < 0 || schedule.minute > 59) {
        return { valid: false, error: 'Minute must be 0-59' };
    }
    
    return { valid: true };
}

/**
 * Get human-readable schedule description
 * @param {Object} schedule - Schedule object
 * @returns {string} e.g., "Monday at 2:30 AM"
 */
export function getScheduleDescription(schedule) {
    const day = SCHEDULE_DAYS[schedule.dayOfWeek];
    const hour = schedule.hour % 12 || 12;
    const ampm = schedule.hour < 12 ? 'AM' : 'PM';
    const minute = String(schedule.minute).padStart(2, '0');
    return `${day} at ${hour}:${minute} ${ampm}`;
}

/**
 * Get all sources that have schedules
 * @returns {Promise<string[]>} Array of source names
 */
export async function getScheduledSources() {
    const schedules = await getSchedules();
    return [...new Set(schedules.map(s => s.sourceName))];
}

/**
 * Get next upcoming scheduled run across all schedules
 * @returns {Promise<{schedule: Object, nextRun: string} | null>}
 */
export async function getNextScheduledRun() {
    const schedules = await getSchedules();
    const enabled = schedules.filter(s => s.enabled);
    
    if (enabled.length === 0) return null;
    
    // Sort by next run time
    enabled.sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun));
    
    return {
        schedule: enabled[0],
        nextRun: enabled[0].nextRun
    };
}

