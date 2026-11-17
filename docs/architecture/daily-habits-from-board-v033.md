# Alf v0.33 — Daily habits originate from اللوح

## Source of truth

**The daily execution record is always an existing row in `اللوح`.**
Daily candidates must have `نوع الصفحة = عادة`, the exact
`يوم التنفيذ` of Super Productivity's logical day, and one
`قاعدة العادات` relation pointing to the original habit definition.

**`قاعدة العادات` contains definitions, not today's execution list.**
A definition without a row in today's board must NOT become an SP habit.
Learning, notes and tasks in the mixed board must not be treated as habits.

The user's one-token quick UI now invokes `previewTodayBoardHabits`, which
reuses the verified pinned-board query `queryExistingHabitDay` and obtains
the date from `PluginAPI.getDayContext().todayStr`. The query is filtered
server-side by existing `نوع الصفحة` and `يوم التنفيذ` property IDs;
returned rows are independently checked for date, type, missing relation
and duplicate `definitionId:day` identity. A valid daily row displays
its own `المصدر`, status and date plus a strictly unique-name suggestion
for an existing SP counter or an established relation-linked counter.
Definitions are *metadata/reference* only, never source rows.

The quick preview is intentionally **read-only**. It creates no Notion
row, schema, database or SP counter/task; it never changes `Status`,
`الوقت الفعلي` or habit counts. Suggested counter mappings are not
persisted merely by preview. The older advanced definition-link feature
is kept behind the collapsed developer panel for compatibility.

## Identity and next-stage importer

The canonical identity of a daily execution is
`(notionOccurrencePageId, notionDefinitionId, logicalDay)`.
The definition relation supports context/deduplication; only an existing
occurrence page authorizes the day's execution. No `definitionId:day`
can be processed twice. Real SP Habit Tracker creation, per-day
reconciliation and safe completion writeback are *not* claimed by this
read-only preview and require verified official API support and separate
real-device acceptance.

## Self-hosted CI contract

All repository CI is configured at `/.woodpecker.yml` for the Gumacu
Woodpecker Kubernetes runner (Node 22, syntax checks, all Node tests).
The GitHub Actions workflow was removed. Pull request, push and manual
events run in the self-hosted pipeline once repository activation completes.

Live infrastructure checks on 2026-11-17 found the Woodpecker server,
agent and PostgreSQL running; the internal `/api/version` endpoint
responded HTTP 200. The Woodpecker repository registry had **no entry**
for `Clshec/notion-sync-plugin`, however, so no completed Woodpecker
pipeline can be claimed yet. The UI is intentionally private, and its
public hostname returns HTTP 404; do NOT expose it publicly to fix CI.
Activate the repository using authenticated private management access and
the existing approved signed GitHub webhook gateway; then verify a real
Woodpecker PR pipeline before treating this CI migration as complete.

See [existing Alf one-token profile](alf-life-os-zero-config.md) and
[Woodpecker workflow syntax](https://woodpecker-ci.org/docs/usage/workflow-syntax).
