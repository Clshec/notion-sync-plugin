# Habit definitions ↔ existing SP Habit Tracker counters (v0.6)

## Direction and scope

- **Notion remains the master for definitions** (names, frequency, target, build/break, status, relations) in whichever existing data source the user maps.
- **Super Productivity is the executor**, already providing a Habit Tracker using SimpleCounters, `countOnDay` and StopWatch-based counters.
- **Notion `اللوح` or any existing task source will later hold daily occurrences** linked to the original habit definition. The current v0.6 PR only **reads habit definitions and existing SP counters, and saves explicit ID links**; it **does not create a new Notion database, change a habit, modify a counter or write a daily occurrence**.

## Workflow

1. Enter Notion's **existing habit definition data source ID**, not the parent database ID. Share the data source with a properly scoped Notion integration.
2. Enter an existing **Title property**, e.g. `العادة`, and optionally a Select/Multi-select cadence property, e.g. `التكرار`. These labels are examples only.
3. Press **Preview definitions and SP counters**. Notion data sources are queried read-only with cursor pagination; local SP counters are read from the official `PluginAPI.getAppState().simpleCounters` snapshot.
4. For each Notion habit definition, choose an existing SP SimpleCounter by ID (no name-only automatic matching). Press **Save habit ID mappings only**.
5. Mapping stored under `alf-habit-definition-link-v1-${notionPageId}` with the selected `spCounterId` and source ID, using keyed synced plugin data; this is not a Notion write.
6. Counters may be visible across desktop/mobile through SuperSync, but **plugins and device-local tokens must be installed/configured separately**. Mappings are device-neutral, but mapping creation does not prove remote delivery.

## Invariants

- Never silently create missing habit counters using unsafe SP internal actions. The public plugin API currently reads and updates counters but does not reliably expose all needed create semantics.
- One counter can be linked to only one Notion habit within the current preview batch. Cross-page uniqueness across independently saved mapping keys must be checked before allowing automatic syncing.
- A future daily occurrence must use an idempotent key `(notionHabitId, logicalDay)`, not a title, and must preserve the original `قاعدة العادات` relation on each `اللوح` row.
- Current UI daily values use device local date for display only; future writeback must use SP's configured **logical day** and validate Notion Timezone/DST.
- StopWatch duration must retain time units. For `ClickCounter`, a count is not a work-session time estimate.
- No auto-updates, Notion writes, or deletions in this phase.

## Subsequent development

1. Map cadence, numeric goals, build/break, enabled status, and time-of-day if exposed through official APIs.
2. Add daily occurrence preview in the existing Notion `اللوح` source, with strict item type `عادة`, definition relation and execution day.
3. Implement per-day reconciliation, noting corrections, skips and idempotent upserts across devices; requires explicit user approval and conflict policy.
4. Test Windows, Android, SuperSync and existing habit history on disposable data.

[Overall architecture](alf-sync.md) | [Field mapping](field-mapping.md)
