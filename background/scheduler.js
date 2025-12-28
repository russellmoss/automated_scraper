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

// ============================================================
// BIWEEKLY (ODD/EVEN WEEK-OF-MONTH) HELPERS
// ============================================================

/**
 * Week-of-month bucket by day-of-month ranges:
 *  - Week 1: 1-7
 *  - Week 2: 8-14
 *  - Week 3: 15-21
 *  - Week 4: 22-28
 *  - Week 5: 29-31
 * @param {Date} date
 * @returns {number} 1-5
 */
function getWeekOfMonthByDayBucket(date) {
    const day = date.getDate(); // 1..31
    return Math.floor((day - 1) / 7) + 1; // 1..5
}

/**
 * Odd/even week pattern for the schedule system.
 * Week 5 is treated as "odd" by design.
 * @param {Date} date
 * @returns {'odd'|'even'}
 */
function getOddEvenWeekPattern(date) {
    const week = getWeekOfMonthByDayBucket(date);
    return (week % 2 === 1) ? 'odd' : 'even';
}

function normalizeFrequency(raw) {
    return raw === 'biweekly' ? 'biweekly' : 'weekly';
}

function calculateNextRunWeekly(schedule, now) {
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

function calculateNextRunBiweekly(schedule, now) {
    const pattern = schedule.weekPattern;
    if (pattern !== 'odd' && pattern !== 'even') {
        // Never return null; fall back to weekly so UI still works.
        console.warn(`${LOG} Invalid biweekly weekPattern for ${schedule.sourceName || 'unknown'}; falling back to weekly`);
        return calculateNextRunWeekly(schedule, now);
    }

    // Start candidate at today at scheduled time
    const candidate = new Date(now);
    candidate.setHours(schedule.hour, schedule.minute, 0, 0);

    // If today's scheduled time has passed, start from tomorrow
    if (candidate <= now) {
        candidate.setDate(candidate.getDate() + 1);
        candidate.setHours(schedule.hour, schedule.minute, 0, 0);
    }

    // Search forward up to 62 days to safely cross month boundaries
    for (let i = 0; i < 62; i++) {
        if (candidate.getDay() === schedule.dayOfWeek) {
            const candidatePattern = getOddEvenWeekPattern(candidate);
            if (candidatePattern === pattern) {
                return candidate.toISOString();
            }
        }
        candidate.setDate(candidate.getDate() + 1);
        candidate.setHours(schedule.hour, schedule.minute, 0, 0);
    }

    // Fallback
    console.warn(`${LOG} Failed to find next biweekly run for ${schedule.sourceName || 'unknown'} within 62 days; falling back to weekly`);
    return calculateNextRunWeekly(schedule, now);
}

/**
 * Calculate next run time for a schedule
 * @param {Object} schedule - Schedule object
 * @returns {string} ISO string of next run time
 */
export function calculateNextRun(schedule) {
    const now = getEasternTime();
    const frequency = normalizeFrequency(schedule?.frequency);

    if (frequency === 'biweekly') {
        return calculateNextRunBiweekly(schedule, now);
    }

    return calculateNextRunWeekly(schedule, now);
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
/**
 * Get local enabled override for a schedule (per-instance, not synced)
 * @param {string} scheduleId - Schedule ID
 * @returns {Promise<boolean|null>} Override value (true/false) or null if no override
 */
async function getScheduleLocalOverride(scheduleId) {
    const { scheduleLocalOverrides } = await getFromStorage([STORAGE_KEYS.SCHEDULE_LOCAL_OVERRIDES]);
    const overrides = scheduleLocalOverrides || {};
    return overrides[scheduleId] !== undefined ? overrides[scheduleId] : null;
}

/**
 * Set local enabled override for a schedule (per-instance, not synced)
 * @param {string} scheduleId - Schedule ID
 * @param {boolean|null} enabled - Override value (true/false) or null to clear override
 * @returns {Promise<void>}
 */
export async function setScheduleLocalOverride(scheduleId, enabled) {
    const { scheduleLocalOverrides } = await getFromStorage([STORAGE_KEYS.SCHEDULE_LOCAL_OVERRIDES]);
    const overrides = scheduleLocalOverrides || {};
    
    if (enabled === null) {
        // Clear override
        delete overrides[scheduleId];
    } else {
        // Set override
        overrides[scheduleId] = enabled;
    }
    
    await saveToStorage({ [STORAGE_KEYS.SCHEDULE_LOCAL_OVERRIDES]: overrides });
}

/**
 * Get effective enabled state for a schedule (checks local override first)
 * @param {Object} schedule - Schedule object
 * @returns {Promise<boolean>} Effective enabled state
 */
export async function getEffectiveEnabled(schedule) {
    const localOverride = await getScheduleLocalOverride(schedule.id);
    return localOverride !== null ? localOverride : schedule.enabled;
}

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
    
    // Check if this is a sync operation (managedBy is set and enabled is being forced)
    const isSyncOperation = scheduleData.managedBy === 'workbookSync' && 
                            scheduleData.enabled !== undefined &&
                            existingIndex >= 0;
    
    if (existingIndex >= 0) {
        // Update existing - preserve local override if it exists during sync
        const existingSchedule = schedules[existingIndex];
        const localOverride = await getScheduleLocalOverride(scheduleData.id);
        
        // Check if this is a user toggle on a workbook-managed schedule
        // In that case, we should preserve the stored enabled value (workbook state)
        // and let the override handle the user's preference
        const isUserToggleOnManagedSchedule = !isSyncOperation && 
                                             existingSchedule.managedBy === 'workbookSync' &&
                                             scheduleData.enabled !== undefined &&
                                             scheduleData.enabled !== existingSchedule.enabled;
        
        // If syncing and there's a local override, don't overwrite the enabled state
        // If user is toggling a managed schedule, preserve the stored enabled value
        let effectiveEnabled = scheduleData.enabled !== undefined ? scheduleData.enabled : existingSchedule.enabled;
        if (isSyncOperation && localOverride !== null) {
            // Preserve local override - don't update enabled from sync
            effectiveEnabled = existingSchedule.enabled; // Keep existing, override will be applied in getEffectiveEnabled
            console.log(`${LOG} Preserving local override for ${existingSchedule.sourceName} (sync operation)`);
        } else if (isUserToggleOnManagedSchedule) {
            // User is toggling a workbook-managed schedule - preserve stored enabled value
            // The override will be set separately in the message handler
            effectiveEnabled = existingSchedule.enabled; // Keep workbook state, override handles user preference
            console.log(`${LOG} Preserving workbook state for ${existingSchedule.sourceName} (user toggle)`);
        }
        
        schedule = {
            ...existingSchedule,
            ...scheduleData,
            enabled: effectiveEnabled, // Store the base enabled state
            updatedAt: now,
            nextRun: calculateNextRun({ ...existingSchedule, ...scheduleData, enabled: effectiveEnabled })
        };
        schedules[existingIndex] = schedule;
        console.log(`${LOG} Updated schedule for ${schedule.sourceName}`);
    } else {
        // Create new
        const frequency = normalizeFrequency(scheduleData.frequency);
        const weekPattern = frequency === 'biweekly'
            ? (scheduleData.weekPattern === 'odd' || scheduleData.weekPattern === 'even' ? scheduleData.weekPattern : null)
            : null;

        schedule = {
            // Allow callers to supply a stable ID (required for workbook-managed schedules)
            id: scheduleData.id || generateId(),
            sourceName: scheduleData.sourceName,
            dayOfWeek: scheduleData.dayOfWeek,
            hour: scheduleData.hour,
            minute: scheduleData.minute || 0,
            frequency,
            weekPattern,
            enabled: scheduleData.enabled !== false,
            managedBy: scheduleData.managedBy || null,
            // Optional test-mode fields (for fast overlap testing)
            testEnabled: scheduleData.testEnabled === true,
            testSearchUrl: scheduleData.testSearchUrl || null,
            testSearchTitle: scheduleData.testSearchTitle || null,
            testMaxPages: typeof scheduleData.testMaxPages === 'number' ? scheduleData.testMaxPages : null,
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
 * Get pending schedules from queue
 * @returns {Promise<Array>} Pending schedules waiting to run
 */
export async function getPendingSchedules() {
    const { [STORAGE_KEYS.PENDING_SCHEDULES]: pending } = await getFromStorage([STORAGE_KEYS.PENDING_SCHEDULES]);
    return pending || [];
}

/**
 * Add schedule to pending queue
 * @param {Object} schedule - Schedule to queue
 * @returns {Promise<void>}
 */
export async function addPendingSchedule(schedule) {
    const pending = await getPendingSchedules();
    
    // Check if already in queue
    if (pending.some(s => s.id === schedule.id)) {
        console.log(`${LOG} Schedule ${schedule.sourceName} already in pending queue`);
        return;
    }
    
    pending.push({
        ...schedule,
        queuedAt: new Date().toISOString()
    });
    
    await saveToStorage({ [STORAGE_KEYS.PENDING_SCHEDULES]: pending });
    console.log(`${LOG} Queued schedule ${schedule.sourceName} (${pending.length} pending)`);
}

/**
 * Remove schedule from pending queue
 * @param {string} scheduleId - Schedule ID to remove
 * @returns {Promise<void>}
 */
export async function removePendingSchedule(scheduleId) {
    const pending = await getPendingSchedules();
    const filtered = pending.filter(s => s.id !== scheduleId);
    await saveToStorage({ [STORAGE_KEYS.PENDING_SCHEDULES]: filtered });
    console.log(`${LOG} Removed ${scheduleId} from pending queue (${filtered.length} remaining)`);
}

/**
 * Check which schedules should run NOW
 * Called every minute by the schedule-check alarm
 * Also checks pending schedules that were deferred
 * @param {boolean} includePending - If true, also check pending schedules
 * @param {string|null} runningSourceName - Source name that's currently running (to exclude)
 * @returns {Promise<Array>} Schedules that should execute
 */
export async function checkSchedules(includePending = true, runningSourceName = null) {
    const schedules = await getSchedules();
    const now = getEasternTime();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    const schedulesToRun = [];
    
    // Get pending schedule IDs to avoid duplicates
    // Always load pending so we can suppress re-trigger spam while something is already queued.
    const pending = await getPendingSchedules();
    const pendingIds = new Set(pending.map(s => s.id));
    
    // Check regular schedules
    for (const schedule of schedules) {
        // Check effective enabled state (includes local overrides)
        const effectiveEnabled = await getEffectiveEnabled(schedule);
        if (!effectiveEnabled) continue;
        
        // Skip if this schedule is currently running
        if (runningSourceName && schedule.sourceName === runningSourceName) {
            console.log(`${LOG} Skipping ${schedule.sourceName} - currently running`);
            continue;
        }
        
        // Skip if already in pending queue (avoid duplicates)
        if (pendingIds.has(schedule.id)) {
            continue;
        }
        
        // Check if day matches
        if (schedule.dayOfWeek !== currentDay) continue;

        // Frequency gating (weekly vs biweekly odd/even week-of-month)
        const frequency = normalizeFrequency(schedule.frequency);
        if (frequency === 'biweekly') {
            const pattern = schedule.weekPattern;
            if (pattern !== 'odd' && pattern !== 'even') {
                console.warn(`${LOG} Skipping ${schedule.sourceName} - invalid biweekly weekPattern`);
                continue;
            }

            const currentPattern = getOddEvenWeekPattern(now);
            if (pattern !== currentPattern) {
                continue;
            }
        }
        
        // Check if within 10-minute window of scheduled time (5 min before to 5 min after)
        const scheduledMinutes = schedule.hour * 60 + schedule.minute;
        const currentMinutes = currentHour * 60 + currentMinute;
        const diff = currentMinutes - scheduledMinutes;
        
        // Allow -5 to +10 minute window (5 min before to 10 min after scheduled time)
        // This accounts for service worker timing variations
        if (diff < -5 || diff > 10) continue;
        
        // Check if already ran recently
        // - Normal schedules: 23 hour cooldown (prevents repeat runs the same day)
        // - Test schedules: short cooldown (15 min) to allow overlap testing without waiting a full day
        if (schedule.lastRun) {
            const lastRunTime = new Date(schedule.lastRun);
            const hoursSinceLastRun = (now - lastRunTime) / (1000 * 60 * 60);
            const cooldownHours = schedule.testEnabled === true ? 0.25 : 23; // 15 min for test mode
            
            if (hoursSinceLastRun < cooldownHours) {
                const unit = cooldownHours < 1 ? 'minutes' : 'hours';
                const value = cooldownHours < 1 ? (hoursSinceLastRun * 60).toFixed(0) : hoursSinceLastRun.toFixed(1);
                console.log(`${LOG} Skipping ${schedule.sourceName} - ran ${value} ${unit} ago`);
                continue;
            }
        }
        
        console.log(`${LOG} ✅ Schedule triggered: ${schedule.sourceName}`);
        schedulesToRun.push(schedule);
    }
    
    // Check pending schedules (deferred due to overlap)
    if (includePending && pending.length > 0) {
        for (const pendingSchedule of pending) {
            // Remove the queuedAt field before adding
            const { queuedAt, ...schedule } = pendingSchedule;
            schedulesToRun.push(schedule);
            console.log(`${LOG} ✅ Pending schedule ready: ${schedule.sourceName}`);
        }
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

    // Frequency fields (optional; defaults to weekly)
    if (schedule.frequency != null) {
        if (schedule.frequency !== 'weekly' && schedule.frequency !== 'biweekly') {
            return { valid: false, error: "Frequency must be 'weekly' or 'biweekly'" };
        }
    }
    if ((schedule.frequency || 'weekly') === 'biweekly') {
        if (schedule.weekPattern !== 'odd' && schedule.weekPattern !== 'even') {
            return { valid: false, error: "Week pattern must be 'odd' or 'even' for biweekly schedules" };
        }
    }

    if (schedule.testEnabled === true) {
        if (schedule.testSearchUrl && typeof schedule.testSearchUrl !== 'string') {
            return { valid: false, error: 'Test search URL must be a string' };
        }
        if (schedule.testSearchUrl && !schedule.testSearchUrl.startsWith('https://www.linkedin.com/search/results/people')) {
            return { valid: false, error: 'Test search URL must be a LinkedIn people search URL' };
        }
        if (schedule.testMaxPages != null) {
            if (typeof schedule.testMaxPages !== 'number' || schedule.testMaxPages < 1 || schedule.testMaxPages > 10) {
                return { valid: false, error: 'Test max pages must be between 1 and 10' };
            }
        }
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

    const frequency = normalizeFrequency(schedule.frequency);
    if (frequency === 'biweekly') {
        const suffix =
            schedule.weekPattern === 'odd' ? '(1st & 3rd)' :
            schedule.weekPattern === 'even' ? '(2nd & 4th)' :
            '(Biweekly)';
        return `${day} at ${hour}:${minute} ${ampm} ${suffix}`;
    }

    return `${day} at ${hour}:${minute} ${ampm} (Weekly)`;
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
    
    // Filter by effective enabled state (includes local overrides)
    const enabled = [];
    for (const schedule of schedules) {
        const effectiveEnabled = await getEffectiveEnabled(schedule);
        if (effectiveEnabled) {
            enabled.push(schedule);
        }
    }
    
    if (enabled.length === 0) return null;
    
    // Sort by next run time
    enabled.sort((a, b) => new Date(a.nextRun) - new Date(b.nextRun));
    
    return {
        schedule: enabled[0],
        nextRun: enabled[0].nextRun
    };
}

