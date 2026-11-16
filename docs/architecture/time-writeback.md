# Actual work time writeback — SP → Notion (v0.4 alpha)

**Notion remains the planning authority.** This feature returns *observed* task work duration from Super Productivity to the existing Notion task row, without changing scheduled execution day, deadline, estimates, status, parent/bundle relations or task title.

This feature is separate from Pomodoro session counts. SP's `timeSpent` and `timeSpentOnDay` are available now; there is still **no supported per-task, per-mode completed focus-session log** through the official plugin API. Never manufacture completed Pomodoro counts by dividing hours by 25.

## User workflow (explicit, never automatic)

1. Set up a Notion integration and mapped **existing Tasks data source**, Title and allowed task/bundle type values. Assign an existing `Actual Time` Number field and select **hours** or **minutes**.
2. Preview task rows. Select only the intended Notion tasks in the read-only result table.
3. The tasks must already have a stable Notion-page ID link to SP (created by Alf's explicit import). This is **not** title-matching.
4. Click **Preview actual time differences (NO WRITES)**. No external writes occur in this step. It shows the current Notion value and candidate SP value.
5. Review values and tick the **separate authorization** checkbox. Click **Write reviewed actual time to Notion**.
6. For each selected task, Alf checks local SP time still matches the proposal, retrieves the Notion page again, verifies it still belongs to the same data source and allowed type, and confirms its `Actual Time` Number has not changed since preview.
7. The only outbound mutation is a Notion `PATCH /v1/pages/{page_id}` with `properties: { [actualNumberProperty]: { number: value } }`.

Any ambiguous, stale, moved or conflicting page **is skipped**, not overwritten. Rerun task preview and time staging for another attempt. The API version is `2026-03-11`.

## Conversion, duplicate and multi-device semantics

- `timeSpent` is in **milliseconds**; the selected Notion numeric unit is hours or minutes. The explicit conversion rounds to six fractional digits (error ≤ 0.5 micro-unit).
- A positive tracked duration is required to propose a write. Zero/null SP durations **do not clear a manually entered Notion value**.
- If Notion currently has a larger actual time value than the local SP snapshot, the task is skipped to prevent a stale offline device from replacing a newer total.
- SP parent tasks with `subTaskIds` are skipped so a parent aggregation is not duplicated alongside children. Notion parent rollups remain its own design.
- Writes use the absolute time total, never `+=`. This makes safe replays harmless after a fresh review. No background writer runs on either device.
- Two devices using SuperSync may see task-state updates at different moments. A new review is required before each manual write. **True distributed concurrency protection is not provided** by Notion's PATCH API: there is a remaining time-of-check/time-of-use race between the GET preflight and PATCH.
- The plugin cannot push time to an existing SP task unless it is explicitly linked to the target Notion page ID. This prevents dangerous title-based guesses.

## Not yet supported

- Continuous automatic time sync or a background push queue.
- Reconciliation of Notion manual corrections against tracked SP records.
- Date-wise logging into individual Notion daily history fields (this version writes only the overall Actual Time Number).
- Distinguishing Pomodoro, Flowtime, Countdown, work vs break and completed sessions in Notion. Those require official focus session events/API in SP.
- Multi-company / Notion project relation mapping across several SP Projects.
- Production deployment without real Windows/Android and sandbox Notion tests.

## Testing gate

Mock tests assert: no PATCH during previews, separate authorization, property-only mutation, rereading the same page, aborting on changed Notion values or changed SP time, and skipping parent rollups. They **do not replace live integration tests**.

Related: [field mapping](field-mapping.md), [architecture](alf-sync.md), [security](../../SECURITY.md).

## v0.15 separate, opt-in automatic tracked-time export (experimental)

Adds a disabled-by-default, per-device auto-export toggle (`alf-auto-time-local-enabled-v1`) and a separate set of reviewed synced baseline records (`alf-time-anchor-v1-` + original Notion page ID). Baselines can only be prepared from selected **already-linked, non-parent SP tasks** with a positive, safe, tracked `timeSpent` exactly equal to the current Notion Number after explicit hours/minutes conversion; the user must first use the reviewed manual time writeback if mismatched. Pin original Notion task type and Actual Time property IDs. No stored credential or auto-enable flag is synced.

Each bounded runtime cycle (5 anchors per ~10 minutes, while SP's plugin is running) verifies exact marker + independent page link, task project/parent/rollup identity, monotonic `timeSpent` and Notion Number, configured source/type/property IDs, one current Notion page with unchanged old Number, fresh SP time/link/anchor, and a second Notion GET before PATCH. It writes one existing Number property, by immutable property ID, only if the positive converted time increased. It then persists the new expected time and numeric value. Concurrent user correction, higher Notion value, lost credentials, changed mapping or replaced property is a conflict, never silently reset or overwritten.

Known limitations are non-atomic GET/PATCH and independent synced metadata delivery (cannot guarantee no concurrent cross-device PATCH). Therefore automatic time export must be enabled on only one test device. The host can suspend the plugin on Android. If patch success is uncertain, the baseline is stale and **next run stops**, awaiting manual reconciliation. No new Notion database/property/row or SP task is created. No focus-mode statistics are inferred from timeSpent.
