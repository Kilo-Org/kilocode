# Kilo v2 migration plan

## Objective

Ship Kilo on the upstream OpenCode v2 runtime with v1 feature parity, surface by surface. `origin/v2` becomes `main` at cutover.

## Working principles

- **Real work first.** A process step stays only if it protects the product or keeps upstream syncs cheap.
- **Features are the unit of planning.** Each epic has an owner and lands in as many PRs as needed.
- **Decide as we go.** Whoever builds a feature makes the decisions inside it. A decision is recorded in the PR or issue that acts on it.
- **The repo holds stable content; GitHub holds state.** Status, owners and progress live in the issues, milestones and the Project, not in this repository.
- **Product value drives order.** Milestones order the work by what users get.

The technical rules (direction, placement, clients, identity, behavioral reference) are in [`principles.md`](principles.md).

## Milestones

| Milestone | Meaning |
|---|---|
| M1 Internal daily use | The team uses `kilo2` daily: config, session policy, tools and permissions, the Kilo TUI surface (usage, picker, sidebar), import of our own v1 sessions |
| M2 Public CLI preview | Distribution, updater, signing, remote, sharing |
| M3 VS Code on v2 | The trailing client catches up |
| M4 Cutover | JetBrains, Kilo Desktop, external consumers, flipping `main` |

## Epics

### M1 Internal daily use

