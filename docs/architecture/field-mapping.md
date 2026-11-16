# Existing Notion property → Super Productivity field mapping

**Status:** implementation contract for the mapping engine. This document does not claim any mapping is already live. All property labels below are configurable examples.

## Primary task field matrix

| Meaning | Notion example (existing unless noted) | SP field | Direction | Serialization / important rule |
|---|---|---|---|---|
| Task title | `المصدر` (Title) | `title` | Two-way, conflict-aware | Preserve user text and Unicode; skip SP short-syntax parsing for imported titles |
| Item type | `نوع الصفحة` (Multi-select) | adapter filter | Notion → SP | `مهمة` normal task; `حزمة` parent task; `عادة` habit occurrence; exclude other types |
| Small project | `العنصر الفرعي` (Relation) | `projectId` | Notion → SP | Verify project ancestor and preserve Notion relations |
| Bundle parent | `الحزمة الأب` (Relation) | `parentId` | Notion → SP | One subtask level; never assume a bundle is a folder |
| Completion | `Status` (Status) | `isDone` (+ completion metadata) | Two-way | Map configured status option labels; avoid forced changes based only on `timeSpent > 0` |
| **Execution day/time** | `يوم التنفيذ` (Date) | `dueDay` / `dueWithTime` | Notion plan → SP | All-day → `YYYY-MM-DD`; timed → epoch ms, timezone-aware; only one SP due representation at a time |
| **Deadline** | `Deadline` (Date, **optional new property**) | `deadlineDay` / `deadlineWithTime` | Notion plan → SP | **Independent from execution day**. A deadline never overwrites scheduled execution date |
| Planned work | `الوقت المخطط له` (Number) | `timeEstimate` | Notion plan → SP | SP stores milliseconds; user must choose Notion units (hours/minutes) |
| Tracked work | `الوقت الفعلي` (Number) | `timeSpent` / `timeSpentOnDay` | SP actual → Notion | Preserve exact unit conversion, daily distribution and rollup semantics |
| Priority | `Priority` (Select, optional new) | `priority` | Configurable | Low/Medium/High values must be mapped; never create select options automatically |
| Tags | `Tags ` (Relation) or configured field | `tagIds` | Configurable | Map option IDs or relation IDs; never treat Notion relation as simple multi-select blindly |
| Notes | `Notes` (Text, optional) or page body | `notes` | Configurable | Protect existing page content; do not overwrite rich blocks with plain text |
| Target Pomodoros | `Pomodoro Target` (Number, optional) | target from time estimate and session config | Notion → SP (report) | e.g. `ceil(plannedWorkMinutes / pomodoroWorkMinutes)`; do not confuse target with completed |
| Completed Pomodoros | `Completed Pomodoros` (Number, optional) | completed focus session count | SP → Notion | Count only completed, unique, Pomodoro-mode sessions |
| Focus duration | `Focus Time` (Number, optional) | sum of verified work sessions | SP → Notion | Distinct from total task time and excludes breaks |
| Focus mode | `Focus Mode` (Select, optional) | mode of sessions | SP → Notion | Summary only; sessions may contain more than one mode |

### Distinguish execution day, scheduled time, and deadline

- A Notion **date-only** `يوم التنفيذ` maps to SP `dueDay = "2026-11-20"` and `dueWithTime = null`.
- A Notion **date + time** maps to `dueWithTime` (timestamp in ms) and `dueDay = null`.
- A date-only deadline maps to `deadlineDay`, and a timed deadline to `deadlineWithTime`. Deadline is never a synonym of `dueDay`.
- Notion date **range** is not necessarily a deadline: don't silently interpret `end` as deadline. Require explicit mapping.
- Avoid UTC date drift: preserve all-day dates as strings rather than converting through midnight UTC, which can change the calendar day.

### Estimates and actual time

```js
const HOURS_TO_MS = 60 * 60 * 1000;
const MINUTES_TO_MS = 60 * 1000;

// Only after the user has selected a Notion numeric unit:
const estimateMs = notionEstimate * (unit === 'hours' ? HOURS_TO_MS : MINUTES_TO_MS);
const notionActual = spTimeSpentMs / (unit === 'hours' ? HOURS_TO_MS : MINUTES_TO_MS);
```

