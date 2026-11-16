# Alf Notion ↔ Super Productivity — acceptance plan (v0.28 experimental)

**Scope:** Notion is the authoritative planner and long-term habit record. Super Productivity (SP) v20.0.0+ is the local-first task executor, time tracker and focus timer. No requirement to create, migrate, rename or extend the user's existing Notion databases or fields. Use **existing** Notion task and habit data sources. No automatically created Notion pages or properties. The original repository's v14-era legacy test plan and hard-coded database IDs have been retired.

## Evidence levels and environments

| Level | Environment | Meaning | Status |
|---|---|---|---|
| L1 | Node.js synthetic mocked Notion/SP API | Contract/regression tests; no real user data | CI active |
| L2 | SP v20.0.0 executable with a **disposable** `--user-data-dir` | Verify safe isolated host startup | **Passed** on connected Windows PC; test profile deleted |
| L3 | SP v20.0.0 disposable profile + real plugin ZIP | Install/activate and open iframe UI; host hooks and API side effects require follow-up verification | **Partially passed**: v0.28.0 installed, enabled and its new section 8c opened; no token or network verification |
| L4 | Disposable Notion integration and existing disposable data-source rows | Real Notion schema/GET/PATCH/mapping/permissions, test restore | **Not tested** |
| L5 | Android + Windows, SuperSync Beta, foreground/background/offline | Concurrency, mobile timers and per-device secrets | **Not tested** |

Passing L1–L3 (including this partial isolated Windows install smoke) **does not** imply production readiness or historical completed-Pomodoro accuracy. Never connect a production Notion token or the user's original SP profile until L3–L5 pass. Do not provide or log real Notion tokens.

### v0.28.0 actual Windows host smoke — 2026-11-16

- Verified the installed Super Productivity executable reports **20.0.0**. Launched a **separate, disposable** Electron process with an isolated `--user-data-dir` and confirmed its blank profile, not the ordinary SP profile.
- Packaged a **temporary local ZIP** containing only root `manifest.json`, `plugin.js`, `index.html`, `notion.svg` and `LICENSE`. Installed it via the real SP Settings → Plugins → Choose Plugin File flow. The host displayed the success notification **Plugin "Alf Notion Super Productivity" installed**. The uploaded plugin listed **v0.28.0**, original author credit, icon, 15 permissions and 2 hooks.
- Enabled it, clicked its header icon and verified the actual iframe opened. The rendered heading **"8c. Mark an existing daily habit Done — reviewed Status only"** and its explanatory review UI were visible in the real host. An attempted **preview with no saved credential/source** failed closed with **"Data source must be a Notion UUID, not a database URL"**; no Notion writes were attempted.
- Confirmed all five Electron processes launched under the disposable user-data directory; stopped **only** those processes. Verified no disposable process remained and deleted only its test profile directory and temporary ZIP. The user's normal SP profile, credentials and production data were untouched. No ZIP was published.
- **Still unverified:** real plugin Notion HTTP GET/PATCH against disposable data, host hook execution/secret persistence and diagnostics across restart, console/network error inspection, Windows/Android multi-device consistency and Android background behavior. This is stronger L3 UI evidence than v0.23, **not L4 or L5 acceptance**.

## Read-only preflight (L3)

1. Verify the SP binary/active host version is **20.0.0+**, which supports the public plugin methods used (`onReady`, `onUnload`, `getTasks`, `getArchivedTasks`, `updateTask`, `getAppState`, `getDayContext`, `getSecret`, `setSecret`, `listSyncedDataKeys`, `persistDataSynced` and guarded `request`).
2. Start a fresh *disposable* Windows profile using the upstream-supported `--user-data-dir` argument. Never select the real default profile, or reuse its local SuperSync credentials. Check it creates a separate data directory. After closing that exact process, remove only the confirmed disposable temporary folder.
3. Install the reviewed plugin package (root `manifest.json`, `plugin.js`, `index.html`, `notion.svg`, original MIT license) under **Settings → Plugins → Choose Plugin File** in the disposable profile; inspect manifest host permissions and the console for errors. **Verified manually:** v0.22.0 ZIP was accepted, uploaded plugin listed with correct name/version/author/icon/15 permissions/2 hooks, header Notion icon appeared, and the actual iframe side panel opened. **Not yet verified:** detailed console errors, internal hooks, credentials, Notion HTTP or state across SP restart. No release ZIP was published; temporary ZIP/profile were removed.
4. With all three automatic modes disabled (default), verify no HTTP request to Notion, no task mutation, no synced metadata churn; verify the header/side panel opens. **Side panel opening passed**; absence of network/side effects still requires instrumented host verification.
5. Verify per-device Notion credential storage: credentials do not appear in synced plugin metadata, diagnostic summaries, logs or remote SuperSync exports. Importing plugin on Android does not automatically bring a Windows token.

## Disposable Notion setup (L4)

Use an integration explicitly shared only with existing **disposable** test data sources. Discover the data source UUIDs through Notion's current API **2026-03-11**, rather than confusing database IDs with data-source IDs. Reuse a test board's existing Title, Select/Multi-select item type, Date, Number planned/actual, optional partial observed-Pomodoro Number, and Relation properties as configured; reuse an existing test habit-definition source with title and cadence. No new Notion properties, databases or pages should be generated by the plugin. If no suitable test rows exist, arrange test fixtures **outside the plugin** with explicit user control before L4; do not run tests on personal records.

