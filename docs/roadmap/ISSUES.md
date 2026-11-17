# GitHub Issues backlog (ready to file once Issues are enabled)

**BLOCKED:** GitHub API returned **410: Issues has been disabled in this repository** on 2026-11-16. This fork inherited Issues disabled. Repository owner must turn on **Settings → General → Features → Issues**. The GitHub connector can create Issues but cannot toggle repository features. These records are the canonical **draft issue descriptions**, not live issues.

Notion tracking reference: https://app.notion.com/p/41ab4a624b7d81dbbc28e1c57279f725 .

## P0 — Daily-habit source and Woodpecker CI migration (v0.33)

- The sole execution source is `اللوح` daily `عادة` pages filtered by SP logical day, with `قاعدة العادات` relation as definition/identity reference. No definition-only import into SP.
- New primary read-only preview checks original status, date and duplicate/missing relation; no Notion/SP writes, no counter creation, no guessed link persistence.
- `.woodpecker.yml` replaces GitHub Actions for this repository; all tests must execute in the self-hosted Gumacu Kubernetes Woodpecker agent. Its server/agent/database are running, but `Clshec/notion-sync-plugin` has NOT yet been activated in Woodpecker. An authenticated private activation and real successful run remain blocking (do not expose CI UI publicly).
- Docs: `docs/architecture/daily-habits-from-board-v033.md`.
## P0 — Alf one-token connection and verified auto-discovery (v0.30 → v0.31)

**Implemented and live read-only accepted (2026-11-17):** one prominent token field, Notion 2026-03-11 host-side `/search`, exact matching for `اللوح`, `قاعدة العادات`, `المستويات العليا`, `المستويات الفرعية`, typed relation/option checks and automatic property-ID pinning in `alf-mapping-v2`. The actual Alf integration initially had `No page access`; four original database pages were granted through Notion's Content access. Super Productivity 20.0.0 was restarted to activate the host handler; one-token connection then discovered all four sources and **13 verified field pins**. Read-only preview: 300 mixed board records (65 eligible tasks/bundles), 41 habit definitions and 4 existing SP counters. No Notion/SP record writes. See [the design contract](../architecture/alf-life-os-zero-config.md).

**v0.31 real verification passed (2026-11-17):** After PR #33 and successful GitHub CI, installed v0.31 in the actual Windows SP profile. The real Notion filtered preview returned **75 task/bundle records of 75**, a Next cursor; clicking Next returned another 75 eligible records and explicitly cleared previous review approvals and selections. No import or write. **Next validation:** Safe reviewed Notion PATCH against a disposable record, Android/SuperSync, unattended task creation/import and the exact completed-Pomodoro ledger remain separate unaccepted features. Keep all writer flags OFF. No new Notion databases or schema changes.

## P0 — Safety: opt-in writes + credential isolation

**Problem:** inherited plugin assumes English task database, auto-creates Notion pages, auto-archives on deletion, and persists Notion API key into synced config.

**Done when:**
- Default preview-only; the dedicated Alf user gets automatic exact-source/schema/field discovery from one token; manual mapping is advanced developer-only and every writer still requires separate authorization.
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
- v0.28 manual preview + explicit approval for existing day-row `Status` now implemented without any new Number/property: does not automatically infer goals from clicks. Synthetic tests only; actual Android and disposable Notion testing pending. Connected Notion relation to older `متتبع العادات` data source is currently inaccessible (object_not_found), but `اللوح` and `قاعدة العادات` remain accessible. Do not assume those old tracker rows are deleted.

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

## v0.17 milestone: observable per-device automation

Implemented per-device local-only last-run diagnostics (timestamp/outcome and numeric counts) for all three opt-in engines, viewable in read-only plugin UI, and final enable-flag recheck before SP planning update. The plugin does not export diagnostic keys in SuperSync metadata, never stores token/page/title in status, and performs zero Notion traffic just to show status. Source-level plugin API compatibility with Super Productivity `v20.0.0` verified; the locally installed app was not running, and live Windows/Android/Notion integration tests remain outstanding. Higher-priority future deliverables: supported historical focus session API (no extrapolation), safe multi-device coordination/locking, recovery/status UI for unknown PATCH outcomes, realistic host install/mobile background test suite, and packaging/release only if explicitly requested.

## v0.18 milestone: SP runtime lifecycle and unacknowledged-write recovery tests

Implemented synthetic host tests confirming `onReady` registers exactly three opt-in background engine timers, disabled/default state sends zero HTTP/tasks/metadata, and `onUnload` cancels timers. Also added fake-Notion network-drop-after-PATCH tests for auto actual time and existing habit-day Number, verifying no automatic replay of a possibly successful write. Actual time stops on changed Notion value; a matching positive habit count can be adopted without another PATCH, whereas an unanchored Notion count behind a newer SP counter is a conflict. No full native app/Android/sandbox Notion tests have run. Authoritative completed focus-session history, atomic cross-device synchronization, mobile background guarantee and release packaging remain blocked/not implemented, and must never be labeled complete.

## v0.19 safety correction: scoped auto habit approvals

Closed: previously broad v0.16 opt-in could update linked habits not actually individually approved. The v0.19 engine now demands a separately reviewed `alf-habit-auto-allow-v1-` record for every original Notion habit definition + exact SP counter pair and pinned Notion mapping/source. Existing v0.16 enabled devices with no per-habit records fail closed. Approval is created only after fresh, exact current-day Notion/SP review and an explicit independent consent; positive mismatched values, duplicate rows, changed links/values and unlinked habits are rejected. Later day occurrences for the same explicitly approved definition are still allowed if already present. No new Notion database, property, row or habit is created. Remains experimental pending real SP/Android and sandbox Notion integration and distributed single-writer coordination.

