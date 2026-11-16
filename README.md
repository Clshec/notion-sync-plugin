# Alf Notion Super Productivity

**Status: v0.7 experimental Notion preview, manual task import, observed focus sessions, and explicitly approved writeback of SP tracked work and existing habit-day values. Not yet a bidirectional synchronization plugin. Do not connect production data until tested on a disposable Notion integration and Super Productivity profile.** This is a public, MIT-licensed fork of [AlessioLovato/notion-sync-plugin](https://github.com/AlessioLovato/notion-sync-plugin), originally written by **Alessio Lovato**. The MIT copyright and LICENSE are preserved.

## Why this fork exists

**Notion is the planning authority and long-term record; Super Productivity is the fast, local-first execution tool** for Desktop and Android. The goal is to preserve existing Notion databases and their relations while using SP's tasks, parent/subtasks, habits, day planning, time estimates, tracking and Pomodoro/Flowtime/Countdown modes.

There must be **no requirement to create new Notion databases**. Existing properties can be mapped to SP fields through a future general configuration UI. Optional missing properties may be added only after user approval. The plugin must remain reusable by any Notion user, not tied to a particular workspace.

## Important safety notice

The inherited upstream alpha used fixed English property names and unsafe writes. This fork has **removed the old write engine** and replaced it with an opt-in read-only preview, but has not validated a production integration. It also does **not** provide accurate per-task completed Pomodoro session history via the official Plugin API.

**There is no automatic sync. Manual SP import and separate Notion Actual Time Number writeback are opt-in actions with distinct confirmation checkboxes. Test only against disposable Notion and SP data until the integration verification phase finishes.**

An inherited test document contained an integration credential that has been removed from the current default-branch file. It remains potentially exposed in Git history. **Revoke/rotate the affected Notion integration credential immediately.** See [SECURITY.md](SECURITY.md). Never commit secrets.

## Current v0.4 workflow (PRs #2–#4)

The fork now contains **read-only Notion exploration, explicit SP task import, and explicit tracked-time export**, not an automatic synchronization engine:

1. Install into an isolated test instance of Super Productivity **20.0.0+** (Desktop or Android). The installed plugin must be packaged with the root `manifest.json`, `plugin.js`, `index.html`, icon, and license; no ZIP release is published yet.
2. Open **Alf Notion**, enter an internal Notion integration token (per-device, local secret storage). Do not reuse an exposed integration token.
3. Paste the **data source ID** of your existing Notion Tasks source. A database ID is not interchangeable. The Notion integration must be shared with that source.
4. Map existing Title and item-type property labels, and give the exact allowed task and bundle values. Other fields are optional and checked against existing types.
5. Choose **Inspect existing data source schema** (Notion GET), then **Preview matching tasks**. The preview queries Notion pages using the **2026-03-11** API and reads SP active tasks for counts. It shows up to 75 matched rows and scans up to 300 pages per click.
6. **The preview itself never writes.** For an optional **manual import**, select individual task rows, choose an existing SP Project, tick the explicit authorization checkbox, then press the separate SP import action. Only then can SP tasks be created, with parent bundles first and unresolved subtasks skipped rather than flattened. No Notion API writes occur during import. The importer embeds a Notion ID in task notes, stores per-page links via keyed sync state and checks active/archived SP tasks to avoid retries duplicating tasks. Do not start simultaneous imports from multiple devices.
7. To push verified actual **work time** from SP back to Notion, map an existing Notion Actual Time Number property, select the already linked tasks in the preview, click **Preview actual time differences**, inspect the exact old/new values, tick the separate writeback authorization box, and click **Write reviewed actual time to Notion**. The only Notion mutation is a PATCH of the configured Number property after fresh source/type/value checks. Never infer completed Pomodoros from this aggregate.

Token is stored via `PluginAPI.setSecret` on the device, not in `persistDataSynced`, and never exported from the UI; SP's local plugin secret storage is **not hardware-encrypted**. Nonsecret field/source mapping uses a **keyed synced entry**. The module uses the SP guarded HTTP bridge and pins `api.notion.com` as its only allowed host. Tested with mocked PluginAPI; **real Android/Desktop runtime integration is still pending**.

### Manual import safeguards and known gaps

- Choose **one existing SP project** as the batch destination. Mapping a Notion project relation to multiple SP Projects is not yet implemented.
- Select individual rows from the preview and tick the **authorization checkbox**. No task is written on view load, save, query or preview.
- `حزمة` or any other item with dependent subtasks is imported as a **parent task** (not a folder); subtask `الحزمة الأب` relation becomes `parentId`. Missing parents block the dependent item.
- Title, planned estimate, execution date/time, separate deadline, completion status and priority can be mapped from user-selected existing properties. `timeSpent` is **not** imported from Notion because actual work originates from SP.
- Each Notion task has a keyed mapping and a Notion page ID marker in SP task notes to help recover safely after crashes and avoid duplicate imports.
- Simultaneous manual import on multiple devices is not transactionally safe yet. Do not install this experimental build into a valuable SP profile.
- A true bidirectional conflict resolver, automatic project association, **automatic** time sync, and exact Pomodoro counts remain future PRs.

### Architectural constraints
- Existing Notion sources are reused, no new Notion database or properties are created.
- No Pomodoro completions are fabricated from task durations; session API support is a separate implementation prerequisite.
- Notion owns planned schedule, deadlines, estimates and habit definitions; SP owns observed time and actual sessions.
- Tasks with item types outside the explicit allowlist (knowledge, finance, learning, etc.) must be ignored.

### New v0.5: observed Pomodoro / Flowtime / Countdown (no Notion writes)

- The host `plugin.js` registers `ACTION` and `CURRENT_TASK_CHANGE` hooks to observe sessions that start and finish **while Alf is active**. There is no background timer or network request.
- Mode must be explicitly known from SP's locally persisted mode or a `[FocusMode] Set Mode` event; task identity must be known from the start action or tracking context.
- Only an explicitly automatic completion of an observed `Pomodoro` is counted as a **verified automatically completed Pomodoro**. Manually ended sessions do not increase that number. Flowtime and Countdown are tracked separately.
- Each observation is stored under a distinct per-session synced metadata key. The UI has **Read locally observed focus sessions** to show counts by SP task ID. This does **not** change any Notion property.
- **Limitations:** no historical backfill, no guarantee every SP session is observed, app restarts can interrupt the observer, task/mode ambiguity causes deliberate gaps, `completedDuration` is usually unavailable in the action itself, and these counts must not be pushed as authoritative Notion analytics until validated by a proper structured official SP session API.
- See [session observer architecture and upstream API proposal](docs/architecture/observed-focus-sessions.md).

### New v0.6: habit definition mapping (not daily habit synchronization yet)

- The user specifies the **existing** Notion habit-definition data source ID, title property and optional cadence Select property; the plugin performs **read-only** schema discovery and paginated preview.
- Existing SP Habit Tracker SimpleCounters are read from `PluginAPI.getAppState().simpleCounters`, without modifying the counters or creating a new one.
- The user picks the **specific existing counter** to link to each Notion habit. The linkage is stored as keyed plugin metadata using Notion habit page ID + SP counter ID. No Notion database, page, habit occurrence or field is created.
- The preview can display today's **device-local** counter count, but that value is **not** currently pushed to Notion; date handling needs the app's configurable logical-day semantics in a later phase.
- See [habit definition & counter mapping architecture](docs/architecture/habit-mapping.md). This mapping is only a foundation for actual habit-day reconciliation.

### New v0.7: existing habit-day execution writeback (opt-in only)

- Configure fields **already present in the Notion task/board source**: item type (`عادة`), single relation to the original habit definition, execution day and an optional pre-existing numeric completion/count value property.
- Alf resolves an existing Notion habit definition → SP SimpleCounter mapping by ID and SP's official `getDayContext().todayStr` logical day; if the API is absent, writeback is disabled.
- Preview reads matching date/type-filtered **existing Notion habit occurrence rows** and the counter's `countOnDay` value. Missing rows and missing mapping are skipped, never auto-created.
- Positive `ClickCounter` values are counts; `StopWatch` values are ms and can be converted to explicitly chosen minutes/hours.
- A separate authorization checkbox enables updating **only the existing Number property** after refetching the same Notion page and rechecking the source/type/day/relation/current value and latest SP counter value.
- Duplicate habit-day rows, a newer Notion manual correction, missing logical-day support, stale devices and ambiguous relations are skipped instead of overwritten.
- **No automatic background sync, new Notion database, new habit definition, new daily occurrence, or property creation.** See [habit-day writeback design](docs/architecture/habit-day-writeback.md).

## Architecture and design contracts

- [Architecture / authority / safety and Pomodoro API gap](docs/architecture/alf-sync.md)
- [Field mapping: execution date, deadline, estimate, actual time, status, habits](docs/architecture/field-mapping.md)
- [Safeguards for manual actual time SP → Notion](docs/architecture/time-writeback.md)
- [Prioritized work / proposed GitHub Issues](docs/roadmap/ISSUES.md)
- [Security policy](SECURITY.md)

### Core mappings

| Notion planned information | Super Productivity |
|---|---|
| Existing project relation | Project |
| Existing task item | Task |
| Bundle and bundle-parent relation | Parent task + Subtask |
| Execution day / scheduled time | `dueDay` / `dueWithTime` |
| **Independent deadline** | `deadlineDay` / `deadlineWithTime` |
| Estimated work | `timeEstimate` (milliseconds) |
| Work logged | `timeSpent` / `timeSpentOnDay` |
| Planned Pomodoro target | derived from time estimate and configurable work interval |
| Real completed Pomodoros | requires reliable completed-session API/event source |
| Habit definition / day record | SP Habit Tracker / SimpleCounters |

### Time and Pomodoro policy

SP focus and timer work happen locally. Notion receives actual work/verified sessions and preserves its independent plan. Breaks must not count as focus time; completed Pomodoros cannot be computed from rounded total hours. The upstream API currently lacks a cross-platform per-task/per-mode focus-session history interface. Until fixed, **focus-session synchronization is planned, not implemented**.

### Multi-device

The plugin will use SP's native SuperSync data mechanism without replacing or interfering with it. Plugin **code** must be installed on each device separately; tokens are device-local, not stored with synchronized plugin configuration. All remotely observed updates must be idempotent to avoid duplication.

## Development workflow

- Base branch: `main`; feature work: dedicated branches and GitHub Pull Requests.
- Do not merge code without safe mapping, credential isolation and integration tests.
- Github Issues are currently disabled on the fork; enable in repository Settings → General → Features → Issues to turn [the backlog](docs/roadmap/ISSUES.md) into live Issues.
- The inherited unsafe engine is removed in v0.2; `plugin.js` is only a header entrypoint while the iframe `index.html` performs read-only Notion schema inspection, filtered task preview, and explicitly authorized one-way SP import.

## License and provenance

MIT — see [LICENSE](LICENSE), including the original 2025 copyright for Alessio Lovato. Contributions to this fork retain that notice.
