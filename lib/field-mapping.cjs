'use strict';

/**
 * Pure, side-effect-free mapping primitives.
 *
 * IMPORTANT: This module is not yet wired into plugin.js. The inherited plugin
 * runtime is disabled until safe Notion schema discovery, HTTP and credentials
 * are implemented. Never treat a conversion as permission to write to Notion.
 */

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function assertNonNegativeFinite(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new TypeError((label || 'value') + ' must be a finite, non-negative number');
    }
    return value;
}

function millisecondsFactor(unit) {
    if (unit === 'minutes') return MS_PER_MINUTE;
    if (unit === 'hours') return MS_PER_HOUR;
    throw new TypeError('Explicit time unit must be "minutes" or "hours"');
}

function notionNumberToMs(value, unit) {
    if (value === null || value === undefined) return null;
    return assertNonNegativeFinite(value, 'Notion duration') * millisecondsFactor(unit);
}

function millisecondsToNotionNumber(value, unit) {
    if (value === null || value === undefined) return null;
    return assertNonNegativeFinite(value, 'SP duration') / millisecondsFactor(unit);
}

function validDay(day) {
    if (typeof day !== 'string' || !DATE_ONLY.test(day)) return false;
    const [year, month, date] = day.split('-').map(Number);
    const d = new Date(Date.UTC(year, month - 1, date));
    return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === date;
}

/**
 * A Notion date-only value is a calendar date, NOT a UTC midnight timestamp.
 * A date/time value must carry timezone/offset to avoid ambiguous local parsing.
 * The result has mutually exclusive *Day and *WithTime fields.
 */
function notionDateToSpFields(notionDate, kind) {
    if (kind !== 'due' && kind !== 'deadline') {
        throw new TypeError('Date mapping kind must be "due" or "deadline"');
    }
    const day = kind === 'due' ? 'dueDay' : 'deadlineDay';
    const timestamp = kind === 'due' ? 'dueWithTime' : 'deadlineWithTime';
    const out = { [day]: null, [timestamp]: null };
    if (notionDate === null || notionDate === undefined) return out;
    if (typeof notionDate !== 'object' || typeof notionDate.start !== 'string') {
        throw new TypeError('Notion date requires a start');
    }
    if (notionDate.end) {
        throw new TypeError('A Notion date range needs an explicitly configured mapping');
    }
    if (validDay(notionDate.start)) {
        out[day] = notionDate.start;
        return out;
    }
    if (DATE_ONLY.test(notionDate.start)) {
        throw new TypeError('Invalid calendar date');
    }
    // RFC3339/ISO8601 with explicit offset or Z. Never assume the host timezone.
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(notionDate.start)) {
        throw new TypeError('Notion date/time must have an explicit UTC offset');
    }
    const parsed = Date.parse(notionDate.start);
    if (!Number.isFinite(parsed)) {
        throw new TypeError('Invalid Notion date/time');
    }
    out[timestamp] = parsed;
    return out;
}

/**
 * SP dates are also mutually exclusive: timed value takes precedence.
 * Serializes timed values as UTC ISO with unambiguous offset; no date-only drift.
 */
function spFieldsToNotionDate(task, kind) {
    if (!task || typeof task !== 'object') throw new TypeError('Task is required');
    if (kind !== 'due' && kind !== 'deadline') {
        throw new TypeError('Date mapping kind must be "due" or "deadline"');
    }
    const day = task[kind === 'due' ? 'dueDay' : 'deadlineDay'];
    const timestamp = task[kind === 'due' ? 'dueWithTime' : 'deadlineWithTime'];
    if (timestamp !== null && timestamp !== undefined) {
        assertNonNegativeFinite(timestamp, 'SP scheduled timestamp');
        return { start: new Date(timestamp).toISOString() };
    }
    if (day !== null && day !== undefined && day !== '') {
        if (!validDay(day)) throw new TypeError('Invalid SP calendar day');
        return { start: day };
    }
    return null;
}

/**
 * A target is a *target*, not a completed-session counter.
 */
function pomodoroTarget(estimateMs, workIntervalMinutes) {
    if (estimateMs === null || estimateMs === undefined) return null;
    assertNonNegativeFinite(estimateMs, 'Estimated work');
    if (typeof workIntervalMinutes !== 'number' || !Number.isFinite(workIntervalMinutes) || workIntervalMinutes <= 0) {
        throw new TypeError('Pomodoro work interval must be positive');
    }
    return Math.ceil(estimateMs / (workIntervalMinutes * MS_PER_MINUTE));
}

/**
 * Versioned session updates with the same ID are one logical session.
 * Work can be tracked even on interrupted sessions, but only completed
 * Pomodoro sessions increase the completed Pomodoro counter.
 *
 * Expects verified session facts from a future official SP plugin API.
 * This function does NOT infer focus sessions from task timeSpent.
 */
function summarizeFocusSessions(sessions, taskId) {
    if (!Array.isArray(sessions)) throw new TypeError('sessions must be an array');
    if (typeof taskId !== 'string' || !taskId.trim()) {
        throw new TypeError('taskId is required to prevent cross-task aggregation');
    }
    const latest = new Map();
    for (const row of sessions) {
        if (!row || !row.sessionId || row.taskId !== taskId) continue;
        if (!['Pomodoro', 'Flowtime', 'Countdown'].includes(row.mode)) continue;
        const key = String(row.sessionId);
        const previous = latest.get(key);
        const rank = Number.isFinite(row.revision) ? row.revision : 0;
        const prevRank = previous && Number.isFinite(previous.revision) ? previous.revision : 0;
        if (!previous || rank > prevRank || (rank === prevRank &&
            String(row.updatedAt || '') > String(previous.updatedAt || ''))) {
            latest.set(key, row);
        }
    }
    const summary = {
        uniqueSessions: latest.size,
        completedPomodoros: 0,
        completedFlowtimeSessions: 0,
        completedCountdownSessions: 0,
        interruptedSessions: 0,
        workTimeMs: 0,
        breakTimeMs: 0
    };
    for (const row of latest.values()) {
        summary.workTimeMs += assertNonNegativeFinite(row.workDurationMs || 0, 'workDurationMs');
        summary.breakTimeMs += assertNonNegativeFinite(row.breakDurationMs || 0, 'breakDurationMs');
        if (row.completed === true) {
            if (row.mode === 'Pomodoro') summary.completedPomodoros++;
            if (row.mode === 'Flowtime') summary.completedFlowtimeSessions++;
            if (row.mode === 'Countdown') summary.completedCountdownSessions++;
        } else if (row.interrupted === true) {
            summary.interruptedSessions++;
        }
    }
    return summary;
}

/** Stable identity used to upsert *one* habit occurrence per logical day. */
function habitOccurrenceKey(habitNotionPageId, logicalDay) {
    if (typeof habitNotionPageId !== 'string' || !habitNotionPageId.trim()) {
        throw new TypeError('Notion habit page ID is required');
    }
    if (!validDay(logicalDay)) {
        throw new TypeError('A valid YYYY-MM-DD logical day is required');
    }
    return habitNotionPageId.trim() + ':' + logicalDay;
}

module.exports = {
    MS_PER_MINUTE,
    MS_PER_HOUR,
    notionNumberToMs,
    millisecondsToNotionNumber,
    notionDateToSpFields,
    spFieldsToNotionDate,
    pomodoroTarget,
    summarizeFocusSessions,
    habitOccurrenceKey
};
