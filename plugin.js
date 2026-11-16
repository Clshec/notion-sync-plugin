// Alf Notion Super Productivity — action-observed focus sessions (alpha).
// No Notion writes, no timer control, no background polling.
// Only sessions whose start AND completion were seen with an unambiguous
// task and mode are recorded. No historical backfill is possible.
// Original MIT copyright remains in LICENSE (Alessio Lovato).
'use strict';

const ALF_FOCUS_KEY_PREFIX = 'alf-focus-observed-v1-';
const ALF_FOCUS_MODES = ['Pomodoro', 'Flowtime', 'Countdown'];
const ALF_ACTIONS = {
  mode: '[FocusMode] Set Mode',
  start: '[FocusMode] Start Session',
  complete: '[FocusMode] Complete Session',
  cancel: '[FocusMode] Cancel Session',
  endFlowtime: '[FocusMode] End Flowtime Session'
};

function alfValidMode(value) {
  return ALF_FOCUS_MODES.indexOf(value) !== -1;
}

function alfInitialFocusMode() {
  try {
    // The host stores its most recently selected focus mode under this key.
    // Do not infer a mode if the host lacks this local setting.
    const cached = localStorage.getItem('FOCUS_MODE_MODE');
    return alfValidMode(cached) ? cached : null;
  } catch (_) {
    return null;
  }
}

function alfGenerateFocusId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for older JS runtimes. Not proof against duplicate remote
  // actions; store one record per observed session and do not replay action.
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function alfCreateFocusObserver(api, options) {
  const opts = options || {};
  const time = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const generate = typeof opts.id === 'function' ? opts.id : alfGenerateFocusId;

  let mode = alfValidMode(opts.initialMode) ? opts.initialMode : null;
  let trackedTaskId = null;
  let active = null;
  let rejectedSessions = 0;

  function current() {
    return { mode, trackedTaskId, active, rejectedSessions };
  }

  function onCurrentTaskChange(change) {
    trackedTaskId = change && change.current && typeof change.current.id === 'string'
      ? change.current.id
      : null;
    // A focus session with a changing tracked task is ambiguous. Never attach
    // a session's end to a different task than its observed start.
    if (active && active.taskId !== trackedTaskId) {
      active = null;
      rejectedSessions++;
    }
  }

  async function onAction(payload) {
    const action = payload && payload.action;
    if (!action || typeof action.type !== 'string') return null;
    switch (action.type) {
      case ALF_ACTIONS.mode:
        if (active) {
          active = null;
          rejectedSessions++;
        }
        mode = alfValidMode(action.mode) ? action.mode : null;
        return null;

      case ALF_ACTIONS.start: {
        // Never claim to observe a session that began before this plugin
        // activated. A replacement start invalidates the previous observer.
        if (active) rejectedSessions++;
        active = null;
        const taskId = typeof action.taskId === 'string' && action.taskId.trim()
          ? action.taskId
          : trackedTaskId;
        if (!alfValidMode(mode) || !taskId) {
          rejectedSessions++;
          return null;
        }
        active = {
          sessionId: generate(),
          taskId,
          mode,
          startedAt: time()
        };
        return null;
      }

      case ALF_ACTIONS.cancel:
        if (active) rejectedSessions++;
        active = null;
        return null;

      case ALF_ACTIONS.complete: {
        if (!active) return null;
        const started = active;
        active = null;
        const endedAt = time();
        if (endedAt < started.startedAt) {
          rejectedSessions++;
          return null;
        }
        const manual = action.isManual === true;
        // The only counted completed Pomodoro is one with an explicit
        // automatic completion action, never a manual or unknown ending.
        const verifiedCompletedPomodoro =
          started.mode === 'Pomodoro' && action.isManual === false;
        const duration = typeof action.completedDuration === 'number' &&
          Number.isFinite(action.completedDuration) &&
          action.completedDuration >= 0
          ? action.completedDuration
          : null;
        const record = {
          schemaVersion: 1,
          sessionId: started.sessionId,
          taskId: started.taskId,
          mode: started.mode,
          startedAt: started.startedAt,
          endedAt,
          observedCompletion: true,
          automatic: action.isManual === false,
          manual,
          verifiedCompletedPomodoro,
          completedDurationMs: duration,
          durationSource: duration !== null ? 'focus-action' : 'unavailable',
          source: 'live-sp-action-hook'
        };
        // Keyed, one record per session; does not write to Notion. The host's
        // Supersync may replicate these records, so do not increment totals
        // on remote dataChanged: counts must be derived from unique IDs.
        await api.persistDataSynced(
          JSON.stringify(record),
          ALF_FOCUS_KEY_PREFIX + record.sessionId
        );
        return record;
      }

      default:
        return null;
    }
  }

  return { current, onCurrentTaskChange, onAction };
}

if (typeof PluginAPI !== 'undefined') {
  PluginAPI.registerHeaderButton({
    label: 'Alf Notion',
    icon: 'view_list',
    onClick: () => PluginAPI.showIndexHtmlAsView()
  });

  const alfFocusObserver = alfCreateFocusObserver(PluginAPI, {
    initialMode: alfInitialFocusMode()
  });

  // Read the payload type: CurrentTaskChangePayload {current, previous}.
  PluginAPI.registerHook(
    PluginAPI.Hooks.CURRENT_TASK_CHANGE,
    (payload) => alfFocusObserver.onCurrentTaskChange(payload)
  );

  // This hook receives all app actions: immediately filter on action.type.
  // No raw action contents or personal task names are logged/stored.
  PluginAPI.registerHook(
    PluginAPI.Hooks.ACTION,
    (payload) => alfFocusObserver.onAction(payload)
  );
}