## v0.20 milestone: background Notion request pacing and safe 429 retry

Implemented a shared serialized request lane for the three opt-in automatic engines, 450ms between automatic request starts, and one bounded retry of a trustworthy 429 rejection only. No automatic retry after network disconnect, server 503 or potentially successful Notion PATCH response loss. Regression tests cover concurrency, fairness after failure and no unknown-outcome mutation replay. Does not coordinate across devices or manual UI requests. Still missing: real Windows/Android+Notion end-to-end test, distributed single-writer control, task-auto-import design, and full authoritative focus session history.

## v0.21 milestone: exact original task ID markers and current acceptance plan

Fixed task-link substring collision risk: notes matching requires an exact whitespace-delimited original `alf-notion-page-id:` token. Independent keyed Notion↔SP link record now mandatory for any reviewed task planning, actual-time and partial observed Pomodoro writeback; notes alone never authorize a write. The manual importer can explicitly relink a previously imported exact marker without creating a second task. The read-only focus comparison also refuses unlinked markers. Replaced stale `TEST_PLAN.md` (which incorrectly demanded new unrelated Notion databases and v14) with v20.0.0, existing-source, no-production-mutation acceptance gates. Installed Windows SP v20.0.0 passed an isolated startup smoke using `--user-data-dir`, cleaned afterward; plugin installation, Notion sandbox integration and Android tests remain outstanding.

## v0.22 milestone: fail-closed habit-day Notion pagination

The previous manual/automatic existing habit-day query could silently accept incomplete Notion results if `has_more` was true without `next_cursor`. Both routes now abort on that malformed state, preventing concealed duplicate rows from authorizing a Number write. CI tests prove no PATCH after malformed pages; max-300 bound still blocks ambiguous large inventories. Also updated the inaccurate plugin UI footer to describe the three disabled-by-default opt-in auto engines. No live Notion or SP production mutation.

## v0.23 milestone — real isolated Windows SP 20.0.0 plugin UI smoke (L3 partial)

On the connected Windows PC, confirmed installed Super Productivity **20.0.0** and used the official Electron `--user-data-dir` argument to launch a second, disposable, isolated SP profile. Built a **temporary test ZIP** from the v0.22 main repository with root manifest, host script, HTML UI, icon and license. Installed in Settings → Plugins → Choose Plugin File. Confirmed the app listed **Alf Notion Super Productivity v0.22.0**, correct author/icon, 15 declared permissions and two hooks; after enabling, its Notion header icon opened the real plugin iframe with existing Notion data-source mapping fields. This establishes **live host installation, activation and side-panel rendering**, beyond CI mocks. No Notion token was entered, no personal Notion data or regular SP/SuperSync profile was accessed. The test instance's five Electron processes were stopped, and its temporary checkout, ZIP and profile folder were removed and verified absent.

Updated the stale v0.4 README opening and plugin intro to reflect the **three independent opt-in background engines**, disabled by default. Updated `TEST_PLAN.md` with L3 **partially passed** and exact outstanding checks. Did **not** inspect detailed runtime console/bridge logs, perform real Notion schema/GET/PATCH, or test Android/SuperSync cross-device reliability. Therefore no production readiness claim. No plugin ZIP was published or delivered.

## v0.24 milestone — reject multi-page SP task markers

The earlier strict-token matching still allowed a task's editable notes to contain two different exact Notion page ID tokens. Such a task could appear linked to two pages, and its work time could be counted twice. Introduced a shared host-side exact **single** marker requirement and matching UI rule: any repeated or competing original Notion page token blocks manual import adoption, reviewed planning/time/focus association, and opt-in automatic planning/actual-time update. Independent persisted Notion↔SP link remains mandatory. Regression tests ensure no mutation and no relink for a multi-page claim. No user profile/Notion data accessed; full end-to-end Notion/Android test gates still open.

## v0.25 — only explicit HTTP 429 authorizes re-attempt

Closed a potential unsafe automatic Number PATCH replay: v0.20 would retry on text `rate limit` or a `rate_limited` code even without a confirmed HTTP rejection. v0.25 demands structured HTTP status 429 before one bounded retry, never retries timeout/503/connection reset/unknown outcome even if the text mentions 429. Simulated network-failure-after-Notion-write tests verify exactly one attempt. Real cross-device atomicity and integration checks remain pending.

## v0.26 — consent replacement and per-device revocation

Fixed stale synced habit approval accumulation: an old synced per-definition allow record must never silently expand a later subset that a user approves. Each deliberate enable now records a **replacement device-only scope** of exact habit/counter pairs bound to the pinned Notion occurrence mapping. The local enabled flag is cleared before replacement and only restored after its successful save. The runtime requires both a matching original synced per-definition approval and a currently selected local grant, rechecking the local scope before PATCH. Disable clears local flag **and** local scope. Older installations that have historic synced approvals but no new local scope safely stop unattended habit-day writes until re-approved. No schema changes or production Notion data touched. Multi-device distributed-lock and full focus ledger remain unresolved.

## v0.27 — live Notion schema preflight and protected Number semantics

Read-only inspection of the existing **اللوح** source confirmed the Title, task-type Multi-select, execution Date and planned/actual work-time Numbers plus **قاعدة العادات** relation; the existing habit-definition source has **العادة** Title and **التكرار** Select. The current board has **no independently named habit-completion count Number**. Do not claim the automatic SP ClickCounter→Notion daily count is ready for this board, or repurpose **الوقت الفعلي**/create a Notion field without user approval. Implemented rejection of aliased actual-time and partial-Pomodoro Number IDs, and rejection of a habit click count or incompatible stopwatch unit sharing the actual work-time Number. Enforced in UI preview and host-side auto engines, with regression tests. Real Notion API plugin integration and Android/SuperSync distributed single-writer verification remain pending.
