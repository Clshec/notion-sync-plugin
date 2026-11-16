# Opt-in Habit Tracker daily values → existing Notion occurrences (v0.7 alpha)

**Goal:** Preserve the user's existing Notion system, with **habit definitions in their existing habit source** and **daily habit occurrences in their existing `اللوح` / task source**. No new database, page or relation may be created by this feature.

## Explicit opt-in workflow

1. Map the existing Notion habit definitions and link them to existing SP counters by ID (v0.6). This link is stored under `alf-habit-definition-link-v1-${notionHabitPageId}`.
2. Configure a source for **existing habit occurrence pages**, using the same configured task/board data source or another Notion source depending on the user. Provide:
   - item type property `نوع الصفحة` (Select/Multi-select) and exact value `عادة`;
   - relation `قاعدة العادات` (must point to **exactly one** existing habit definition);
   - execution day `يوم التنفيذ` (Date, date-only for v0.7);
   - numeric completion/quantity field (Number), e.g. `Habit Count`. **This Number property must already exist**.
3. Select the unit **Count** (for `ClickCounter`), or **Minutes/Hours** (for `StopWatch`). SP stores StopWatch daily values in milliseconds.
4. Click **Preview today's existing habit-day differences**. The plugin uses optional official SP `getDayContext().todayStr` to respect the configured logical day, never the device calendar. If unavailable, it **refuses to write**. Query Notion data sources using date/type filters and pagination.
5. Only existing occurrence rows with matching type, day, single definition relation and linked SP counter are candidates. Missing relations, absent counter values, duplicate habit/day occurrence pages, stale SP totals, unsupported units and ambiguous pages are skipped.
6. Review the exact `before → after` values, and check the **separate authorization checkbox**. Only then use **Write reviewed habit-day counts**.
7. For every candidate, refetch the exact Notion page and revalidate its data source, item type, execution date, original habit relation and unchanged numeric count. Also re-read SP counter value. Only then issue a `PATCH /v1/pages/{page_id}` with **one** numeric property.
8. Clear staged values after the operation. Next attempt requires new preview and authorization. No implicit page creation, no automatic worker, no batch mass update.

## Safety and limitations

- The plugin does not add a Notion `Habit Count` field. A user can opt to add one to the **existing** source if needed, but the plugin never creates or changes schema.
- Only records with positive count/duration are considered in v0.7. No zero-to-zero or `false` completion write. Use the existing Notion Status property independently if desired; this feature does not alter it.
- Daily occurrence relation must point to exactly one habit definition. The normalized habit identity and logical date identify one occurrence.
- A duplicate page for the same habit and day invalidates both; it is not picked arbitrarily.
- `ClickCounter` gets the raw positive count, whereas `StopWatch` converts milliseconds to explicitly selected minutes/hours (precision 6 decimals). Types and units must match.
- The snapshot is bounded to 300 filtered pages; if more remain, refuse rather than silently consider the set complete.
- Absolute value updates avoid additive duplicates. Stale devices with smaller SP totals are skipped, but true atomic cross-device compares are unavailable in Notion PATCH. There is still a GET/PATCH race; this is **not production-grade distributed synchronization**.
- No writes to habit definitions, task title, due date, deadline, project relations or SP counters. No new databases.
- Missing daily rows remain missing; the plugin does not create them. A future separately approved idempotent create/reconcile system would require a stronger concurrency plan.
- Android/Desktop and real Notion sandbox verification still need to be completed; mocked tests do not prove deployment behavior.

## Next work

- Deduplication across multiple devices; transaction queue/checkpoint and conflict review.
- Notion-defined frequency/targets/build-vs-break and flexible daily statuses.
- Incremental sync with Notion pagination and high-volume backfill by logical day.
- Optional creation of missing daily occurrence records in the **existing** Notion source, but only after testing and explicit user approval.
- Real automated Pomodoro work-mode session completions need a stable SP structured focus-session API; they are not derivable from daily habit values.

[Habit definitions](habit-mapping.md) · [Overall design](alf-sync.md) · [Task time writeback](time-writeback.md)

