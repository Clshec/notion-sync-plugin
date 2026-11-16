# Alf Notion Super Productivity

**Status: v0.14 experimental Notion preview, manual task import, observed focus sessions, and explicitly approved writeback of SP tracked work and existing habit-day values. Not yet a bidirectional synchronization plugin. Do not connect production data until tested on a disposable Notion integration and Super Productivity profile.** This is a public, MIT-licensed fork of [AlessioLovato/notion-sync-plugin](https://github.com/AlessioLovato/notion-sync-plugin), originally written by **Alessio Lovato**. The MIT copyright and LICENSE are preserved.

## Why this fork exists

**Notion is the planning authority and long-term record; Super Productivity is the fast, local-first execution tool** for Desktop and Android. The goal is to preserve existing Notion databases and their relations while using SP's tasks, parent/subtasks, habits, day planning, time estimates, tracking and Pomodoro/Flowtime/Countdown modes.

There must be **no requirement to create new Notion databases**. Existing properties can be mapped to SP fields through a future general configuration UI. Optional missing properties may be added only after user approval. The plugin must remain reusable by any Notion user, not tied to a particular workspace.

## Important safety notice

The inherited upstream alpha used fixed English property names and unsafe writes. This fork has **removed the old write engine** and replaced it with an opt-in read-only preview, but has not validated a production integration. It also does **not** provide accurate per-task completed Pomodoro session history via the official Plugin API.

**v0.14 introduces a deliberately narrow, opt-in background Notion → SP planning refresh for explicitly seeded, already-linked tasks only. All Notion writes, imports, time/habit/focus exports and other synchronization remain manual and separately authorized. This is NOT a fully automatic or bidirectional sync engine. Test only against disposable Notion and SP data until the integration verification phase finishes.**

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

### New v0.14: opt-in automatic Notion → SP planning refresh while the plugin is running

This release introduces the first limited automatic operation, **not** fully automatic Notion ↔ SP synchronization. Once enabled on a specific device, the main `plugin.js` periodically reads the original existing Notion task source and **updates only the four documented SP planning fields**: title, planned work estimate, date-only execution day and timed execution date. It does **not** create SP tasks, modify Notion pages or properties, touch tracked actual work, status, tags, hierarchy, habits, or completed Pomodoro totals. Notion remains the planner and SP remains the local execution tool.

**Safe enablement:** First import/link tasks as before. Make sure they have matching Notion and SP planning values (use the reviewed manual update in section 4b for differences), then preview and select those tasks and check **Prepare matching selected tasks for safe automatic refresh**. This stores a per-task *baseline* (Notion page ID, SP task ID, project/parent identity, exact mapping signature and the last agreed SP title/estimate/date) in Alf's synced metadata. Neither Notion nor SP is written during preparation. Pin all the mapped task field IDs first. Then, on **one device only**, check the separate opt-in checkbox and choose **Enable this device**. This per-device flag is kept in the host's local-only secret store, independent of the locally stored Notion API token; **the flag and token are not sent via SuperSync**. The individual task baselines *are* synced, so the plugin can recognize its own linked tasks across sessions. There is a separate device-local Disable control, and the default is disabled.

**Automatic behavior:** The plugin checks after starting (if enabled) and then roughly every 10 minutes while Super Productivity and the plugin runtime are active. Up to eight previously seeded tasks are checked per cycle, rotating through the list. For each eligible task it rechecks the stable Notion data-source/property IDs, allowed task type, explicit Notion↔SP synced link and unique exact page marker, active and unfinished/nonrecurring status, original project/parent, and the saved planning baseline. If a local SP planning field has diverged since that baseline **without exactly matching the current Notion plan**, the whole task is skipped as a conflict; no automated overwrite of an offline edit. It also re-reads the current SP values, synced link and baseline immediately before updating. After a successful update, the new baseline is saved; unchanged cycles do not write metadata repeatedly. Absent Notion dates and estimates never clear SP values. Stale anchors, missing Notion tokens, changed mappings, moved pages, changed property IDs and API errors fail closed.

**Important limitations:** This is experimental and **not** an always-on cloud service: Android may suspend the plugin's timers when backgrounded/killed; an offline device cannot poll Notion; Notion API rate limiting can delay cycles. On startup and reactivation no guaranteed catch-up scheduler exists. The per-device toggle is intentionally separate, but two devices simultaneously enabled still have **no distributed lock or cross-device atomic transaction** and may interfere via SuperSync. Therefore enable only on one device during sandbox testing. The final Notion GET and SP update are not atomic; simultaneous edits can still race. There is no automatic SP → Notion time, Pomodoro or habit export. Cross-device and Android foreground/background tests are pending. All actual Notion writes retain the previous separate reviewed opt-in flows.

### New v0.13: revalidate today's whole habit occurrence set before writeback

A second device or another Notion automation may add another `اللوح` habit/day occurrence **after** the user stages an initial read-only diff. Before any authorized Number PATCH, Alf now re-queries **all matching existing Notion habit/day rows** (bounded/paginated, refusing truncated results) and groups them by habit definition ID and Super Productivity logical day. Only a candidate with **exactly one current occurrence, matching the originally reviewed Notion page ID**, may continue to the existing schema, link, counter, page identity and numeric conflict checks. A newly duplicated, removed or replaced daily row is skipped, rather than writing to an arbitrary occurrence. An unrelated new habit for the same day does not block the original habit's update. This does not create or delete any Notion records.

There is no cross-device transaction lock or atomic Notion compare-and-swap: changes occurring between the final query and PATCH are still possible. Production use remains blocked pending a full integration/sync validation.

### New v0.12: rename-safe existing Notion habit fields, with stricter daily writeback guards

Habit definitions remain in the existing Notion habit database and habit occurrences remain in the existing board/task database. Users can now **Pin existing habit field IDs** in the plugin to preserve a stable mapping for the definition's title and cadence, and for the occurrence's type, relation to definition, execution day and numeric count/duration. Pinning reads the existing Notion data-source schemas and saves field IDs in synced **nonsecret mapping metadata**; it never creates or renames a Notion database, page, property, habit or counter. This builds on the previously implemented task-field pins and leaves those pins intact.

The definition preview and manual Notion-habit ↔ existing SP SimpleCounter mapping resolve the pinned field identities even if the display labels are translated from Arabic to English. Daily occurrence queries use the pinned property IDs in Notion filters, and the explicitly authorized daily count writeback PATCH uses the pinned **Number property ID**, not its mutable display name. If an ID was removed/replaced, there is no fallback to a different field with the same name; validation fails rather than risking the historical record.

**Safety change:** before writing daily habit counts, the user must pin **all four existing occurrence properties** (type, definition relation, logical day, and count). Previews of habit definitions remain readable with old name-based configurations, but existing v0.11 users need to click the new pin action before resuming the manually approved habit-day writeback. The plugin also re-reads the current Notion schema immediately before the write and verifies that the habit definition → SP counter ID link is unchanged since preview. It continues to guard on the SP logical day, a matching existing occurrence row and relation, and an unchanged Notion numeric value. No silent create, deletion or default failure status is introduced for habits, including break/avoidance habits.

**Remaining:** This does not provide automatic habit definition creation in the SP Habit Tracker, new Notion day occurrence creation, a cross-device lock, conflict-free bidirectional sync, or authoritative historical focus-mode sessions. Real Android/Windows/sandbox Notion tests remain necessary before production use.

### New v0.11: Notion planning refresh on existing Super Productivity tasks (manual)

This release advances the Notion-first workflow: Notion remains the planning source and Super Productivity remains the local execution/timer app. After importing a task once, future title, planned work estimate, and execution date changes in the **same existing Notion board** can be reviewed and applied to that **existing linked SP task**, without deleting or recreating tasks. This also updates the SP estimate from which the current Pomodoro target can be calculated. No new Notion database, property, task or habit is created.

Workflow: preview Notion tasks → check the intended rows → **Review Notion planning differences** → inspect each field's old/new value → separately check the authorization box → **Update reviewed SP plans**. The action changes only the official SP task fields `title`, `timeEstimate`, `dueDay` and/or `dueWithTime`. A title containing `#tag`, `@date` or other short syntax is preserved verbatim. `timeSpent`, `isDone`, tags, notes, `projectId`, subtasks, and habit counters are never sent in update payloads. Blank Notion dates or estimates are not treated as requests to clear existing SP values.

An entry is eligible only if its original Notion page ID matches an exact task marker and the independent persisted link, it is an active **not archived, unfinished, non-recurring** SP task, and Notion's item type remains explicitly allowed. Before any update the plugin re-fetches Notion's source schema and page, checks the page still belongs to the configured source and has the identical reviewed plan, rechecks local SP field values, project and parent task ID, and skips stale or ambiguous items. No action runs automatically, so it cannot race SuperSync in response to every remote change. The source is **Notion → SP planning only**; SP → Notion work tracking/partial observed Pomodoros and habits remain separate, explicitly reviewed actions.

Limits: This is an experimental **manual sync step**, not a background bidirectional engine. It does not synchronize Notion status, project hierarchy, bulk task deletion, blank-field clearing or full focus sessions. There is no atomic transaction between Notion's GET and SP's update; production rollout needs sandbox tests on Windows and Android, error recovery, and offline/duplicate-device orchestration. Nothing touches users' real Notion data from repository CI.

### New v0.10: explicit manual export of an observed Pomodoro *lower bound*

A user may optionally map a **separate existing Notion Number property**, such as `Observed Pomodoros (partial)`, for a carefully bounded count of actual **observed** automatic Pomodoro completions. This **must not** be your authoritative `Completed Pomodoros` field. The count is an incomplete, cumulative per-task minimum: historical sessions, Android background restrictions, missing hook events and plugin restarts may all produce undercounts. Only the official observer's records with stable unique session IDs, known linked SP task IDs and a verified automatic Pomodoro completion qualify. No Pomodoros are inferred from tracked time.

Workflow: configure the existing Notion board source/property, click **Pin task property IDs** to lock the Number property's identity, run the standard task preview, select linked tasks, click **Review observed Pomodoro minimum** and inspect the staged `before → after` values. The **separate authorization checkbox** and **Write reviewed observed minimum** action are mandatory for any update. The writeback re-reads the Notion schema and page, checks original data source/type/property/value, re-reads the SP task mapping and the full observer key inventory, and aborts stale/conflicting items. It never overwrites a larger existing number or writes zero. More than 2,000 records refuse rather than silently truncate. Only one existing Number property is patched per page. There is no background timer/network action, no automatic sync and no creation/renaming of Notion databases, pages or properties. Tests are mocked; real SP Desktop/Android and Notion sandbox integration are not yet verified.

**This is a review-only alpha bridge, not a solution to the upstream focus-session API gap.** The stable per-task/per-mode authoritative historical session API is still required for dependable `Completed Pomodoros` synchronization. Some GET/PATCH races cannot be prevented with Notion's public API, so do not use this with production data yet.

### New v0.9: read-only Pomodoro planning versus observed SP focus sessions

The Notion task preview now displays a **Planned Pomodoros** target derived solely from the existing configured estimate field (`Planned Time` / `الوقت المخطط له`) and an explicit **Pomodoro work interval (minutes)** setting (defaults to 25, allowed range 1–180). No Notion property is added: `ceil(plannedMinutes / workIntervalMinutes)` is computed locally. Match this interval with Super Productivity's timer settings; the plugin does not modify SP focus or break settings.

The preview also includes an **Observed focus (incomplete)** column. After previewing/importing already-linked tasks, press **Read observed focus sessions and compare to the task preview**. The existing verified action observer's per-session synced metadata is grouped by unique ID and associated only with unambiguous SP task markers. The column shows observed **P** (automatically completed Pomodoro), **F** (Flowtime finish), and **C** (Countdown finish) separately. An unobserved session is **unknown**, never proof that the user did no work. This comparison is read-only, never updates Notion or the SP timer, and cannot backfill history or guarantee every completion was captured (e.g. Android background restrictions).

**Do not use observed counts as complete authoritative Pomodoro history.** Automatic per-task Pomodoro/Flowtime/Countdown writeback to Notion is still blocked pending a supported reliable historical SP session API and cross-device validation. No Notion database or property is created by this feature.

### New v0.8: opt-in stable Notion task property IDs (rename-safe)

The task/board mapping still accepts normal existing property labels, so old v0.7 configurations remain readable. After entering the existing source and fields, save settings, then click **Pin task property IDs (mapping only)** before renaming fields in Notion. This fetches only the existing Notion data source schema and stores each selected task field's immutable Notion property ID alongside its original label/source ID inside synced **nonsecret** mapping metadata (`alf-mapping-v2`). It neither creates a Notion property/database nor modifies SP tasks.

Pinned IDs are used for task previews, selected bundle/subtask imports, execution day/deadline/estimate/status/priority, and the explicitly authorized Actual Time Number writeback. Notion page properties are looked up by the returned property `id`, even when Notion has changed the display key/name. Notion time PATCH uses the pinned property **ID**, not the renamed label, while still rechecking page identity, allowed item type, and the unchanged existing value.

**Fail closed:** A pinned ID is valid only for the source ID and input label it was pinned with. If the field ID disappears or its type changes, operations stop rather than attaching to a different same-name field. To intentionally change a mapping, edit the input and pin again; always rerun the preview afterward. Notion API schema responses without property IDs cannot be pinned. v0.8 pins **task fields**; habit definition and daily occurrence field IDs are not yet supported. No automatic synchronization, real-device verification or reliable historical Pomodoro session export is claimed.

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
