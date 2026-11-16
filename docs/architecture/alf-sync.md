# Alf Notion Super Productivity — Architecture (v0.1 proposal)

**Status:** foundation specification, not a claim of working synchronization.  
**Upstream:** [AlessioLovato/notion-sync-plugin](https://github.com/AlessioLovato/notion-sync-plugin), MIT. Keep attribution and upstream history.  
**Related Notion planning project:** [تطوير إضافة نوشن بردوكتدتيفي](https://app.notion.com/p/41ab4a624b7d81dbbc28e1c57279f725).

## Product contract

- **Notion is the authoritative planner and long-term record.** Its projects, hierarchy, task definitions, habit definitions, scheduled execution day, and deadlines are authoritative.
- **Super Productivity (SP) is the local-first execution surface.** Fast native UI on Windows/Android, estimated-vs-actual time, Pomodoro/Flowtime/Countdown, and Habit Tracker are the differentiators.
- Task completion and other explicit user changes may sync both ways, with separate per-field conflict rules. **Verified actual tracked time and focus-session observations flow from SP to Notion**, without replacing Notion's original plan.
- No new Notion databases are required. Users map existing databases and properties; any missing **properties** are optional and may be added only after an explicit preview/consent.
- Public plugin: no hard-coded user IDs, property labels, country, language, projects, or database names.

## Logical data model

```text
Notion workspace                                Super Productivity
  Project hierarchy ───────────[config]─────────> Projects
  Task/Bundle collection ──────[mapping]────────> Tasks / parent tasks / subtasks
  Habit definitions ───────────[mapping]────────> Habit Tracker / SimpleCounters
  Habit occurrences <─────────[idempotent]────── Daily counter values
  Planned estimate + schedule ─[Notion wins]────> Estimates, dueDay/dueWithTime
  Deadline ────────────────────[Notion wins]────> deadlineDay/deadlineWithTime
  Actual time <────────────────[SP wins]───────── timeSpentOnDay, timeSpent
  Focus results <──────────────[SP wins]───────── per-task focus sessions (API gap)
```

### Example adapter (not a built-in special case)

- `المستويات العليا`: large/medium project hierarchy, distinguished from knowledge folders by `النظام = مشروع`.
- `المستويات الفرعية`: small projects; include only entries with a verified project ancestor, not `مجلد` / course units.
- `اللوح`: item type `مهمة` → SP Task, `حزمة` → SP parent Task; `الحزمة الأب` → subtask parent; `العنصر الفرعي` → project. Exclude `تعلم`, `صفحة`, `مالية`, `تدوين`, unrelated knowledge records. `عادة` is a separate occurrence, not a normal task by default.
- `قاعدة العادات`: habit definitions; `اللوح` links occurrences to definitions and their execution day.

This is a configurable **example profile** only. Another user's Notion schema need not resemble it.

## Core invariants

1. **Sync is OFF / preview-only by default** for the fork until schema mapping and ownership are explicitly confirmed. The inherited upstream engine is not safe for general-purpose Notion databases without changes.
2. Never delete or archive a Notion page because an SP task disappeared, was filtered out, or changed project. Deletion must be an explicit separately confirmed workflow.
3. Never create pages because a background hook cannot find an ID; first identify source ownership and deduplicate by stable `notionPageId` and `spTaskId`. Missing mapping is a reconciliation case, not permission to create.
4. Only map pages matching a configured source, type filter, and parent relation. Exclude knowledge/content by design.
5. Parent task totals may already roll up child time in SP. Never sum the parent aggregate and each child's time twice. Preserve daily distribution.
6. Two-level SP subtasks: `حزمة` = parent task, one subtask level. Unsupported deeper nesting requires a warning and manual decision, never silent flattening.
7. Maintain a persistent, versioned mapping with per-field sync cursors and device-neutral idempotency keys. A second device must not replay a session/habit occurrence as a new record.
8. Sync time/date as **semantic typed values** with explicit timezone and unit conversions; do not guess whether existing Notion numbers are minutes or hours.
9. Local offline work never blocks execution. Network retries are bounded, idempotent and handle Notion API 429/backoff; conflict queue remains inspectable.
10. No API tokens in synced plugin data, exports, logs, repository, issue descriptions, or test fixtures.

## System boundaries

**Notion Adapter**
- User-configured mappings for projects, tasks, habits, properties, status options, and filters.
- Modern Notion API database/data-source handling, full pagination and permissions checks.
- Notion pull should be non-destructive unless a user approves a proposed change.

**SP Adapter**
- Official `PluginAPI.getTasks/getArchivedTasks/getAllProjects/getAppState` and task methods.
- Official host HTTP support (`PluginAPI.request` + permission/allowedHosts) for Android and desktop; no dependency on Electron-only localhost REST/MCP endpoints.
- Projects and tags created only when mappings and permissions permit.

**Reconciler**
- Changesets: `source, entityType, sourceId, targetId, field, oldValue, newValue, origin, updatedAt`.
- Direction ownership rules: Notion plan, SP observations, and selected bidirectional fields.
- Write lock / deduplication with SuperSync. A `DATA_CHANGED` event is not itself evidence that a new user action requires a Notion write.

**Reporting**
- Time estimate and actual work duration are distinct.
- Pomodoro target is user-configured from estimate/session settings; completed Pomodoro count must come from **completed session records**, not `Math.round(timeSpent / 25m)`.
- Flowtime and Countdown remain distinct and include completed/aborted state. Break durations must not count as focus duration.

## Focus-session API gap / prerequisite

Current official SP plugin API provides aggregate task `timeSpent`/`timeSpentOnDay`, but it does **not** expose a reliably per-task/per-mode completed focus-session ledger. The desktop `/focus` REST endpoint shows transient state only and is not Android-compatible. A proper upstream plugin API or supported event source is needed to capture:

```text
sessionId; taskId; mode: Pomodoro|Flowtime|Countdown;
startedAt; endedAt; workDurationMs; breakDurationMs;
completed; interrupted; deviceId; revision
```

This gap must remain visible; do not label the count feature complete prematurely.

## Security, transport and release

- Retain MIT LICENSE and upstream copyright.
- Token stored using device-local secret API; never `persistDataSynced`. Per-device authentication or properly protected OAuth is required.
- Plugin code must be installed per device; SuperSync may synchronize plugin **data**, not its code.
- Explicit Notion domain HTTP permission / allowedHosts, authorization scope and rate limiting.
- Public release requires dry-run, import/export redaction, migration test, Windows+Android behavior test, and opt-in promotion from preview to writes.

## Phases

1. **Foundation/security:** independent fork identity, README, safe sync defaults, field mapping, roadmap.
2. **Config + task planning:** existing-schema discovery, field mapping, project/bundle/subtask reconciliation, due/schedule/deadline/estimate/status.
3. **Time + focus:** actual time, daily rollups, real Pomodoro/Flowtime/Countdown records after API support.
4. **Habits:** SimpleCounter definitions and daily occurrences/streaks.
5. **Public:** multi-device stress tests, OAuth, Android package, migration, release notes.

See [field mapping](field-mapping.md) and [implementation backlog](../roadmap/ISSUES.md).