- [#15171](https://github.com/Kilo-Org/kilocode/issues/15171) Foundation: the Kilo host, plugin and RPC scaffolding, and the v2 CI lane.
- [#15020](https://github.com/Kilo-Org/kilocode/issues/15020) Upstream sync: merge tooling and regular syncs from `upstream/dev`, with the shared-patch checks.
- [#14991](https://github.com/Kilo-Org/kilocode/issues/14991) Kilo Gateway, login and enterprise: the Gateway as the only source of Kilo models, accounts, teams and Kilo request identity, as a Kilo-owned layer.
- [#15298](https://github.com/Kilo-Org/kilocode/issues/15298) Identity, branding and store: v2 runs as Kilo, with its own `kilo2` store that never touches v1 files. Open: TUI `.opencode` themes and plugins.
- [#15299](https://github.com/Kilo-Org/kilocode/issues/15299) Config and settings: `kilo2.json` and `.kilo2` discovery, key mapping, managed policy, a settings RPC that owns reload, and the server extension surface. Open: system and MDM config names.
- [#15300](https://github.com/Kilo-Org/kilocode/issues/15300) Session policy and snapshots: offline network wait, overflow and compaction thresholds, snapshot policy and retention, transcript recall.
- [#15301](https://github.com/Kilo-Org/kilocode/issues/15301) Agents, modes and plan: the Kilo agents, mode reminders, the agent builder, the Plan workflow and Plan-to-Code handoff, the review policy. Open: Plan storage.
- [#15302](https://github.com/Kilo-Org/kilocode/issues/15302) Tools, permissions, commands and skills: the Kilo tool set and client gating, question and suggest tools, permission rules, commands, workflows, skills and rules.
- [#15303](https://github.com/Kilo-Org/kilocode/issues/15303) Usage, cost and telemetry: model usage and cost, provider usage and quotas (`/usage`), the max-cost alert, telemetry with consent.
- [#15304](https://github.com/Kilo-Org/kilocode/issues/15304) TUI shell and sidebar: the Kilo terminal UI, slash commands and dialogs, home and sidebar, model picker, notifications.
- [#15305](https://github.com/Kilo-Org/kilocode/issues/15305) CLI commands, run, ACP and daemon: the Kilo command set, `kilo2 run` and headless use, ACP, the service, startup performance.
- [#15306](https://github.com/Kilo-Org/kilocode/issues/15306) Import and migration: v1 sessions, credentials and config imported into the v2 store without touching v1 files. The team's own sessions first; the public import comes with M2.

### M2 Public CLI preview

- [#15307](https://github.com/Kilo-Org/kilocode/issues/15307) MCP and marketplace: Kilo's MCP additions (OAuth, auth-failure surfacing, `git:` sources) and the marketplace for MCP servers, skills, modes and plugins.
- [#15308](https://github.com/Kilo-Org/kilocode/issues/15308) Memory and indexing: the memory engine and tools, codebase indexing and `semantic_search`.
- [#15309](https://github.com/Kilo-Org/kilocode/issues/15309) Sandbox: shell, MCP and PTY confinement with network relay on macOS and Linux.
- [#15310](https://github.com/Kilo-Org/kilocode/issues/15310) Agent coordination and worktrees: background subagents, wakeups and cron, goals, the shared agent board, background processes, worktrees and the Agent Manager control plane.
- [#15311](https://github.com/Kilo-Org/kilocode/issues/15311) Distribution, updater and signing: a signed `kilo2` that installs beside v1, updates and rolls back, and the release pipeline. Open: updater distribution identity.
- [#15312](https://github.com/Kilo-Org/kilocode/issues/15312) Remote sessions: `kilo remote` over the Kilo relay.
- [#15313](https://github.com/Kilo-Org/kilocode/issues/15313) Sharing: individual share, unshare and fork-from-share, and a public viewer for v2 sessions.

### M3 VS Code on v2

- [#15314](https://github.com/Kilo-Org/kilocode/issues/15314) Editor services and FIM: the FIM and next-edit producer and the generation endpoints (enhance prompt, commit message, branch name). FIM gates VS Code.
- [#15315](https://github.com/Kilo-Org/kilocode/issues/15315) VS Code client: a new package on `origin/v2`, the v1 UI ported onto `@opencode/client` plus Kilo RPCs.

### M4 Cutover

- [#15316](https://github.com/Kilo-Org/kilocode/issues/15316) JetBrains client: the plugin re-landed on `origin/v2`, on a client generated from the v2 contract.
- [#15317](https://github.com/Kilo-Org/kilocode/issues/15317) Kilo Desktop client: Kilo Desktop on v2, planned with its owner (not Anaconda Desktop, not upstream's desktop app).
- [#15318](https://github.com/Kilo-Org/kilocode/issues/15318) Cloud agent consumers: each cloud consumer of the Kilo CLI adapted and validated, with an owner from the consuming team.
- [#15319](https://github.com/Kilo-Org/kilocode/issues/15319) Anaconda Desktop: its integration with v2, with an owner from the consuming team.
- [#15320](https://github.com/Kilo-Org/kilocode/issues/15320) Cutover and retirement: `origin/v2` becomes `main`, v1 moves to a maintenance branch that still builds and releases, every deployment from `main` has an owner.

### No milestone

- [#15321](https://github.com/Kilo-Org/kilocode/issues/15321) Post-cutover backlog: the out-of-scope items below, each with a ship, drop or re-scope decision when it comes up.
- [#15322](https://github.com/Kilo-Org/kilocode/issues/15322) Acceptance and docs: scenario sets, acceptance runs per release, and kilo.ai/docs for the shipped surface.
- [#15323](https://github.com/Kilo-Org/kilocode/issues/15323) Uncategorized: v2 issues that do not fit an epic yet.

## Out of scope

Not carried, or post-cutover and non-gating unless explicitly made a gate:

- voice and speech-to-text;
- image generation;
- team and incremental sharing;
- legacy TUI extras;
- features behind experimental flags that are off by default on v1;
- KiloClaw (not needed);
- upstream's desktop app, web app (the CLI embeds no web UI) and hosted platform packages, and upstream's own `.opencode/` contributor config.

Features named experimental but on by default on v1 (for example background subagents and the shared agent board) are in scope like any shipped feature.

## Where things live

- Live state: root issue [#15297](https://github.com/Kilo-Org/kilocode/issues/15297), the epics above, milestones M1 to M4, and [Project 42](https://github.com/orgs/Kilo-Org/projects/42).
- Technical rules: [`principles.md`](principles.md).
- Procedure: the skills in `.kilo/skills/` (`v2-migration`, `v2-feature-placement`, `kilocode-merge-minimizer`).
