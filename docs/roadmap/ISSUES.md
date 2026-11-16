# GitHub Issues backlog (ready to file once Issues are enabled)

**BLOCKED:** GitHub API returned **410: Issues has been disabled in this repository** on 2026-11-16. This fork inherited Issues disabled. Repository owner must turn on **Settings → General → Features → Issues**. The GitHub connector can create Issues but cannot toggle repository features. These records are the canonical **draft issue descriptions**, not live issues.

Notion tracking reference: https://app.notion.com/p/41ab4a624b7d81dbbc28e1c57279f725 .

## P0 — Safety: opt-in writes + credential isolation

**Problem:** inherited plugin assumes English task database, auto-creates Notion pages, auto-archives on deletion, and persists Notion API key into synced config.

**Done when:**
- Default preview-only; explicit Notion sources/types/fields configured and reviewed before writes.
- No automatic page creation/deletion/archive on hook or missing `SP Task ID`.
- Per-device secrets, sanitized export, Notion host allowed via official request API, no secrets in tests/logs.
- Migration plan for existing alpha configs, end-to-end tests.

## P0 — Exact Pomodoro / Flowtime / Countdown session sync

**Done when:**
- Session model has stable unique ID, task ID, mode, work and break durations, completion/interruption, device/revision.
- Only **real completed** Pomodoro sessions increment the completed count; never derive it from tracked hours.
- Time and counts reconcile idempotently across Android and Windows and aggregate by Notion task/day without parent-child double count.
- Upstream SP Plugin API gap resolved or explicitly documented as a release blocker.

## P0 — Generic Notion schema mapping & SP quick fields

**Done when:**
- Support arbitrary existing Notion database(s), not fixed `Name`/`SP Task ID`/`Complete`.
- Correct independent execution day/time (`dueDay`, `dueWithTime`) and deadline (`deadlineDay`, `deadlineWithTime`).
- Correct estimate vs actual time, explicit number unit, timezone, priority, status and tags.
- Missing Notion properties optional; no new Notion database creation.

## P1 — Projects and bundles

**Done when:**
- Only real small projects (not folders/courses) become SP Projects.
- Existing `حزمة` maps to parent task, `الحزمة الأب` to subtask, `مهمة` to task.
- Stable ID binding and conflict handling; excluded knowledge pages never imported.

## P1 — Notion habits and daily SP Habit Tracker

**Done when:**
- Definition collection maps to SimpleCounter/Habit Tracker, daily records update existing `اللوح` records.
- Frequency and streaks, numerical goals, StopWatch in milliseconds, corrections/skipped days.
- Test creation of counters or request missing API methods upstream.

## P1 — Multi-device offline idempotency

**Done when:**
- Windows + Android remain usable offline and resume after sync.
- Plugin writes not duplicated by the app's SuperSync; conflict resolution per field.
- No syncing credentials, retry with backoff, no unintentional history loss.

## P1 — General-public configuration and Android HTTP

**Done when:**
- Permissioned `PluginAPI.request` and Notion API pagination/version are supported on Android/Desktop.
- User-configurable Notion property/source selection and optional OAuth bridge without embedding client secrets.
- Official plugin ZIP build/installation, MIT attribution, per-device auth and test docs.

## P2 — Release test matrix

**Done when:**
- Unit tests for date/units/status/priority/idempotency/counters.
- Sandbox Notion/SP integration tests, safe dry-run, offline/retry, large data, first-run and upgrade.
- No production release until safe write gating and confirmed focus-session fidelity.

## Cross-links
- [Architecture](../architecture/alf-sync.md)
- [Field mapping](../architecture/field-mapping.md)
- [Security](../../SECURITY.md)

To convert these drafts to live Issues, enable Issues and re-run GitHub create_issue with the titles/criteria above; then link the resulting numbered URLs in this file and in Notion if requested.

## v0.10 milestone: optional lower-bound observer writeback

Implemented (experimental): explicit consented preview/PATCH into a **pre-existing, separately labeled observed Pomodoros Number property**; stable property ID, Notion item/source and SP task identity revalidation, session ID deduplication, monotonic-only values and 2,000-record safety ceiling. This remains a manual partial lower bound and **does not satisfy** P0 authoritative completed Pomodoros, historical backfill, Android offline delivery or automated sync criteria above. All schema changes remain the Notion user's responsibility; zero new databases or properties are made by the plugin.

## v0.11 milestone: reviewed Notion planning refresh for already-linked SP tasks

Implemented in plugin UI: select existing Notion tasks, stage field-level differences against individually linked active, unfinished, non-recurring SP tasks, authorize the exact changes, and refresh their `title`, `timeEstimate`, `dueDay` and `dueWithTime`. Empty Notion values do not clear SP data. Revalidation checks Notion source ID, item type, plan values, local SP task link, task hierarchy and the original local field values. A Notion plan change or offline local edit after staging skips the changed item. No write is performed to Notion, and actual work, completion, habits and SuperSync are untouched. This is manual one-way planning reconciliation, **not** complete automatic two-way sync or historical Pomodoro export.

## v0.12 milestone — pinned existing Notion habit property identities

Implemented: optional pinning for existing habit definition title/cadence and board-occurrence item type, definition relation, logical day and numeric count. Writeback now **requires** those four occurrence IDs, revalidates source schema and the Notion definition ↔ SP counter link before PATCH, and writes only to the exact same Notion Number property ID even after a label rename. Read-only definition preview can still work with names. This preserves Notion history and requires no new databases, rows or properties. User account's live Notion data was not modified. Still missing: fully reliable automatic two-way habit sync, creation of missing SP counters via supported plugin API, multi-device lock/reconciliation and actual Android/Desktop validation.

## v0.15 milestone: independent automatic actual-time export for approved linked tasks

Implemented: manual consented seeding of exact SP tracked-time ↔ existing Notion Number baselines, separate per-device opt-in toggle, periodic (at most five) monotonic positive time exports to pinned existing Notion Number IDs only, source/type/link/hierarchy and two-stage Notion value revalidation, abort-on-conflict and crash/unknown-result safety. This is **not** an atomic cross-device write, full automatic habit sync, or authoritative historical Pomodoro export. Keep auto mode disabled in production until disposable Notion and Android/Desktop integration validations pass. No actual Notion user data were changed by code development.

## v0.16 milestone: automatic habit-day counts for existing Notion rows only

Implemented: separate per-device authorized auto update of positive ClickCounter/StopWatch progress for the SP logical day to **existing** Notion board habit occurrence Number fields. Requires stable property IDs, definition→SP counter links, exact selected item type, unique existing habit/day row, appropriate units, and strict per-day/page Notion/SP baseline preservation. Re-query day inventory immediately before PATCH to reject new duplicates. Does not create daily records, change relations, allow counter decrements or overwrite manually edited Notion counts. No reliable Android background execution, atomic cross-device locking, historical Pomodoro ledger, or production verification yet. Remains experimental/off by default.
