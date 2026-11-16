'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const map = require('../lib/field-mapping.cjs');

test('duration conversion is unit-explicit and lossless for ordinary values', () => {
    assert.equal(map.notionNumberToMs(1.5, 'hours'), 5400000);
    assert.equal(map.notionNumberToMs(15, 'minutes'), 900000);
    assert.equal(map.millisecondsToNotionNumber(900000, 'minutes'), 15);
    assert.equal(map.millisecondsToNotionNumber(5400000, 'hours'), 1.5);
    assert.equal(map.notionNumberToMs(0, 'minutes'), 0);
    assert.equal(map.notionNumberToMs(null, 'hours'), null);
    assert.throws(() => map.notionNumberToMs(-3, 'hours'), /non-negative/);
    assert.throws(() => map.notionNumberToMs(3, 'seconds'), /Explicit time unit/);
});

test('date-only execution day stays a calendar day, independent of deadline', () => {
    assert.deepEqual(map.notionDateToSpFields({ start: '2026-11-16' }, 'due'), {
        dueDay: '2026-11-16', dueWithTime: null
    });
    assert.deepEqual(map.notionDateToSpFields({ start: '2026-12-01' }, 'deadline'), {
        deadlineDay: '2026-12-01', deadlineWithTime: null
    });
    assert.deepEqual(map.spFieldsToNotionDate({
        dueDay: '2026-11-16',
        deadlineDay: '2026-12-01'
    }, 'due'), { start: '2026-11-16' });
    assert.deepEqual(map.spFieldsToNotionDate({
        dueDay: '2026-11-16',
        deadlineDay: '2026-12-01'
    }, 'deadline'), { start: '2026-12-01' });
});

test('a timed Notion date creates timestamp field and clears day field', () => {
    const date = { start: '2026-11-16T12:30:00+02:00' };
    const result = map.notionDateToSpFields(date, 'due');
    assert.deepEqual(result, {
        dueDay: null,
        dueWithTime: Date.parse('2026-11-16T10:30:00Z')
    });
    assert.deepEqual(map.spFieldsToNotionDate(result, 'due'), {
        start: '2026-11-16T10:30:00.000Z'
    });
});

test('reject invalid calendar days, ranges and ambiguous timestamps', () => {
    assert.throws(() => map.notionDateToSpFields({ start: '2026-02-30' }, 'due'), /Invalid calendar date/);
    assert.throws(() => map.notionDateToSpFields({
        start: '2026-11-16', end: '2026-11-20'
    }, 'due'), /range needs/);
    assert.throws(() => map.notionDateToSpFields({
        start: '2026-11-16T12:30:00'
    }, 'due'), /explicit UTC offset/);
    assert.throws(() => map.notionDateToSpFields({ start: '2026-11-16' }, 'other'), /mapping kind/);
});

test('planned Pomodoros are not actual completed sessions', () => {
    assert.equal(map.pomodoroTarget(120 * 60000, 25), 5);
    assert.equal(map.pomodoroTarget(0, 25), 0);
    assert.equal(map.pomodoroTarget(null, 25), null);
    assert.throws(() => map.pomodoroTarget(60000, 0), /positive/);
});

test('focus sessions count completed Pomodoros only once across devices', () => {
    const rows = [
        { sessionId: 'a', taskId: 'task1', mode: 'Pomodoro', revision: 1,
          completed: true, workDurationMs: 1500000, breakDurationMs: 300000 },
        { sessionId: 'a', taskId: 'task1', mode: 'Pomodoro', revision: 1,
          completed: true, workDurationMs: 1500000, breakDurationMs: 300000 }, // duplicate from second device
        { sessionId: 'b', taskId: 'task1', mode: 'Pomodoro', revision: 1,
          completed: false, interrupted: true, workDurationMs: 300000, breakDurationMs: 0 },
        { sessionId: 'c', taskId: 'task1', mode: 'Flowtime', revision: 1,
          completed: true, workDurationMs: 600000, breakDurationMs: 0 },
        { sessionId: 'd', taskId: 'other-task', mode: 'Pomodoro', revision: 1,
          completed: true, workDurationMs: 1500000, breakDurationMs: 0 }
    ];
    assert.deepEqual(map.summarizeFocusSessions(rows, 'task1'), {
        uniqueSessions: 3,
        completedPomodoros: 1,
        completedFlowtimeSessions: 1,
        completedCountdownSessions: 0,
        interruptedSessions: 1,
        workTimeMs: 2400000,
        breakTimeMs: 300000
    });
});

test('later session revision takes precedence over stale completed state', () => {
    const rows = [
        { sessionId: 'a', taskId: 't', mode: 'Pomodoro', revision: 1,
          completed: true, workDurationMs: 1500000 },
        { sessionId: 'a', taskId: 't', mode: 'Pomodoro', revision: 2,
          completed: false, interrupted: true, workDurationMs: 900000 }
    ];
    const result = map.summarizeFocusSessions(rows, 't');
    assert.equal(result.completedPomodoros, 0);
    assert.equal(result.interruptedSessions, 1);
    assert.equal(result.workTimeMs, 900000);
});

test('habit execution key uses original Notion ID and logical execution day', () => {
    assert.equal(
        map.habitOccurrenceKey('habit-id', '2026-11-16'),
        map.habitOccurrenceKey('habit-id', '2026-11-16')
    );
    assert.notEqual(
        map.habitOccurrenceKey('habit-id', '2026-11-16'),
        map.habitOccurrenceKey('habit-id', '2026-11-17')
    );
    assert.throws(() => map.habitOccurrenceKey('', '2026-11-16'), /habit page ID/);
    assert.throws(() => map.habitOccurrenceKey('habit-id', '2026-11-31'), /valid/);
});
