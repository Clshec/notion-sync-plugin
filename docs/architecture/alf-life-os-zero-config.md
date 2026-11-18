# Alf Life OS → Super Productivity: zero-configuration connection (v0.34 experimental)

## v0.34 — explicit import of missing SP daily counters (not yet live accepted)

Source of truth remains the **original dated اللوح record**. The daily preview compares its unique existing definition Relation and title against the current Super Productivity counter inventory. After the user reviews that exact day's rows, a separate checkbox and button may request local SP **ClickCounter** creation for records with no matching existing counter. No Notion page, database, property or Status is created or updated by this import. It is OFF on onboarding; only the approved foreground action can invoke it.

The trusted same-plugin host RPC handles each counter creation, rather than exposing a general-purpose SP state mutation API to the iframe. The host re-reads the exact original Notion page by its stable ID, verifies pinned board Title / Type / Date / Relation property IDs, checks the same SP logical day and complete daily inventory, refuses duplicates/moved rows or ambiguous titles, then checks current SP counters for collisions. Counter ID is deterministically `alfn-` plus the normalized **original Notion definition UUID**; this is stable across future daily rows. Import starts at zero using the official SP 20 `setCounter` (which upserts if absent), then names the new counter via `updateSimpleCounter`. It must **never** call `setCounter` for an existing counter, as that would erase its present-day count; there is a recheck and an in-flight ID lock. An interrupted first rename is repairable without resetting counts.

Daily read-only previews prefer a known counter with that stable imported ID even if its user-facing name subsequently changed. Existing uniquely matching ordinary SP counters remain usable without migration or overwrite. This is **not** automatic daily schedule generation, a verified completed-Pomodoro ledger, mobile SuperSync acceptance, or automated Notion Status writeback. The original Alf automatic habit Number writer remains blocked; explicit, reviewed Status writeback stays separate. Synthetic Node coverage does not establish real Windows SP/plugin-host acceptance. All production data changes are deferred pending user validation and Woodpecker CI.

## v0.33: Daily board records, NOT definitions, drive habit execution

The original **اللوح** is the single source of today's habits. Read its existing pages with `نوع الصفحة` containing `عادة` AND exact date-only `يوم التنفيذ` equal to Super Productivity's logical day. Each existing board page represents **one dated execution record**; its page ID + day + `قاعدة العادات` relation are the identity. The `قاعدة العادات` source itself holds definitions/cadence only and does not determine which habits enter SP today. No extra Notion sources, properties or rows may be created.

The new quick-start habit preview queries only dated board occurrences, displays original title, day, Status, single definition Relation and a matching **existing** SP counter if unique. No Notion read of the definitions source is required for the daily execution list. A duplicate definition/day, missing/multiple relation or ambiguous title/counter match is refused rather than guessed.

Notion permits mixed `نوع الصفحة` options on one page; live board inspection found both `عادة`+`مهمة` and `عادة`+`تدوين`. Alf treats those as **habit-day** records; the ordinary SP task preview/import and planning/time writers must exclude any Alf page marked `عادة`, even when also marked `مهمة`.

For reviewed `Status` writeback, Alf now resolves the counter from the **daily board record title**, with unique original definition Relation and matching SP logical day. Before a PATCH it revalidates that day's original page ID, relation, current Status, counter and observed count. **A positive counter is not proof of goal completion**: user review is mandatory. The legacy definition→counter mapping remains only for non-Alf advanced scenarios. Alf's legacy definition-driven automatic Number writer is explicitly blocked, including host runtime, until a page/day-ID safe design has passed acceptance. No data writes or counter creations occur in onboarding or previews.

Missing SP Habit Tracker counters are **not created** by this revision. Official SP 20 exposes get/update methods and low-level counters, but a safe end-user import/creation design with scoped approval and Android tests is a separate release gate. The documented update is a real daily-source correction and reviewed link, **not** full daily SP counter creation or cross-device habit synchronization.

## Woodpecker CI — self-hosted only

The repository uses [`.woodpecker.yaml`](../../.woodpecker.yaml) for Node 22 syntax and regression tests on the user's own Woodpecker service. The former GitHub Actions `mapping-tests.yml` was removed. No live Notion token is passed into CI and no CI test touches personal data. The GitHub repository must be activated in the live Woodpecker instance and a real pipeline must finish successfully before claiming self-hosted acceptance; local checks alone do not suffice.

**Platform security contract (confirmed against Clshec/gumacu GitOps on 2026-11-18):** `ci.gumacu.com` HTTP 404 and the absence of public Woodpecker HTTPRoute/Ingress are **intentional**, NOT a CI outage. The Woodpecker UI is internal-only; the only external integration is a signed GitHub webhook `POST https://api.gumacu.com/api/hook` behind APISIX. Do NOT expose the UI, create public ingress or use an unsigned webhook as a workaround. Woodpecker server and Agent pods were Running on Netcup, but the Alf repository activation and a completed Woodpecker job have not been independently verified; private operator authentication/approved repo activation remain required.