### v0.13 post-preview duplicate/removed occurrence recheck

The stage and commit paths use the same paginated Notion data-source query constrained by pinned item-type and logical-day property IDs. At commit, before writing any approved Number update, the plugin fetches the **current full set** of existing habit-day occurrences. It groups rows using `habitDefinitionId + logicalDay`, and each staged `pageId` is eligible only if the current group contains **exactly one** matching page. Newly created duplicates, removed/moved rows and changed relation/day prevent a write, while unrelated habit definitions remain independent. Truncated queries abort rather than choosing partial results. Existing per-page source/type/date/relation/Number before-value and SP counter/link revalidation still apply. No records or databases are created. Notion's public API still offers no atomic cross-device compare-and-swap, so real concurrent mutation during PATCH remains an unresolved risk.

### v0.16 — automatic existing habit-day counts, per-device opt-in only

Third experimental automatic workflow: after the user explicitly previews today's existing Notion habit-day records and authorizes a local-only toggle (`alf-auto-habit-local-enabled-v1`), `plugin.js` periodically processes up to 3 existing occurrences per ~10 minutes while Super Productivity runs. It does not create any Notion page, database, property or SP counter. It uses the SP logical day from `getDayContext` and only the configured exact date-only `YYYY-MM-DD`; missing, previous, future or ambiguous rows are skipped. Definition-to-counter mappings must preexist in keyed `alf-habit-definition-link-v1-` records; reused SP counters across different habit definitions, invalid/missing mappings and disabled counters are rejected.

The same pinned field IDs drive the Notion data-source filter and one-field Number PATCH. Only a compatible positive ClickCounter (`count`) or StopWatch (`minutes`/`hours`, converted from raw ms) qualifies. For unanchored rows, a blank/zero existing Notion count can be incremented under the explicit global opt-in; a positive matching value is adopted without a PATCH, while a different positive value is a conflict requiring manual reconciliation. Subsequent runs compare the current Notion Number and raw SP counter with the last confirmed per-day/per-page baseline (`alf-habit-auto-anchor-v1-` + original Notion page ID). Decrements and manual changes fail closed.

At commit, the engine re-queries the full existing day inventory to detect post-preview duplicates, re-reads the original page's parent/type/date/relation/Number, rechecks the original SP counter, link, anchor and local enable flag, then PATCHes exactly the pinned Number ID. The new baseline is persisted only after a confirmed update; an uncertain network result leaves a conflict on the next run, not a repeated PATCH. No cross-device distributed lock, atomic Notion GET/PATCH, guaranteed Android background scheduling or automatic row creation exists; sandbox/device validation is required before production.

### v0.19 — explicit per-habit allowlist is mandatory (security boundary)

The previous v0.16 local-enable flag was **insufficient** as a permission grant: it could potentially update any linked habit's existing daily Number, even if that definition was not one of the user's reviewed items. This is corrected by mandatory per-definition, counter-specific synced approvals (`alf-habit-auto-allow-v1-<original Notion habit ID>`) saved only after a reviewed current-day preview and independent user opt-in. An approval contains the original definition ID, SP SimpleCounter ID, exact existing board and habit source IDs and immutable pinned occurrence-property mapping fingerprint. On enabling, re-query the complete existing day inventory and recheck exact Notion page identity/value, unambiguous relation, and unchanged SP counter and link. If an existing Notion Number is nonzero and differs from SP, the user must manually reconcile it first; such rows are **not eligible for automation consent**. Duplicates and unlinked habits are never approved.

The background engine refuses any habit with missing/stale/mismatched approval, including old v0.16 users previously opted-in without this allowlist. Approval must match the source, definition, counter and exact current field ID/unit/type fingerprint, and is re-read immediately before PATCH. An approval authorizes the definition's later **existing** logical-day occurrence rows, not any unlinked/new definition or new Notion row creation. Local-only auto-enable flag is independent of synced per-definition approvals. This makes the unattended write scope explicit and reviewable, but does not solve Notion's non-atomic GET/PATCH or multi-device locking.
