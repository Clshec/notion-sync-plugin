# Security policy — Alf Notion Super Productivity

## Do not use this alpha fork with production Notion data yet

The inherited alpha plugin has risky behaviors:
- It assumes a dedicated English-language Notion Tasks database and may create/alter/archive pages without matching the user's actual schema.
- It stores `apiKey` inside synchronized plugin configuration and may export it. This must be migrated to local `PluginAPI.setSecret/getSecret` before public use.
- Direct `fetch` integration and the 2022 API version need modern host HTTP permission / Notion API verification for Android and current Notion data sources.

**Current release status: not production-safe.** Do not install or enable against an existing workspace until the refactor and tests are completed.

## Credential exposure warning

An integration credential was embedded in the inherited upstream `TEST_PLAN.md` and was removed from the visible default-branch file in an emergency security commit. **It can still exist in historical Git commits, fork metadata and cached copies. Removing the current file text does not revoke it or purge public history.**

Owner action required:
1. Go to [Notion integrations](https://www.notion.so/profile/integrations) and **revoke/rotate the affected integration token**.
2. Reissue credentials on each device only after the plugin stores them locally and securely.
3. Treat any copies of the old token as compromised; coordinate with upstream owner for upstream history remediation if appropriate.
4. Never post a token in GitHub Issues, PRs, docs, test plans or chat.

## Planned safeguards

- Public source mapping is read-only by default. Explicit validation, dry-run diff and opt-in before each new class of write.
- No hard-coded IDs, paths, database names, user identity or credentials in code.
- Per-device local secret store rather than `persistDataSynced` for tokens.
- Redact headers, tokens, page contents and sensitive payloads in errors/logs.
- `PluginAPI.request` with `http` permission and explicit `api.notion.com` allowlist.
- Least privilege Notion integration connected only to authorized databases.
- Structured errors, rate limiting, idempotent Notion writes and a conflict review queue.
- Avoid auto-archive/delete; use explicit user confirmation and backups.

## Reporting vulnerabilities

Use a private channel to communicate any actual tokens, private URLs or exploitable details to the repository owner. **Do not open public issues containing credentials.** For non-sensitive issues, GitHub Issues can be used once enabled in repo settings.
