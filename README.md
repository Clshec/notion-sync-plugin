# Alf Notion Super Productivity

**Status: EARLY FOUNDATION / NOT READY FOR INSTALLATION OR PRODUCTION SYNC.** This is a public, MIT-licensed fork of [AlessioLovato/notion-sync-plugin](https://github.com/AlessioLovato/notion-sync-plugin), originally written by **Alessio Lovato**. The MIT copyright and LICENSE are preserved.

## Why this fork exists

**Notion is the planning authority and long-term record; Super Productivity is the fast, local-first execution tool** for Desktop and Android. The goal is to preserve existing Notion databases and their relations while using SP's tasks, parent/subtasks, habits, day planning, time estimates, tracking and Pomodoro/Flowtime/Countdown modes.

There must be **no requirement to create new Notion databases**. Existing properties can be mapped to SP fields through a future general configuration UI. Optional missing properties may be added only after user approval. The plugin must remain reusable by any Notion user, not tied to a particular workspace.

## Important safety notice

The inherited alpha runtime currently uses hard-coded English Notion database properties, creates/updates Notion pages under assumptions not valid for general-purpose data sources, and previously placed the Notion token inside synchronized configuration. It also does **not** provide accurate per-task completed Pomodoro session history via the official Plugin API.

**Do not install this fork against valuable existing Notion workspaces or enable automatic sync until the refactor and safe preview tests are completed.**

An inherited test document contained an integration credential that has been removed from the current default-branch file. It remains potentially exposed in Git history. **Revoke/rotate the affected Notion integration credential immediately.** See [SECURITY.md](SECURITY.md). Never commit secrets.

## Architecture and design contracts

- [Architecture / authority / safety and Pomodoro API gap](docs/architecture/alf-sync.md)
- [Field mapping: execution date, deadline, estimate, actual time, status, habits](docs/architecture/field-mapping.md)
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
- For the current inherited alpha runtime details, inspect `plugin.js`, `index.html`, and `manifest.json`. These are **not yet evidence of a working Alf integration**.

## License and provenance

MIT — see [LICENSE](LICENSE), including the original 2025 copyright for Alessio Lovato. Contributions to this fork retain that notice.
