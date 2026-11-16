# Opt-in Habit Tracker daily values → existing Notion occurrences (v0.7 alpha)

**Goal:** Preserve the user's existing Notion system, with **habit definitions in their existing habit source** and **daily habit occurrences in their existing `اللوح` / task source**. No new database, page or relation may be created by this feature.

## Explicit opt-in workflow

1. Map the existing Notion habit definitions and link them to existing SP counters by ID (v0.6). This link is stored under `alf-habit-definition-link-v1-${notionHabitPageId}`.
2. Configure a source for **existing habit occurrence pages**, using the same configured task/board data source or another Notion source depending on the user. Provide:
   - item type property `نوع الصفحة` (Select/Multi-select) and exact value `عادة`;
   - relation `قاعدة العادات` (must point to **exactly one** existing habit definition);
   - execution day `يوم التنفيذ` (Date, date-only for v0.7);
   - numeric completion/quantity field (Number), e.g. `Habit Count`. **This Number property must already exist**.
3. Select the unit **Count** (for `ClickCounter`), or **Minutes/Hours** (for `StopWatch`). SP stores StopWatch daily values in milliseconds.
4. Click **Preview today's existing habit-day differences**. The plugin uses optional official SP `getDayContext().todayStr` to respect the configured logical day, never the device calendar. If unavailable, it **refuses to write**. Query Notion data sources using date/type filters and pagination.
5. Only existing occurrence rows with matching type, day, single definition relation and linked SP counter are candidates. Missing relations, absent counter values, duplicate habit/day occurrence pages, stale SP totals, unsupported units and ambiguous pages are skipped.
6. Review the exact `before → after` values, and check the **separate authorization checkbox**. Only then use **Write reviewed habit-day counts**.
7. For every candidate, refetch the exact Notion page and revalidate its data source, item type, execution date, original habit relation and unchanged numeric count. Also re-read SP counter value. Only then issue a `PATCH /v1/pages/{page_id}` with **one** numeric property.
8. Clear staged values after the operation. Next attempt requires new preview and authorization. No implicit page creation, no automatic worker, no batch mass update.

## Safety and limitations

- The plugin does not add a Notion `Habit Count` field. A user can opt to add one to the **existing** source if needed, but the plugin never creates or changes schema.
- Only records with positive count/duration are considered in v0.7. No zero-to-zero or `false` completion write. Use the existing Notion Status property independently if desired; this feature does not alter it.
- Daily occurrence relation must point to exactly one habit definition. The normalized habit identity and logical date identify one occurrence.
- A duplicate page for the same habit and day invalidates both; it is not picked arbitrarily.
- `ClickCounter` gets the raw positive count, whereas `StopWatch` converts milliseconds to explicitly selected minutes/hours (precision 6 decimals). Types and units must match.
- The snapshot is bounded to 300 filtered pages; if more remain, refuse rather than silently consider the set complete.
- Absolute value updates avoid additive duplicates. Stale devices with smaller SP totals are skipped, but true atomic cross-device compares are unavailable in Notion PATCH. There is still a GET/PATCH race; this is **not production-grade distributed synchronization**.
- No writes to habit definitions, task title, due date, deadline, project relations or SP counters. No new databases.
- Missing daily rows remain missing; the plugin does not create them. A future separately approved idempotent create/reconcile system would require a stronger concurrency plan.
- Android/Desktop and real Notion sandbox verification still need to be completed; mocked tests do not prove deployment behavior.

## Next work

- Deduplication across multiple devices; transaction queue/checkpoint and conflict review.
- Notion-defined frequency/targets/build-vs-break and flexible daily statuses.
- Incremental sync with Notion pagination and high-volume backfill by logical day.
- Optional creation of missing daily occurrence records in the **existing** Notion source, but only after testing and explicit user approval.
- Real automated Pomodoro work-mode session completions need a stable SP structured focus-session API; they are not derivable from daily habit values.

[Habit definitions](habit-mapping.md) · [Overall design](alf-sync.md) · [Task time writeback](time-writeback.md)
