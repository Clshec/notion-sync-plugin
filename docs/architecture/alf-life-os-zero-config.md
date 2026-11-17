# Alf Life OS → Super Productivity: zero-configuration connection (v0.30)

**Status (2026-11-17): implemented and covered by synthetic contract tests; live Notion read-only acceptance, Android and real writeback are separate gates.** This document supersedes the upstream English-schema configuration instructions for the Alf profile. The plugin remains an MIT fork of Alessio Lovato's original.

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
2. **L3 Windows host:** actually install/enable v0.30 and click one-token Connect. Confirm saved credential is reused on this device without exposing it. This does NOT prove external integration access.
3. **L4 Notion live read-only:** verify 4 sources returned by `/v1/search` from the user's token after Notion Connections permissions, then query sample task/habit records and check existing values. Any 404/missing source requires permission repair. **Do not claim L4 completed from synthetic tests.**
4. **L4 writeback**: a separate explicit review and confirmation is required before mutating *one* existing, non-critical record. Protect Notion data; production auto modes stay OFF pending accepted real tests.
5. **L5 Android/SuperSync:** prove exact task mapping, completed Pomodoro ledger (API gap), habit and tracked time without duplication or cross-device stale writes. No cross-device production claim until tested.

References: [Notion Search API](https://developers.notion.com/reference/post-search), [Retrieve Data Source](https://developers.notion.com/reference/retrieve-a-data-source), [Alf architecture base](alf-sync.md), [test plan](../../TEST_PLAN.md).