**Status (2026-11-17): implemented, live Windows Notion read-only connection accepted for v0.30, v0.31 task preview filtering/pagination added; Android and real writeback remain separate gates.** This document supersedes the upstream English-schema configuration instructions for the Alf profile. The plugin remains an MIT fork of Alessio Lovato's original.

## Product contract — exactly one user input

1. User imports and enables the Alf Super Productivity plugin.
2. User pastes their own **Notion Access Token** and clicks **اتصال واكتشاف النظام تلقائيًا**. A previously saved device-local token can be reused without retyping.
3. The host queries **Notion Search API 2026-03-11**, verifies four existing Alf data sources, types and relationships, pins the verified property IDs, and saves ONLY mapping metadata through Super Productivity's synced plugin data. It shows a human-readable connection result; the original technical mapper is behind collapsed **Advanced**.
4. Read-only task/habit previews are available. It neither creates a Notion data source/page/property nor creates SP tasks, nor changes Notion Status/work hours. All three optional automatic paths remain **OFF** and keep their own separate manual authorization.

**One token is the only Alf-app input, not an override of Notion authorization.** Notion search returns only objects the integration has actually been given access to; a 404 or missing search result means the app must guide the user to grant access to the original database via Notion Connections. It is impossible to query an unshared data source with the token alone. Missing or ambiguous sources never trigger a guessed ID, new database or unsafe import.

## Verified original Notion shape (read-only Notion connector inspection)

Two independent systems — **projects** and **folders/knowledge** — share the same core source hierarchy. Course/Quran learning pages are knowledge records, not a separate project database.

| Existing source | Role | Schema/evidence |
|---|---|---|
| `اللوح` | Tasks, work bundles, habit daily occurrences, knowledge and learning records | `المصدر` Title; `نوع الصفحة` Multi-select; `يوم التنفيذ` Date; `الوقت المخطط له` Number; `الوقت الفعلي` Number; `Status` Status; `الحزمة الأب` self Relation; `العنصر الفرعي` Relation to lower levels; `قاعدة العادات` Relation to habit definitions |
| `قاعدة العادات` | Habit definitions, not work tasks | `العادة` Title; `التكرار` Select; `اللوح` inverse Relation; `متتبع العادات` another existing Relation (not required for SP setup) |
| `المستويات العليا` | Top-level projects and top-level folders | `Name` Title; `النظام` Select; `العناصر الفرعية` Relation to lower levels |
| `المستويات الفرعية` | Small projects, nested folders, curricula and course units | `Name` Title; `النوع  ` Multi-select (trailing spaces are significant); `العنصر الأب` Relation to upper levels |

**Never hardcode actual tenant source IDs.** These four names and typed properties define the Alf-specific *schema signature*; search returns the actual accessible source IDs. If the user's board/database names change, fail visibly until the Alf profile is deliberately revised (the advanced developer mapper is a separate legacy path). `/v1/search` returns data sources rather than databases in Notion API 2026-03-11.

### Mapping generated automatically (existing `alf-mapping-v2` format)

| SP/Alf configuration key | Existing property or value |
|---|---|
| `taskSource` | Search-resolved `اللوح` data source |
| `projectSource` | Search-resolved `المستويات الفرعية` data source |
| `habitSource` | Search-resolved `قاعدة العادات` data source |
| `titleProp`, `typeProp` | `المصدر`, `نوع الصفحة` |
| `typeValues`, `bundleValues` | `مهمة, حزمة`; `حزمة` |
| `executionProp`, `estimateProp`, `actualProp` | `يوم التنفيذ`, `الوقت المخطط له`, `الوقت الفعلي` |
| `statusProp`, `completedValues` | `Status`, `Done` |
| `projectProp`, `parentProp` | `العنصر الفرعي`, `الحزمة الأب` |
| `habitTitleProp`, `habitCadenceProp` | `العادة`, `التكرار` |
| `habitOccTypeProp`, `habitOccTypeValue` | `نوع الصفحة`, `عادة` |
| `habitOccRelationProp`, `habitOccDayProp` | `قاعدة العادات`, `يوم التنفيذ` |
| `habitDoneStatusValue`, `habitOpenStatusValues` | `Done`; `Not started, In progress` |
| `unit`, `pomodoroWorkMinutes` | `hours`; `25` is a planning display default, **not evidence of a completed Pomodoro** |

The browser-facing UI never asks for UUIDs or property IDs. Stable property IDs are pinned automatically for **all 13 mapped fields** (task fields and habit definition/occurrence fields) and copied into `taskPropertyBindings` and `habitPropertyBindings` in synced mapping metadata. These bindings are scoped to their original source IDs. The upper source is retained only as `alfProfile.upperSource`; there is **no claim** that full project/folder synchronization has been implemented.

**No guessed fields:** there is no separately verified Deadline, Priority, habit-day count Number or completed-focus-session-history Number in the current board. They are mapped to empty fields, not to existing work hours. We never use `الوقت الفعلي` as habit clicks or completed Pomodoros. All learning, notes, pages, folder/course records remain in Notion; SP task preview filters strictly to `مهمة` and `حزمة`. The habit day uses `عادة` and the existing definition Relation.

