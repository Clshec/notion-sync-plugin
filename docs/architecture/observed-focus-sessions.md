# Focus events — conservative live observation, v0.5 alpha

**Important:** A public, backward-compatible SP Plugin API returning the complete typed, historical, per-task, per-mode focus-session ledger is still absent. This feature is an **observer of events occurring after the plugin starts**, not a reliable historical import, and it is NOT an automatic Pomodoro→Notion sync engine.

## Discovery

The official SP action hook `PluginAPI.Hooks.ACTION` receives app actions. In SP source, relevant actions include:

- `[FocusMode] Set Mode` with `mode = Pomodoro|Flowtime|Countdown`
- `[FocusMode] Start Session` with optional `taskId`
- `[FocusMode] Complete Session` with optional `isManual` and `completedDuration`
- `[FocusMode] Cancel Session` with no trustworthy complete event
- `[FocusMode] End Flowtime Session` which should then trigger a Complete Session effect
- `PluginAPI.Hooks.CURRENT_TASK_CHANGE` with `{current,previous}` SP tasks

Refs:
- [SP action contract](https://github.com/super-productivity/super-productivity/blob/master/src/app/features/focus-mode/store/focus-mode.actions.ts)
- [Hook declaration](https://github.com/super-productivity/super-productivity/blob/master/packages/plugin-api/src/types.ts)
- [All-actions plugin hook dispatch](https://github.com/super-productivity/super-productivity/blob/master/src/app/plugins/plugin-hooks.effects.ts)
- [Focus completion effect and metric capture](https://github.com/super-productivity/super-productivity/blob/master/src/app/features/focus-mode/store/focus-mode.effects.ts)

## Implemented scope

An explicitly named `plugin.js` observer:

1. Reads the current SP focus mode from the app's local `FOCUS_MODE_MODE` setting, if valid; subsequent `Set Mode` actions replace it. An unknown mode is never guessed.
2. Listens to tracked-task changes to maintain the task ID. An explicit task ID on a `Start Session` action takes priority; otherwise, the previously observed tracked task is used.
3. Observes the start and subsequent complete of **that same session** while the plugin remains active. Cancelled sessions, conflicting tracked-task changes, mode changes and unknown task/mode are discarded rather than attached to the wrong task.
4. Creates a random, independent session ID at each observed start. On finish, persists one immutable record per `alf-focus-observed-v1-${sessionId}` via keyed `persistDataSynced`.
5. A `verifiedCompletedPomodoro` is **only** a `Pomodoro` session completed with explicit `isManual === false`. A manually ended or ambiguous session is never counted as completed Pomodoro. `Flowtime` and `Countdown` completions are recorded separately and **not** counted as Pomodoros.
6. Duration is stored only if `completedDuration` was actually supplied by the completion action; when absent it is `null`. Never compute duration from wall-clock time or `timeSpent/25m`.
7. A read-only report in the UI reads unique keyed session records and displays counts per SP task. No Notion write is made and no SP task is modified.

## Limitations / TODOs

- This observer is **NOT guaranteed to catch every valid completed session**. A missing/late task context change, mid-session plugin startup, app restarts, Android background kills and lost ACTION hook notifications can lead to discarded sessions. Incorrectly reporting zero for pre-existing historical sessions would be a mistake: they are **unknown**, not zero.
- Unrelated app actions are filtered by `action.type`, but reliance on internal NgRx action strings rather than a stable public typed focus-session API is a **compatibility risk**. Source verification and end-to-end tests must be performed with target SP release versions.
- `isManual === false` signifies an observed automatic focus completion, but may not capture all valid user-approved ways of completing Pomodoro work. Conservative filtering is intentional.
- The `CURRENT_TASK_CHANGE` and start event ordering can vary; context changes invalidate active sessions instead of guessing. Future SP API should provide the task ID and mode on an atomic completion event.
- `persistDataSynced` is synchronized plugin metadata: **do not interpret successful persistence as proof all other devices received it.** Counts derive from unique session keys, not every sync event.
- Syncing completed session totals and optional focus duration into Notion is **blocked** pending a supported, reliable per-task completed-session ledger/API and real multi-device validation. Do not auto-patch Notion session fields from this observer in production.
- No session history is inferred from aggregate task time. Actual time Number writeback remains a separate, manually approved action from PR #4.

## Recommended upstream API contribution

```ts
interface PluginFocusSession {
  id: string; // stable across devices
  taskId: string | null;
  mode: 'Pomodoro' | 'Flowtime' | 'Countdown';
  startedAt: number;
  finishedAt: number;
  workDurationMs: number; // excludes break
  breakDurationMs: number;
  outcome: 'completed' | 'manual-complete' | 'interrupted' | 'cancelled';
  revision: number;
}
getFocusSessions(query?: { since?: number; taskId?: string }): Promise<PluginFocusSession[]>;
onFocusSessionFinalized(fn: (session: PluginFocusSession) => void): void;
```

The official event should carry an idempotent ID, mode, task and duration together; this eliminates most ambiguities above.

## Test matrix

- Verified automatic Pomodoro; early manual Pomodoro end must not increment.
- Flowtime + Countdown stay distinct.
- Unknown mode / task → no event.
- Cancel or change the tracked task mid-session → no event.
- Duplicate Complete action does not duplicate.
- Local storage mode fallback and task-change hooks verified.
- Android/Desktop real focus-mode completion and app restart scenarios **remain to be tested**.

[Main architecture](alf-sync.md) · [Time writeback](time-writeback.md)
