# Alf Life OS → Super Productivity: zero-configuration connection (v0.33)

## v0.33 execution-level correction (supersedes older habit flow diagrams)

The correct Notion → SP habit execution path is:

```text
Notion: قاعدة العادات (reference definition only)
          │ relation from each daily page
          ▼
Notion: اللوح
  [نوع الصفحة = عادة] + [يوم التنفيذ = SP logical day]
  + [قاعدة العادات = exactly one definition]
          │ existing daily-page ID is the execution identity
          ▼
Super Productivity: existing Habit Tracker / SimpleCounters
  preview today's eligible occurrences; only review unique suggestions
          │ separate explicit write approval, if later implemented/verified
          ▼
Notion: update only the SAME original اللوح day-page
```

**Never** query the definitions database to decide which habits need to be
executed today. A definition with no matching daily page in `اللوح` produces
**no** SP daily habit. A page from yesterday cannot satisfy today. Two
occurrences with the same definition/day are ambiguous and excluded, not
merged. The execution identity is the source-page ID + referenced definition
ID + logical date; counter suggestions by exact unique board title are
non-authoritative and read-only.

Current code implements an **ordinary-user read-only daily habit preview**
using the validated board fields and pre-existing SP SimpleCounters. It does
not assert SP Plugin API support for creating Habit Tracker counters, and
does not activate automatic status writes. The advanced definitions preview
remains a separate reference/diagnostic tool.

**CI owner:** `.woodpecker.yml` on the Gumacu private Kubernetes Woodpecker
cluster (self-hosted agents); the old GitHub Actions workflow is removed.
No CI acceptance without an actual Woodpecker run. A repo must be activated
in Woodpecker before PR/push hooks can run.

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