## Discovery and refusal state machine

```
Idle (no token)
  └─ User submits Notion token
     └─ Revoke any old device-local writer flags BEFORE switching credentials
        └─ Store token via HOST-side PluginAPI.setSecret (never SuperSync)
           └─ Host-side /v1/search with object=data_source, paginated
              ├─ Missing source → show original database name + Connections guidance; no mapping committed
              ├─ Duplicate exact name → refuse ambiguity; no mapping committed
              ├─ Truncated/malformed search → refuse; no mapping committed
              └─ One match each → GET the four source schemas
                 ├─ Wrong field types/options/relation target → refuse; no mapping committed
                 └─ All validated → auto-pin IDs → persist mapping metadata
                    └─ Ready for read-only previews; writers remain OFF
```

The host bridge is restricted to the iframe that belongs to this exact plugin, allowed local keys and allowed Notion methods. `discover` is a host-owned operation that reads the local token and performs the Search+GET sequence within the official `PluginAPI.request` boundary. The token is neither returned to the iframe nor persisted in plugin sync data. The UI sees only verified schema mapping and friendly connection status. Only the existing reviewed, separately consented writer functions can PATCH previously existing pages.

Search is bounded to 5 pages × 100 sources; every `has_more` page must have a new cursor. Truncation or a repeated cursor aborts. Notion permission, 401, 403, 404, incorrect schema and duplicate titles all cause a visible refusal. A new token invalidates prior per-device writer opt-ins before replacement. No automatic page, task, property, project, habit or counter creation is permitted during onboarding.

## Test gates and remaining engineering

1. **L1 synthetic schema contract:** missing source, pagination, duplicate names, field mismatch, option mismatch, relation target mismatch, token absent, restricted search shape, no leaked credential, non-destructive single-token UI.
2. **L3 Windows host:** **passed for v0.30** by actually installing and enabling in SP 20, fully restarting the host to reload `plugin.js`, clicking one-token Connect and reusing the locally saved token. Reinstalling a ZIP alone is insufficient when previous host code remains loaded.
3. **L4 Notion live read-only:** **passed for v0.30 connection and v0.31 filtered preview + pagination** after the real integration's `Content access` changed from `No page access` to four shared original database pages. Four sources, 13 original fields validated automatically; old unfiltered preview showed 65 eligible among 300 mixed pages, and the habit preview read 41 definition rows and 4 SP counters. In **v0.31**, the real Windows plugin fetched 75/75 eligible task/bundle rows from Notion and successfully requested the next 75/75 through the cursor, with previous approvals and selections cleared. No Notion/SP writes. Recheck the four sources after token rotation/permission changes.
4. **L4 writeback**: a separate explicit review and confirmation is required before mutating *one* existing, non-critical record. Protect Notion data; production auto modes stay OFF pending accepted real tests.
5. **L5 Android/SuperSync:** prove exact task mapping, completed Pomodoro ledger (API gap), habit and tracked time without duplication or cross-device stale writes. No cross-device production claim until tested.

References: [Notion Search API](https://developers.notion.com/reference/post-search), [Retrieve Data Source](https://developers.notion.com/reference/retrieve-a-data-source), [Alf architecture base](alf-sync.md), [test plan](../../TEST_PLAN.md).

## v0.31 refinement: query only task/bundle records + cursor navigation

The v0.30 task preview fetched the **first 300 unfiltered pages**, a problem on an existing mixed-purpose board with thousands of records. Even with correct local `نوع الصفحة` filtering, useful task pages later in the source could be missed. v0.31 moves the existing verified allowlist into the **Notion server-side query** using the original pinned `نوع الصفحة` property ID. For `multi_select`, the OR filter uses `contains: مهمة` or `contains: حزمة`; a normal `select` uses `equals`. Only up to 75 relevant records are fetched per page, with `next_cursor` exposed as a read-only Next action. All results are independently type-checked on receipt.

Next navigation replaces the displayed 75 records instead of accumulating stale selections and **revokes all previous review checkboxes for task import, planning and actual-time export**. This protects separate reviewed mutations from incorrectly reusing a prior batch's approval. A changed mapping, missing/repeated cursor or duplicated Notion page ID is refused. Each batch requests the live source schema again. This is a **read-only user experience improvement**, not proof of complete sync or permission for production writes.

### Actual v0.31 Windows acceptance (2026-11-17)

Upgraded the already connected standard Windows SP 20 plugin from v0.30 to **v0.31** via the real Plugins ZIP installation dialog (installed version verified). The live Notion task query showed **75 matching tasks out of 75 returned**, a **Next 75** button, and after clicking that button another 75/75 eligible tasks with a further cursor. The UI confirmed previous review selections and approvals were discarded on next-page navigation. The original v0.30 discovery and token/mapping data remained in place. The behavior was verified directly in Super Productivity's UI; no HTTP write, task import or editing action was invoked. This raises the read-only preview from synthetic-only to **real L4 passed**. It does *not* validate source-wide total counts, full multi-device sync, Android, background operation, or any Notion PATCH.