Do not round to two decimal hours if that would discard meaningful tracked time. Choose a precision policy, include it in configuration, and test stable read/write round trips. Preserve zero and null separately.

**Double counting:** SP parent time may already include children. A Notion rollup on a parent must not add SP parent aggregate on top of child totals.

### Habit model

- `قاعدة العادات` = definition (title, cadence, goal/streak, build/break, routine window).
- `اللوح` row with `نوع الصفحة=عادة` and relation `قاعدة العادات` = daily occurrence.
- SP `SimpleCounter.countOnDay[localDate]` = count, checkmark, or duration in milliseconds for StopWatch.
- Uniqueness: (`notionHabitPageId`, `logicalDay`) **not** a title string. Do not duplicate a Notion occurrence when the same day is updated from another device.
- For habits with flexible goals/cycles, keep the Notion definition authoritative. Repeating tasks are a separate optional presentation, not an automatic substitute for Habit Tracker.

## Per-field authority

| Property group | Default authority | Reconciliation |
|---|---|---|
| Project and task hierarchy, target day, deadline, expected time, habit definition | Notion | SP updates require user approval if overwriting Notion plan |
| Tracked work durations, verified focus sessions, daily habit counts | Super Productivity | SP observed facts go to Notion; Notion manual corrections must be recognized and not lost |
| Title, description, completion, tags | Configurable two-way | Last-sync hash + conflict review, not blind last-write-wins |
| Delete, archive, folder membership changes | Neither automatically | Explicit user approval required |

## Property detection and migration

1. Read Notion existing data source/schema and SP metadata.
2. Display potential property matches with type checks.
3. Explicitly request unit/timezone/status mapping where ambiguous.
4. Preview mapping, missing optional properties, and all proposed creations/updates.
5. Do not create a Notion database. Optional extra fields only after direct user opt-in.
6. Store mapping ID ↔ ID and checkpoint in plugin-managed metadata. Keep API secrets out of synced metadata.

## Required tests

- Arabic task titles, empty optional fields, date-only vs timestamp, day rollover, daylight saving, late tasks.
- `dueDay` and `deadlineDay` preserved independently; mutually exclusive timed/date variants.
- Parent/subtask summed once only; no permanent double counting after resync.
- Change Notion plan while SP offline; reconcile without losing tracked work.
- Missing `Deadline` does not block other fields or create a property silently.
- Pomodoro target and actual count remain distinct, and actual counts require completed focus events.

### Stable Notion property identities (v0.8 implementation)

Existing task property names are **not** stable IDs: users may rename `الوقت المخطط له` to `Planned Time` without changing the underlying property. The explicit **Pin task property IDs** action reads the Notion data-source schema and persists `taskPropertyBindings` beside the original `alf-mapping-v2` configuration. Each binding contains `{sourceId, input, id}` and is valid only for its original data source and configured input. Preview/import and opt-in Actual Time PATCH resolve page properties and updates by ID. Missing IDs or incompatible types fail closed; a same-name replacement is never silently adopted. Changing the input label invalidates the old binding until a new explicit pin.

No Notion property is created or renamed by this action. Habit definition/occurrence property pinning, true sync, and accurate historical Pomodoro session data remain future work.

### v0.9 read-only work-session planning and observation

The task preview now computes `ceil(timeEstimateMs / (configuredPomodoroMinutes * 60000))`, using only the **existing** Notion planned time Number field and explicit unit conversion (Hours/Minutes). The work interval is configurable per user, default 25 minutes. It is an estimate/target, not a completed Pomodoro record or host timer setting. No Notion schema changes are made.

The optional focus comparison reads uniquely keyed, **observed only** SP session metadata and joins it to Notion pages only through an unambiguous SP task identity marker. It separately displays verified automatic Pomodoro, Flowtime and Countdown observation counts, marks them incomplete, and never PATCHes Notion. A proper official structured per-task/per-mode SP focus-session history API remains a prerequisite for reliable completed-session counts in Notion.