### Core L4 cases

- Read-only schema and task preview, allowed item-type filter, pagination limits, pinned property IDs and Arabic/English field renames; no Notion PATCH from previews.
- Manual import into explicitly selected existing SP project; verify original Notion page marker and independently synced Notion↔SP ID link. Retrying and recovering a valid exact marker with a missing stored link must not duplicate SP tasks. A marker *substring/prefix* is never accepted.
- Review/approve planning changes: title verbatim (including short syntax such as `#tag`), planned hours/minutes, date-only or timezone-explicit execution time. Completed, archived, recurring, moved or ambiguous SP tasks are skipped. Local SP execution/actual time, notes, project and subtask hierarchy must remain intact.
- Review/approve existing Actual Time Number writeback. A parent with subtasks is never double-counted; verified increasing `timeSpent` only; Notion higher/manual edits and changed source/type/Number value cause conflict, not overwrite.
- Habit definition preview, explicit Notion↔existing SP SimpleCounter links, pinned occurrence property IDs; current SP logical day only. Duplicate/moved/unlinked daily rows must never receive a PATCH.
- v0.28 alternative for boards with NO habit count Number: confirm existing Status ID and exact existing done/unfinished options; preview original habit-day + original definition/counter ID and positive current-day SP counter; **manually** verify the target was actually reached. Only after distinct authorization, PATCH exactly that single existing Status on the existing original page. Reject duplicate/moved day rows, stale Status, changed counter, lost consent and schema ID replacement. Never infer habit completion automatically from mere positive counter progress. Never touch `الوقت الفعلي` for ClickCounter values.
- Automatic habit consent **per definition and counter**: only definitions individually reviewed and explicitly approved get a nonsecret allowlist record; unrelated linked habits do not. A later day only updates an **already-existing** matching row for that same approved definition.
- All confirmed Notion PATCH operations must target exactly one existing pinned Number property on the original existing page. No page creation/deletion, property creation, database migration, parent relation updates or automatic Notion status edits.

## Opt-in automatic modes (L4/L5)

Every automatic mode is OFF by default and requires separate local per-device authorization. Verify seeding and baseline creation use synced **nonsecret** metadata and never mutate Notion/SP work data:

- Notion → SP planning: previously matched and individually anchored task plan updates only. Offline local planning edits different from the last agreed baseline are skipped; no task creation/deletion; no reprocessing of unchanged tasks.
- SP → Notion tracked actual time: matching positive baseline must be seeded after reviewed manual export; only monotonic `timeSpent` changes qualify. A different current Notion Number or local reduction prevents automatic PATCH.
- SP → Notion habit-day Number: current SP logical day, per-definition approval ID, existing row, positive compatible counter, exact mapping fingerprint, no duplicate rows; no unreviewed definitions or new row generation.

Enable **one device only** for test writes. Observe its local-only diagnostic screen, not SuperSync delivery as a proven acknowledgment. Check startup checks, periodic bounded batches, the shared 450ms request lane and bounded retry of *explicit* 429 rejection only. Disable mid-flight and verify no not-yet-started write occurs. Never blindly retry a lost/unknown PATCH response. Use read-only reconciliation after failure; verify no duplicate PATCH is sent on the next run.

## L5 device test matrix

| Scenario | Windows desktop | Android | Acceptance |
|---|---|---|---|
| SP foreground and plugin opened | Test | Test | UI, hooks and local credentials work |
| App backgrounded / screen locked | Test | **Required** | Document delays and lost timers; do not claim always-on automation |
| Offline → reconnect | Test | Test | No duplicate page link, stale baseline or number overwrite |
| SuperSync across two devices | Test | Test | One writer enabled, other disabled; eventual SP task values agree |
| Two writers accidentally enabled | Negative test in disposable profiles only | Negative test | Detect/document unresolved lock risk; do **not** certify concurrency safety |
| Day rollover and timezone changes | Test | Test | Only SP logical-day existing habit rows are processed |
| 429, 503, timeout, PATCH success with lost response | Test/mocked fault injection | Test as possible | 429 bounded; unknown write is not blindly replayed |
| Plugin disable/reload | Test | Test | Timers end, no new requests, local enable flags remain explicit |

## Focus timer truthfulness

- Verify the plugin observer sees only future starts/completions while it is active, and **never** claims it has the complete historical session ledger.
- An observed automatic Pomodoro may count once by verified session ID in a **separate existing Number labeled partial/lower-bound**, never in the authoritative `Completed Pomodoros` field.
- Flowtime and Countdown are not converted to fictitious Pomodoro completions. Timer work time is not itself completed-session evidence. Breaks are excluded.
- Production-grade historical completed Pomodoro, Flowtime and Countdown counts **remain blocked** until the official SP Plugin API exposes a durable historical session record with task, mode, automatic/manual state and a stable session ID (or equivalent verified data).

## Acceptance / release decision

**Do not declare production-ready** until L3–L5 have passed on disposable data, the historical security note in `SECURITY.md` is addressed (including revoking any historically exposed Notion token), and the user has accepted an explicit policy for the unresolved multi-device write lock and future missing habit-day row creation. Do not silently add Notion fields, modify personal pages or alter SuperSync settings. The expected failure mode is *skip + visible conflict*, never a guessed write. CI alone certifies only L1.

_Last updated: 2026-11-16. Version: v0.23 experimental acceptance plan (partial L3 passed)._
