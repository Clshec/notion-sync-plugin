# Alf Notion Super Productivity

**Status: v0.24 experimental Notion-first integration: three separately opted-in automatic paths (linked SP task planning pull, monotonic tracked actual time, explicitly approved existing habit-day counts) plus reviewed manual import and partial observed focus sessions. All automatic modes are OFF by default. This is not full or cross-device-safe bidirectional sync. Windows SP 20.0.0 isolated profile ZIP installation and plugin side-panel opening passed; live Notion and Android integration remain untested. Do not connect production Notion data yet.** This is a public, MIT-licensed fork of [AlessioLovato/notion-sync-plugin](https://github.com/AlessioLovato/notion-sync-plugin), originally written by **Alessio Lovato**. The MIT copyright and LICENSE are preserved.

## Why this fork exists

**Notion is the planning authority and long-term record; Super Productivity is the fast, local-first execution tool** for Desktop and Android. The goal is to preserve existing Notion databases and their relations while using SP's tasks, parent/subtasks, habits, day planning, time estimates, tracking and Pomodoro/Flowtime/Countdown modes.

There must be **no requirement to create new Notion databases**. Existing properties can be mapped to SP fields through a future general configuration UI. Optional missing properties may be added only after user approval. The plugin must remain reusable by any Notion user, not tied to a particular workspace.

## Important safety notice

The inherited upstream alpha used fixed English property names and unsafe writes. This fork has **removed the old write engine** and replaced it with an opt-in read-only preview, but has not validated a production integration. It also does **not** provide accurate per-task completed Pomodoro session history via the official Plugin API.

**As of v0.23, three narrow automatic engines are implemented behind separate OFF-by-default local-device opt-in: Notion → linked SP planning, SP → existing Notion actual time and SP → explicitly approved existing Notion habit-day Number. They do not create Notion databases/pages/properties or new SP tasks. Manual import and partial observed-Pomodoro writeback remain separately reviewed. This is not a full bidirectional or multi-writer-safe system. Test writes only with disposable Notion/SP data.**

An inherited test document contained an integration credential that has been removed from the current default-branch file. It remains potentially exposed in Git history. **Revoke/rotate the affected Notion integration credential immediately.** See [SECURITY.md](SECURITY.md). Never commit secrets.

## Current v0.23 starting workflow (original manual import and review)

The original safe manual workflow remains available alongside the newer opt-in background engines. Start with **read-only Notion exploration, explicit SP task import, and reviewed tracked-time export**:

1. Install into an isolated test instance of Super Productivity **20.0.0+** (Desktop or Android). The installed plugin must be packaged with the root `manifest.json`, `plugin.js`, `index.html`, icon, and license; no ZIP release is published yet.
2. Open **Alf Notion**, enter an internal Notion integration token (per-device, local secret storage). Do not reuse an exposed integration token.
3. Paste the **data source ID** of your existing Notion Tasks source. A database ID is not interchangeable. The Notion integration must be shared with that source.
4. Map existing Title and item-type property labels, and give the exact allowed task and bundle values. Other fields are optional and checked against existing types.
5. Choose **Inspect existing data source schema** (Notion GET), then **Preview matching tasks**. The preview queries Notion pages using the **2026-03-11** API and reads SP active tasks for counts. It shows up to 75 matched rows and scans up to 300 pages per click.
6. **The preview itself never writes.** For an optional **manual import**, select individual task rows, choose an existing SP Project, tick the explicit authorization checkbox, then press the separate SP import action. Only then can SP tasks be created, with parent bundles first and unresolved subtasks skipped rather than flattened. No Notion API writes occur during import. The importer embeds a Notion ID in task notes, stores per-page links via keyed sync state and checks active/archived SP tasks to avoid retries duplicating tasks. Do not start simultaneous imports from multiple devices.
7. To push verified actual **work time** from SP back to Notion, map an existing Notion Actual Time Number property, select the already linked tasks in the preview, click **Preview actual time differences**, inspect the exact old/new values, tick the separate writeback authorization box, and click **Write reviewed actual time to Notion**. The only Notion mutation is a PATCH of the configured Number property after fresh source/type/value checks. Never infer completed Pomodoros from this aggregate.

Token is stored via `PluginAPI.setSecret` on the device, not in `persistDataSynced`, and never exported from the UI; SP's local plugin secret storage is **not hardware-encrypted**. Nonsecret field/source mapping uses a **keyed synced entry**. The module uses the SP guarded HTTP bridge and pins `api.notion.com` as its only allowed host. CI uses mocked PluginAPI. **A real SP 20.0.0 Windows isolated ZIP installation and side-panel opening passed; real Notion API and Android integration are still pending.**

### New v0.24: a single SP task must never claim multiple original Notion pages

An SP task can have arbitrary editable text notes; previously a note containing **two exact** `alf-notion-page-id:` tokens pointing to distinct Notion pages could qualify for both pages, allowing duplicate tracked-time export or ambiguous planning. v0.24 rejects **any** SP task with multiple page ID tokens in manual import/relink, staged planning, time export, observed Pomodoro association and both automatic task engines. Only a unique, full, whitespace-delimited original page ID token together with its independent synced Notion↔SP page/task link is accepted. A separately authorized manual import still safely recovers a single valid missing ID link without creating another SP task; a task claiming two page IDs fails closed and is never adopted. Regression tests cover manual linking and both automatic plan/time paths. No production Notion or SP data was used.

### New v0.23: verified isolated Windows SP 20.0.0 plugin install and side-panel launch

The plugin was tested in the **actual Windows Super Productivity 20.0.0 executable** using an independent disposable Electron `--user-data-dir` outside the user's regular SP profile. The test ZIP contained the required root `manifest.json`, `plugin.js`, `index.html`, `notion.svg` and original MIT `LICENSE`. In **Settings → Plugins → Choose Plugin File**, SP successfully installed **Alf Notion Super Productivity v0.22.0**, displayed the icon, author, upload permissions and hooks, added the Notion header button, and opened the real iframe side panel showing the Notion data-source mapping controls. **No Notion credential was entered, no real Notion API was invoked, no SP SuperSync service was configured, and no production data was accessed.** The disposable Electron processes were explicitly stopped and the ZIP, checkout and isolated profile folder removed. This establishes **L3 partial host/UI installation success**, not an end-to-end Notion/Android sync verification. The plugin intro was also updated for v0.23 to accurately describe the three opt-in automatic engines, all disabled by default; it previously stated incorrectly that there was no automatic synchronization.

Important: The plugin is *not* yet production-ready. It remains necessary to test the actual Notion 2026-03-11 data-source GET/PATCH against a disposable integration, verify local v20 plugin hooks/secret/synced metadata and all three engines under controlled write approval, and validate Android background suspension + Windows/Android SuperSync consistency. The public Plugin API still does not supply a complete authoritative historical per-task focus-session ledger. No ZIP or new file was delivered to the user from this smoke test.

### New v0.22: missing Notion pagination cursors cannot hide duplicate habit-day rows

The manual and automatic habit-day Notion data-source query loops now **fail closed** if Notion reports `has_more: true` but omits a usable `next_cursor`. Previously, a malformed/incomplete response could silently stop pagination and conceal a duplicate existing habit/day occurrence; this could incorrectly authorize writing a Number to a row that should have been rejected as ambiguous. The plugin now refuses the entire affected preview or automatic cycle without any Notion PATCH. The existing 300-row bound and duplicate-group checks remain in force. Mock tests cover this malformed pagination response for both manual and automatic habit-day routes. No production Notion data was touched. The plugin UI footer was corrected to reflect the three existing opt-in automatic paths, all OFF by default; it no longer incorrectly claims there is no automatic engine.

### New v0.21: strict original Notion↔SP task identities and updated acceptance plan

**Identity security fix:** It is not sufficient to find `alf-notion-page-id:<page-id>` as a substring inside arbitrary editable Super Productivity task notes: `alf-notion-page-id:<page-id>-other` could otherwise be mistaken for the original linked task. All manual import deduplication, reviewed SP planning updates, actual tracked-time export, observed partial-Pomodoro writeback and the focus comparison report now demand the **exact whitespace-delimited page-marker token**. Any task being updated also requires an independent, existing synced `alf-page-link-` record with the matching original Notion page ID and SP task ID; editable notes alone can no longer authorize writing task plans or Notion properties. If a link is missing but the marker is exact, the separately authorized manual import path can recover it without creating a duplicate SP task. Changed/missing/ambiguous markers or multiple claimed SP tasks are always skipped/blocked.

The previously outdated `TEST_PLAN.md` has been replaced with the actual v0.21 acceptance gates: Super Productivity v20, Notion API 2026-03-11 **data sources**, a disposable integration and existing test databases only, opt-in one-device automation, separate host/plugin startup checks, clone/relink/rename/duplicate/Notion-unknown-PATCH cases, and explicit criteria for Android/Windows acceptance. The installed Windows Super Productivity v20.0.0 was launched and verified in a separate temporary `--user-data-dir` sandbox, then its process and sandbox directory were removed. **This validates isolated host startup only, not plugin installation or live Notion/Android behavior.** No real Notion data or the user's main SP profile were modified by that smoke test.

### New v0.20: one Notion API request lane across all automatic engines

The three separate opt-in background engines (planning pull, actual-time Number export, and explicitly approved existing habit-day updates) now use a **shared serialized request queue within one SP plugin runtime**. It spaces automatic HTTP requests by at least **450 ms** in the running host, avoiding the startup burst where all three engines could hit the same Notion integration's roughly 3-requests/second average rate limit. The UI's separately user-triggered manual Notion operations are not part of this lane, and it cannot coordinate multiple devices, other Notion integrations or external automations. Disabled engines continue to send no HTTP requests.

An explicitly rejected Notion HTTP **429** response is retried **once**, with a bounded pause (using a trusted Retry-After value when provided). Other errors, network disconnects, timeouts, ambiguous HTTP outcomes and server errors **do not cause blind retries**, particularly not for a PATCH whose original outcome may be unknown. In those cases the existing numeric baseline/review conflict checks must determine whether another write is safe. The queue continues processing the next engine's requests even if a previous request fails. No new Notion database/row/property or SP task is created.

Automated tests check serialization across concurrent requests, the minimum interval, bounded 429 handling, no replay after unknown PATCH, rejection of server errors, and recovery of the request queue after a failure. This does **not** constitute a global cross-device lock, durable background service, Notion transactional compare-and-swap or authoritative completed Pomodoro ledger. Real Windows/Android plugin integration remains pending.

### New v0.19: mandatory individual habit approvals (fixes overly broad v0.16 auto consent)

**Important behavioral correction:** previously, enabling automatic existing habit-day export after previewing the current day allowed the engine to examine any linked habit definition in that Notion source. That was **too broad** for explicit user permission: an unrelated but linked habit might receive an unrequested Number update. v0.19 **fails closed** until each individual habit definition/counter pair is separately recorded as approved during the user's explicit opt-in.

**Approval flow:** In the existing board's **Preview today's existing habit-day differences** action, Alf now identifies eligible individually linked habits *separately* from the manual writeback differences. Only unambiguous existing rows for the SP logical day with a compatible positive SP counter value, a blank/zero Notion Number or an **exactly matching** positive Notion Number, and a unique definition→counter link are candidates. A nonzero mismatched Notion Number, duplicate occurrence, missing relation, incorrect counter type or zero SP count cannot become an automatic approval. When the user checks the separate automation consent and enables it, Alf re-queries the complete current day inventory, validates that the same original page and Number were reviewed, the SP counter is still the reviewed value and the definition↔counter ID mapping has not changed, then persists a separate **nonsecret synced approval per habit definition** (`alf-habit-auto-allow-v1-` + Notion habit definition ID). Only then does it switch on the local-only device flag.

**Enforced in the background engine:** Every cycle now requires an exact approval record whose original habit definition ID, SP counter ID, Notion task/habit data-source IDs and pinned mapping fingerprint still match current configuration. The engine also re-reads this approval **immediately before the existing Number PATCH**, so a mapping change or revoked/altered approval while the network is active prevents a new write. These approvals permit later *existing* daily occurrence rows of **only those same approved habit definitions**; they do not grant permission to any other linked habit, even in the same Notion board. No daily record creation. A previously enabled v0.16 device without a per-habit approval now does no unattended habit-day writes until the user re-previews and explicitly authorizes individual habits (migration safety).

Use the device-local **Disable automatic habit-day counts** action to stop future writes. Existing synced approvals stay as nonsecret metadata; a subsequent re-enable still requires current-day preview and explicit consent. Notion and Super Productivity production data were not used for CI. Multi-device concurrency and atomic Notion write safety remain unresolved.

### New v0.18: restart/unload lifecycle and unknown Notion-write outcome regression tests

The automated test suite now exercises the **actual SP plugin lifecycle** in a simulated host: one `onReady` handler starts the three optional engines, each installs a controlled runtime timer, and `onUnload` clears the timers. When all three per-device enable flags are absent (the default), no Notion network calls, SP mutations, SuperSync writes or status changes occur, even when their timer callbacks run. The diagnostics privacy contract is tested independently.

Additional failure tests intentionally simulate Notion successfully writing an existing Number while the network response is lost. Automatic actual-time export keeps its old confirmed baseline, then detects the changed Notion Number and refuses a duplicate PATCH on retry. For an existing habit-day Number, a matching current SP/Notion positive value may be *adopted without another PATCH* on a later run; if the SP count has since grown, the unanchored positive Notion value conflicts and is not overwritten. Subsequent writes occur only after a safe confirmed matching baseline. These tests do **not** demonstrate atomic GET/PATCH or cross-device locking: both remain unavailable in the public Notion API.

The host's public `v20.0.0` plugin API types and the installed Windows Super Productivity version were inspected, but SP was **not running** on the connected machine, and we did not install the experimental plugin into the user's live profile, create any Notion sandbox pages or perform a real Android run. This release remains experimental until those end-to-end tests and the official complete focus-session ledger are available. All three automatic modes are disabled by default.

### New v0.17: per-device synchronization health and immediate-disable safety

A new **Automatic synchronization diagnostics (THIS DEVICE)** section displays the last local check time, whether each of the three automatic paths is currently enabled, and numeric outcome counters (processed/updated/written/anchored/skipped/unchanged/conflicts/errors). Click **Read last local automatic sync checks** to refresh; it makes **no Notion request** and performs **no SP task modification**. The plugin records only aggregated counts, outcome and timestamp in the **per-device local secret store**, never Notion tokens, task titles or page IDs. No diagnostic data is sent to SuperSync, and successful counts **do not imply cross-device sync acknowledgement**. If an engine is off, the last recorded check (if any) is historical; disabled devices make no automatic Notion requests.

Disabling the automatic Notion→SP planning path during an in-progress Notion GET now rechecks the flag immediately before applying the SP update, preventing not-yet-started local writes. Other exported Number paths already recheck the flag before PATCH. Operations that already started remain subject to the platform's normal network/API cancellation limitations.

**Compatibility verification:** The connected Windows PC has Super Productivity **20.0.0** installed but it was not running at inspection; the upstream `v20.0.0` plugin API source includes `getDayContext`, `getAppState`, `listSyncedDataKeys`, `getSecret`, `onReady`, and task update APIs used here. This is *source-level API compatibility*, not a successful real-world plugin install or Windows/Android session/notification test. The underlying app still does not expose the authoritative historical per-task Pomodoro/Flowtime/Countdown ledger through its public plugin API.

### New v0.16: independently authorized automatic existing habit-day count/duration updates

This is the third narrow automatic integration path. It is **OFF by default**, independent of the v0.14 planning and v0.15 tracked-time flags, and runs only while the Super Productivity plugin runtime is alive. It works exclusively with the **existing Notion habit definitions and existing daily occurrence pages** in the user-selected board/task data source. No new Notion page, database, property, habit definition, or SP SimpleCounter is created, and it never writes to missing daily rows or past days.

**Enablement and policy:** Link each existing Notion habit definition to a specific existing SP SimpleCounter in the UI. Pin stable Notion occurrence IDs for item type, relation to definition, logical execution day and numeric value. Choose the exact existing habit type and explicit counter unit: `count` (ClickCounter), `minutes` or `hours` (StopWatch converted from milliseconds). Preview today's existing habit-day occurrences in section 8, then separately authorize **Enable automatic existing habit-day counts** on **one device only**. The opt-in flag stays local and is **not synced by SuperSync**. Users acknowledge that, once enabled, **blank or zero numeric values in existing matching daily rows may automatically be filled from positive SP counter values**, while already matching positive values can be anchored without any Notion write. An unanchored positive Notion number that disagrees with SP is never overwritten: use the reviewed manual process first, or reconcile it in Notion/SP and retry. The previous manual daily writeback remains available.

**Automatic safety:** For each SP logical day, the plugin queries the configured existing board by pinned Notion property IDs and groups occurrences by exact habit definition ID. The presence of multiple rows for the same habit/day, ambiguous definition-to-counter links, a disabled/mismatched SP counter, a date range/timestamp instead of an exact day, or missing source/type/relation/count all prevent the write. Up to 3 existing habits are checked per ~10-minute cycle. Before each Number PATCH, the plugin re-queries the **whole existing day inventory** to detect newly duplicated/removed pages, fetches the target page, verifies its source, day, type, relation and previous value, rechecks the SP counter's raw value, mapping, local opt-in and per-page synced baseline. It patches **one existing Number property by immutable ID** only when the positive compatible value increased, and persists an idempotent per-occurrence/day anchor only after confirmed success. It will not overwrite later Notion edits or accept a decrease/reset of the counter.

**Important limitations:** The first write from a blank/zero existing Number is explicitly authorized by this setting; if zero is intentionally used as a manual override, leave automatic habit mode disabled. Notion's API still has a GET/PATCH race and no per-page atomic compare-and-swap. SuperSync metadata propagation and Android background execution are not guaranteed. Running the three automatic modes on multiple devices at once is not safe; test against a disposable Notion and SP dataset **on one device only**. Missing Notion rows remain missing; no daily creation is ever attempted. The authoritative historical per-task completed Pomodoro ledger is still unavailable. Automated CI tests are mocked; physical device/Notion integration still requires verification.

### New v0.15: separate opt-in automatic SP → existing Notion Actual Time (strict monotonic export)

Actual tracked SP work time can now be written automatically to the *same existing Notion board/task pages*, with **an independent disabled-by-default, per-device permission**. This is a deliberately narrow experimental bridge, **not** an authoritative cross-device transaction engine, habit/focus synchronization, or permission to create Notion databases, pages, relations or properties. The existing reviewed manual time export remains unchanged and available.

**Enablement:** Link/import tasks as before and pin the **existing** Notion task type and Actual Time Number property IDs. First use the reviewed manual writeback until the Notion value exactly matches the individual SP task's positive, tracked work time (in the explicitly mapped hours/minutes). Select these tasks in a fresh Notion task preview and authorize **Prepare selected matching tracked-time baselines**. This stores *only nonsecret Alf sync metadata* per task: its Notion ID, SP task ID, fixed source/property IDs, unit, allowed types, project/parent and exact matching SP milliseconds + Notion Number. It changes neither Notion nor SP. Separately authorize **Enable automatic time export (THIS DEVICE)**. The flag stays in the per-device local secret store and is independent of the optional automatic planning pull. Keep this enabled on **one device only**.

**Automatic check:** When enabled and while SP remains running, the plugin checks up to 5 anchored linked tasks roughly every 10 minutes. It accepts only increasing positive and safe-integer SP tracked work time on tasks with a unique exact Notion marker, unchanged synced link, matching project/parent, no subtask rollup, same pinned Number and task-type fields, original Notion data source, allowed item type and Notion Number equal to its last approved baseline. It rechecks SP time, linkage and a second Notion page GET before a one-property `PATCH` keyed by **stable Notion Number property ID**. After successful Notion confirmation, it updates the synced baseline. Unchanged time causes no network Number PATCH or metadata churn; a higher/edited Notion number, SP time reset, moved page, stale mapping, missing link or failed write fails closed. The disabled device does not read Notion or alter tasks. No Pomodoro counts are inferred from tracked hours, and this path never modifies SP tasks.

**Unresolved risks:** Notion has no supported atomic compare-and-swap for the final GET/PATCH, and SuperSync plugin metadata may not yet have reached all devices. Two enabled devices can conflict, so test with **one device only** and disposable Notion pages. If a PATCH succeeds but the response is lost, the next run detects a Notion value inconsistent with its baseline and **halts that task until manually reconciled/reseeded**. Android background throttling and Notion rate limits can delay checks. Real Windows/Android and Notion sandbox integration tests remain mandatory before production use. Automatic habit and authoritative completed-Pomodoro updates are not enabled by this feature.

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
