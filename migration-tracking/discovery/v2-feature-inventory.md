# Kilo v1 → v2 feature inventory and delta

Status: discovery output, 2026-10-11. Single writer: discovery analyst. Companions: `v2-epic-taxonomy.md` (epics), `v2-unit-register.md` (units, staleness, donor), `doc-inventory.md`, `../technical-notes/baseline/pinned-v2-baseline.md`.

## Why this file exists

The plan needs one list of everything Kilo v1 does and everything upstream v2 already provides, so that each v1 feature gets a delta verdict and lands in exactly one unit. This file holds the per-feature facts. Epic and unit structure live in the companion files.

## Refs and method

| Ref | Value |
|---|---|
| V1 target | `fb7e96eda5409517a05948b9efaf01c53997bf6e` (`origin/main`, 2026-10-09) |
| V1 assessment snapshot (SNAP) | `f7115470` (2026-08-12), as named in `migration-context.md`. The 816-file assessment text pins `d99662338e` (2026-08-10), 800 commits earlier. See "Snapshot discrepancy" below |
| Upstream base (BASE) | `5e73d5cb` (parent of `v2.0.26`, on `upstream/v2`) |
| Donor | tag `kilo-v2-checkpoints-2026-09` = `879b89e8`, upstream merge base `59b29de4` |

Method: read-only `git ls-tree`/`git show`/`git diff` at the pinned refs, reusing `marker-audit/`, `technical-notes/` and issues #13750, #14016–#14024, #14371–#14432. Four delegated inventories (v1 core, v1 IDE clients, upstream v2, staleness and donor) were synthesized here. Verdicts not exercised at runtime are marked UNVERIFIED.

Delta vocabulary (per feature), applying Decision 7:

| Verdict | Meaning |
|---|---|
| needs-port | V1 behavior required at a gate, with no v2 equivalent |
| native | BASE covers scope, errors, cancellation, persistence and presentation; only verification or branding remains |
| partial | BASE has the mechanism or part of the behavior; Kilo policy or presentation must be added |
| not-needed | Obsolete, removed on V1, or superseded on v2 |
| post-cutover | Real V1 behavior, but non-gating under Decision 7 |

Each table's **Unit** column points at `v2-unit-register.md`.

## The v1 line on `main`

| Fact | Value |
|---|---|
| CLI package and version at V1 | `@kilocode/cli` 7.8.8 (`packages/opencode/package.json`), bins `kilo`, `kilocode`. Version at SNAP: 7.4.21 |
| Upstream base of v1 | opencode v1.18.26 (`.opencode-version`). V1 already contains upstream's split packages (`core`, `tui`, `schema`, `protocol`, `server`, `llm`, `client`) and the early Core-V2 event store |
| Cadence SNAP→V1 | 38 `release: v…` commits, v7.4.22 → v7.8.8 (~4–5 per week). JetBrains releases on its own line (`release(jetbrains): v7.1.7-rc.3 … v7.1.9`) |
| Volume SNAP→V1 | 4,104 files, +394,860/−68,348; 3,107 non-merge commits, 2,786 Kilo-authored, 321 upstream-origin (upstream merges #13002, #13368, #13513, #14449: v1.18.13 → v1.18.26) |
| Release mechanism | `publish.yml` (workflow_dispatch) → `script/version.ts` → `packages/opencode/script/build.ts` (linux x64/arm64 glibc and musl, darwin, windows incl. baseline and arm64) → VSIX build → publish |
| Channels | npm `@kilocode/cli` plus platform packages; GHCR `ghcr.io/kilo-org/kilocode`; AUR `kilo-bin`; Homebrew `Kilo-Org/homebrew-tap`; GitHub release archives; `install` script (`https://kilo.ai/cli/install` → `~/.kilo/bin`); nix flake; Zed extension manifest |
| Common ancestor with BASE | `0e2dd4ad` (2026-06-26). BASE is 4,343 commits past it, V1 is 18,848 |

## Upstream v2 at BASE

| Fact | Value |
|---|---|
| CLI package | `@opencode/cli` 2.0.25 in-tree (2.0.26 bump lives only in the tag commit), bins `opencode`, `opencode2` |
| Scope | `@opencode/*` since `a5312e16` (2026-09-07). `@opencode-ai/pty` keeps the old scope |
| Drift since the donor base `59b29de4` | 1,454 commits; 5,029 files, +344,830/−161,776 |
| Product surfaces | CLI + TUI, managed background service, Electron desktop and web app (`packages/desktop`, `packages/app`), thin `sdks/vscode` launcher, ACP, hosted web properties |

## Part 1. Upstream-v1 behavior Kilo inherits, against BASE

Kilo v1 inherits these groups from opencode v1.18.26. Kilo's patches on them are itemized in Part 2 or in the marker assessment.

| Group | V1 behavior | BASE equivalent | Verdict | Unit |
|---|---|---|---|---|
| Sessions and prompt loop | Session CRUD, message/part model, agent loop, prompt queue, abort, revert, fork, title, SQLite store | Durable inbox, steer/queue delivery, explicit step loop, restart recovery, fork/move/background (`core/src/session/*`) | native (different model: self-contained typed messages, see `v2-v1-schema-diffs.md`) | U-E2-06 |
| Compaction and snapshots | Auto-compaction, prune, tail turns, git snapshots, diff/restore | `session/compaction.ts` (auto/overflow/manual, native compaction), `snapshot.ts`, revert stage/commit | partial (`prune`/`tail_turns` unsupported, `config/normalize.ts:332-333`) | U-E2-02, U-E2-03, U-E2-04 |
| Tools | bash, read, edit, write, patch, grep, glob, list, webfetch, websearch, task, todo, question, skill, lsp, batch, multiedit | edit, patch, write, read, glob, grep, shell, webfetch, websearch, skill, subagent, question, mcp-resource, file-diff | partial (no todo, no LSP diagnostics: TODOs at `edit.ts:107`, `file-mutation.ts:131`) | U-E2-16 |
| Permissions | Rule-based allow/ask/deny, per agent, external_directory | Rule effects per action/resource, per-session rules, saved approvals, managed policies, forms | native | U-E2-17 |
| Providers and models | models.dev, AI SDK providers, auth plugins | `@opencode/ai` runtime, 33 provider plugins, swappable catalog (`ServerOptions.models`) | native mechanism | U-E1-04 |
| Config | Layered jsonc, markdown agents/commands, env overrides | Per-domain folding with diagnostics, `ConfigMigrateV1` (opencode v1 only) | partial (filenames hard-coded, Kilo keys absent) | U-E1-07 |
| Agents, commands, skills | build/plan/general/explore, slash commands, skills | Same plus remote skill index and policies; `/init`, `/review` | native mechanism | U-E2-12 |
| MCP | Local/remote, OAuth, prompts/resources | Reworked client, stdio, OAuth with AS metadata, CLI auth | native (Kilo deltas in U-E2-22) | U-E2-22 |
| LSP, formatters, watcher | Auto-download LSP, formatters | Formatter config plugin; no LSP diagnostics tool | partial | U-E2-16 |
| Server and API | Effect HttpApi + SSE, basic auth, generated SDK | 30 protocol groups, plugin RPC `/api/rpc/:rpcID/:method`, generated client | native | U-E1-08 |
| TUI | opentui/solid TUI, themes, dialogs, sidebar, keybinds, feature plugins | Tabs, diff viewer, ~45 dialogs, slot API, semantic theme tokens, notifications and sound | native mechanism | U-E9-05 |
| ACP | `kilo acp` | `cli/src/acp/*` (elicitation→forms, compaction updates) | native | U-E9-04 |
| Sharing | share/unshare | Config key `share` only, no runtime | partial (Kilo share is its own backend) | U-E5-01 |
| Workspaces, worktree, PTY | Control-plane workspaces (experimental), worktree, PTY | Project worktrees, persistent PTY, workspace/environment drivers | native | U-E2-26 |
| CLI commands | run, serve, attach, models, stats, export, import, session, github, pr, plugin, db, debug, agent, auth, upgrade, uninstall, mcp | run, serve, service, api, models, stats, debug, plugin, session export/import, auth, mcp, pair, upgrade, uninstall, mini | native (no `github`/`pr`/`db` equivalents; UNVERIFIED whether needed) | U-E9-02 |
| Plugins and SDK | Plugin hooks, TUI plugins | Effect/Promise plugin API, TUI plugin slots, in-process SDK host | native | U-E0-02 |

## Part 2. Kilo v1 customizations: core, CLI/TUI, gateway, packaging

Source: delegated v1-core inventory (129 features, F-CORE-001…129). Every `packages/opencode/src/kilocode/*` top-level entry (120) maps to a feature or is infrastructure (`fn.ts`, `process/`, `effect/`, `index.ts`, part of `bootstrap.ts`). `k/` = `packages/opencode/src/kilocode/`.

Column **Snap**: `pre` = present at SNAP with no material change; `Δ` = present at SNAP and changed by V1 (re-derive behavior from V1, Decision 4); `POST` = added after SNAP, so absent from the 816-file assessment.

### A01 Identity, paths, store

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-001 | Kilo identity and branding (soul prompt, headers, `kilo`/`kilocode` bins, `KILO_*` env, logo) | `k/soul.txt`, `k/const.ts`, `k/cli/logo.ts`, `packages/core/src/flag/flag.ts` | pre | `app="opencode"` hard-coded (`util/src/global.ts:12`), bin literal (`cli/script/build.ts:16`), `OPENCODE_*` env, UA prefix | partial (needs counted shared patches) | U-E1-01 |
| F-CORE-002 | Kilo paths and isolated DB/store, DB preflight, friendly SQLite errors | `k/paths.ts`, `packages/core/src/kilocode/{global,database-compat,db-preflight,sqlite-error}.ts` | Δ (WAL recovery `97abdab66c`, interrupted first access `1988e54fd6`) | `OPENCODE_DB`, Global layer replacement, `ServerOptions.database` | partial | U-E1-02 |
| F-CORE-003 | Legacy JSON→SQLite storage migration | `k/storage/json-migration.ts` | Δ small | none | needs-port (inside import only) | U-E3-01 |
| F-CORE-004 | Run/process log correlation, spawn validation | `k/log.ts`, `k/process/env.ts`, `packages/core/src/kilocode/{stdio-tap,exit-code,spawn-*,zero-id}.ts` | pre (zero-id POST) | Observability layer | partial | U-E1-02 |

### A02 Daemon, server, lifecycle

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-005 | `kilo daemon status/stop/restart`, managed background server | `k/daemon/*`, `k/cli/cmd/daemon.ts` | pre | `service start/stop/status/…`, registration file, `--standalone`, `--server` | native (command-name compatibility only) | U-E9-01 |
| F-CORE-006 | Kilo HttpApi groups (`/kilo`, `/kilocode`, `/remote`, `/network`, `/sandbox`, `/indexing`, `/memory`, `/telemetry`, `/suggestion`, `/commit-message`, `/branch-name`, `/enhance-prompt`, `/agent-builder`, `/background-process`, `/config/*`, `/instance/reload`, `/kilocode/migrate/*`, …) and CORS | `k/server/**`, `packages/server/src/kilocode/*` | Δ (+1,385/−537; migrate group POST) | Plugin RPC endpoints, `routes.ts` overrides | partial (mechanism native; each group re-homed with its feature) | U-E1-08 |
| F-CORE-007 | Parent watchdog (server exits when the embedding IDE dies) | `k/parent-watchdog.ts` | pre | `Mode="stdio"` exists; no parent-PID watchdog | needs-port | U-E1-08 |
| F-CORE-008 | Kilo bootstrap, instance reload, orderly shutdown | `k/bootstrap.ts`, `k/instance.ts`, `k/project/reload.ts` | Δ (`/reload` reloads project `3a2c5d5c2e`, shutdown deadline) | `reload`, service lifecycle | partial | U-E1-08 |
| F-CORE-009 | v1→V2 event bridge and wire encoding | `k/event-v2-bridge.ts`, `k/event-wire.ts` | POST | Native event system | not-needed (v2 is the target model) | U-E1-08 |
| F-CORE-010 | Startup performance: lazy commands, port warning, heap snapshot | `k/cli/{lazy-*,port-warning,heap-snapshot}.ts` | POST (lazy) | Upstream startup loading | partial (port warning, heap snapshot UNVERIFIED) | U-E9-01 |
| F-CORE-011 | Watcher eagerness policy for embedded clients | `k/watcher.ts` | Δ | Upstream watcher | partial | U-E1-08 |
| F-CORE-012 | TUI worker RPC handshake hardening | `k/util/rpc.ts` | POST | Different TUI transport at BASE | not-needed unless the defect reproduces (UNVERIFIED) | U-E9-05 |
| F-CORE-013 | Caffeination (`/caffeinate`) | `packages/core/src/kilocode/caffeination.ts` | POST | none | needs-port | U-E9-05 |
| F-CORE-014 | PTY registry/termination, hidden `__pty-smoke`, PTY cleanup on worktree removal | `packages/core/src/kilocode/pty/*`, `k/cli/cmd/pty-smoke.ts` | POST | Persistent PTY | partial | U-E3-07 |

### A03 Gateway auth, organization, balance, Pass

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-015 | Kilo Gateway device-code auth, token storage, legacy token migration, logout | `packages/kilo-gateway/src/auth/*` | Δ | Integration framework (key/OAuth/command/external), credentials | partial (mechanism only) | U-E1-03 |
| F-CORE-016 | Profile, organizations, teams, balance refresh | `kilo-gateway/src/api/profile.ts`, `k/cli/cmd/profile.ts`, `k/components/dialog-kilo-*` | pre | none | needs-port | U-E1-03 |
| F-CORE-017 | Kilo Pass status | `kilo-gateway/src/api/kilo-pass.ts` | pre | none | needs-port | U-E1-03 |
| F-CORE-018 | Gateway notifications and news (home, banner) | `kilo-gateway/src/api/notifications.ts`, `k/components/*news*` | pre | none | needs-port | U-E9-06 |
| F-CORE-019 | Kilo gateway error codes, actionable display | `k/kilo-errors.ts` | Δ | Generic provider errors | needs-port | U-E1-03 |
| F-CORE-020 | Provider usage and quotas (Kilo, Codex, MiniMax) `/usage` | `kilo-gateway/src/provider-usage.ts`, `packages/core/src/kilocode/provider-usage/*` | POST | none | needs-port | U-E1-06 |
| F-CORE-021 | tRPC client for Kilo cloud | `kilo-gateway/src/api/trpc.ts` | POST | none | needs-port (dependency of cloud features) | U-E1-03 |

### A04 Provider, model catalog, routing

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-022 | Kilo Gateway provider (headers, metadata, Responses API) | `kilo-gateway/src/{provider,headers,gateway-metadata,responses}.ts`, `packages/core/src/plugin/provider/kilo.ts` | pre | `provider/kilo.ts` brands calls as opencode | partial | U-E1-04 |
| F-CORE-023 | Gateway catalog merge, refresh, corrupt-cache recovery, filtering | `k/provider/{catalog,catalog-recovery,models-refresh,…}.ts` | Δ (recovery chain `5539dd3ae5` #14723, `2792c704ed` #14794) | Swappable models.dev source | partial | U-E1-04 |
| F-CORE-024 | Kilo Auto and routed-model display | `k/cli/run-auto.ts`, `k/session/routed-model.ts` | pre | none | needs-port | U-E1-04 |
| F-CORE-025 | Provider options, reasoning summary, model-family match | `k/provider-options.ts`, `k/model-match.ts` | Δ | provider/model transforms | partial | U-E1-04 |
| F-CORE-026 | Codex token refresh, cloud-agent provider auth, session headers | `k/provider/{codex-refresh,cloud-auth,opencode-session-headers}.ts` | POST (2 files) | Copilot/Codex providers upstream | partial | U-E1-04 |
| F-CORE-027 | Model info panel, pricing, free/prompt-training disclosure, Kilo picker grouping | `k/components/model-info-panel*`, `packages/tui/src/kilocode/model-picker.ts` | POST (picker) | Native picker | partial | U-E9-07 |
| F-CORE-028 | Session-family model usage, cost, throughput, subagent cost propagation | `k/session/{model-usage,metrics,cost-propagation}.ts` | Δ | Session stats | partial | U-E1-06 |
| F-CORE-029 | Per-model system-prompt selection (8 selectors), memory guidance, editor `<env>` context | `k/system-prompt.ts`, `k/editor-context.ts` | Δ | `plugin/system-prompt.ts` deleted at BASE (#47447, #47559); `session.hook("context")` | partial (seam moved; re-seat) | U-E1-05 |
| F-CORE-030 | `kilo roll-call` model connectivity test | `k/cli/cmd/roll-call.ts` | pre | none | needs-port | U-E9-02 |

### A05 Config and settings

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-031 | Kilo config layer: Kilo keys, overlay/effective/sources APIs, writer, retired-key warnings, validation | `k/config/*`, `k/config-validation.ts` | Δ (+1,227; `memory_model` #14781, swarm #14160, PTC #14230, cleanup #14054) | Folding + diagnostics, no Kilo keys or `kilo.json` names | partial | U-E1-07 |
| F-CORE-032 | References glue (effective Kilo config into Core-V2 references) | `k/reference.ts` | Δ | Native references | partial | U-E1-07 |
| F-CORE-033 | TUI config writes and hot reload | `k/tui/config.ts`, `…/tui-config-hot-reload.ts` | pre | TUI config, settings dialog | partial | U-E9-05 |

### A06 Session runtime policy

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-034 | Offline wait and reconnect | `k/session/processor.ts` (+ #14893 conn-reset retry at the V1 tip) | Δ | Retry bounded at 10 recurs (~84 s); `session.hook("retry")` cannot extend | needs-port | U-E2-01 |
| F-CORE-035 | Overflow accounting, `threshold_percent`, chunked compaction, payload recovery | `k/session/{overflow,compaction*}.ts` | Δ (`5edf432c2f` #14318) | Auto/overflow compaction, `buffer`/`keep` | partial | U-E2-02 |
| F-CORE-036a | Slow-snapshot interaction (timeouts, question, persisted disable) | `k/snapshot/{track,prepare}.ts` | Δ | Snapshots, no slow-snapshot question | partial | U-E2-03 |
| F-CORE-036b | Snapshot seed/materialize, locking, cleanup, retention | `k/snapshot/{seed,materialize,lock,cleanup}.ts` | Δ (+490; lock/cleanup POST) | Snapshot perf work, no Kilo hardening | partial | U-E2-04 |
| F-CORE-037 | Session drain, stop/resume control, `kilo run` waits for drain | `k/session/{drain,control}.ts` | POST | Run coordinator, interruption | partial | U-E2-06 |
| F-CORE-038 | Wakeups and cron (persisted, re-armed at start) | `k/wakeup/*`, `k/tool/{schedule-wakeup,cancel-wakeup,cron}.ts` | POST (#14094, #14312) | none | needs-port | U-E2-08 |
| F-CORE-039 | Goal mode (`/goal`, `goal`/`goal_report`) | `k/session/goal/*` | POST (#13679, #14504) | none | needs-port | U-E2-09 |
| F-CORE-040 | Backend-owned session retention | `k/session/retention.ts` | POST (#14054) | none | needs-port | U-E2-10 |
| F-CORE-041 | Subagent resume hint, background subagents (flag default **on**), steering into subagents | `k/task-resume.ts`, `k/tool/task*.ts`, `k/session/steering.ts` | Δ (#14702, #13641) | Background subagents, restart recovery | partial | U-E2-07 |
| F-CORE-042 | Message deletion, Kilo revert semantics, stable ordering | `k/session/{revert,message-order,part-lifecycle}.ts` | Δ | Revert + inbox cancel only | needs-port (deletion) | U-E2-05 |
| F-CORE-043 | Queued-prompt dismissal and steer labels | `k/session/prompt-queue.ts`, `packages/tui/src/kilocode/steer*.ts` | POST (steer) | Inbox steer/queue (cancel/change between queue and steer) | partial | U-E2-06 |
| F-CORE-044 | Bounded session title generation | `k/session/title.ts` | POST | Hidden title agent | native (UNVERIFIED bound) | U-E2-06 |
| F-CORE-045 | Processing hardening (diagnostics, undecodable images, continuation, tool-input repair, output-token cap) | `k/session/*` | Δ (~128 fixes) | Tool-input repair, continuation exist | partial | U-E2-06 |
| F-CORE-046 | Session transcript recall search | `k/session/recall-search.ts` | Δ | none | needs-port | U-E2-11 |
| F-CORE-047 | Per-session soft maximum-cost alert | `k/cli/cmd/tui/cost-alert.ts` | pre | none | needs-port | U-E9-08 |

### A07 Session portability and import

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-048 | Background session export/ingest to Kilo cloud (scrubbed, zstd) | `k/session-export/**`, `src/kilo-sessions/ingest-*` | pre | none | needs-port | U-E5-06 |
| F-CORE-049 | Cloud session list/import, `--cloud-fork` | `k/cloud-session.ts`, `kilo-gateway/src/cloud-sessions.ts` | Δ (#13483, #12388) | none | needs-port | U-E3-04 |
| F-CORE-050 | Session import API (project/session/message/part) | `k/session-import/*` | Δ | `/api/experimental/session/import` (v2 transfer format) | partial | U-E3-01 |
| F-CORE-051 | External transcript resume (Claude Code, Codex) and server-side migrate API | `k/session-resume/*`, migrate group | POST (#13294) | none | needs-port | U-E3-04 |
| F-CORE-052 | Cumulative diff and restore when moving sessions | `k/session-portability/*` | pre | `session.move` | partial | U-E3-05 |
| F-CORE-053 | Session fork command and routing | `k/session/fork*.ts` | pre | `session.fork` | native | U-E3-05 |
| F-CORE-054 | Legacy credential migration | `packages/core/src/kilocode/credential-migration.ts` | pre | Auth export/import (#52139) | partial | U-E3-02 |

### A08 Agents, modes, commands, skills, rules

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-055 | Kilo agents: code, ask, debug, orchestrator, plan (+ scout, experimental) | `k/agent/*` | Δ (agent requirements removed #13225) | build/plan/general/explore | partial | U-E2-12 |
| F-CORE-056 | Agent builder | `k/agent/builder.ts` | pre | none | needs-port | U-E2-12 |
| F-CORE-057 | Plan file discovery, plan→code follow-up, open plan | `k/plan-file.ts`, `k/plan-followup.ts`, `k/tool/{plan,open-plan}.ts` | Δ | Plan agent writes `~/.opencode/plan`, no `plan_exit` | needs-port (replace, not compose: `plan-v2-parity.md`) | U-E2-13 |
| F-CORE-058 | Mode reminders on agent switch | `k/session/mode-reminders.ts` | POST | Plan enter/leave reminders | partial | U-E2-12 |
| F-CORE-059 | `/review` over working tree/worktree diff | `k/review/*` | Δ (`46bd29d733`) | `/review` built-in | partial (Kilo policy) | U-E2-14 |
| F-CORE-060 | Command files list/remove, overrides, reserved names, workflow variants, command timeout | `k/command*`, `k/session/workflow-variant.ts` | POST (reserved) | Config/markdown commands | partial | U-E2-15 |
| F-CORE-061 | Skills: built-in `kilo-config`, trust, validation, remove | `k/skills/*`, `k/skill/*`, `k/skill-remove.ts` | Δ | Skills with policies, `disable-model-invocation` | partial | U-E2-15 |
| F-CORE-062 | Rules from `.kilo`/`.kilocode`, mirrored from primary worktree | `k/primary-worktree.ts`, `k/server/routes/config-rules.ts` | Δ | Instructions discovery (`.claude`, `.agents`, `.opencode`) | partial | U-E2-15 |
| F-CORE-063 | Marketplace (MCP servers, skills, modes, plugins) | `k/marketplace/*` | POST (#12714, #14510) | none | needs-port | U-E2-23 |

### A09 Tools and permissions

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-064 | Kilo tool registry and client gating (`KILO_CLIENT`) | `k/tool/registry.ts` | Δ (+2,205 in `tool/`) | `tool.transform` | partial | U-E2-16 |
| F-CORE-065 | Permission customizations (`/approve-all`, headless policy, config-path protection, provenance) | `k/permission/*` | Δ (#14051) | Native permissions and policies | partial | U-E2-17 |
| F-CORE-066 | Bash hierarchy, heredoc/unparsed handling, PowerShell | `k/bash-hierarchy.ts`, `k/tool/shell-*` | Δ | Shell tool | partial | U-E2-17 |
| F-CORE-067 | Question tool and headless handling | `k/question/*` | Δ (#13727) | Forms | partial | U-E2-16 |
| F-CORE-068 | `suggest` follow-up tool and TUI bar | `k/suggestion/*` | pre | none | needs-port | U-E2-16 |
| F-CORE-069 | TypeScript check after edits (tsgo/tsc) | `k/ts-check.ts` | Δ | No LSP diagnostics | needs-port | U-E2-16 |
| F-CORE-070 | Exa web search via Kilo gateway (flag-gated) | `k/tool/websearch-kilo-exa.ts` | pre | Exa websearch provider | post-cutover (experimental flag) | U-E11-05 |
| F-CORE-071 | Rich document read (docx, xlsx, ods, pdf) | `k/tool/read-*` | pre | none | needs-port | U-E2-16 |
| F-CORE-072 | Chart tool (VS Code only) | `k/tool/chart.ts` | pre | none | needs-port | U-E6-11 |
| F-CORE-073 | Model search/selection tools (task model selection) | `k/tool/model-*` | POST (#13557, #14533) | Subagent model choice | partial | U-E2-16 |
| F-CORE-074 | Repo overview tool, fff/ripgrep backends | `k/tool/repo-overview.ts` | pre | grep/glob | partial | U-E2-16 |
| F-CORE-075 | Context tools (`context_info`, self-compact) | `k/tool/context.ts` | POST, `KILO_EXPERIMENTAL_CONTEXT_TOOLS` off | none | post-cutover | U-E11-05 |
| F-CORE-076 | Code mode / Programmatic Tool Calling | `k/tool/code-mode.ts` | POST, `experimental.code_mode` off | `packages/codemode` (native) | post-cutover (native mechanism exists) | U-E11-05 |
| F-CORE-077 | Browser open tool (IDE browser broker) | `k/tool/browser-open.ts` | POST | none | needs-port | U-E6-11 |
| F-CORE-078 | Encoding-preserving I/O | `k/encoding.ts`, `k/tool/encoded-io.ts` | pre | BOM utilities | partial | U-E2-16 |
| F-CORE-079 | Todo status transitions for clients | `k/todo-view.ts` | Δ | No todo tool | needs-port | U-E2-16 |

### A10–A13 Engines

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-080 | Kilo memory (per-project markdown memory, recall/save tools, `/memory`) | `packages/kilo-memory/**`, `k/memory/*` | Δ small (`memory_model` #14781, SSE fix #13122) | none | needs-port | U-E2-18 |
| F-CORE-081 | Codebase indexing (worker, 10 embedders, LanceDB/Qdrant, `semantic_search`) | `packages/kilo-indexing/**`, `k/indexing*` | Δ (embedder fixes, root safeguards, `@parcel/watcher` #12784) | none | needs-port | U-E2-19 |
| F-CORE-082 | Sandbox (bwrap/seatbelt, network relay, git classifier, per-session lifecycle) | `packages/kilo-sandbox/**`, `k/sandbox/*` | Δ (git classifier #14222) | Workspace/environment driver seam only | needs-port. Opt-in top-level `sandbox.enabled` (default false, `k/sandbox/config.ts`), **not** an experimental flag | U-E2-20 |
| F-CORE-083 | Telemetry (PostHog events, consent) | `packages/kilo-telemetry/**` | Δ small (#14638) | OTLP only, PostHog removed | needs-port (privacy decision in `telemetry-v2-overlap.md`) | U-E2-21 |

### A14 MCP and plugins

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-084 | MCP: machine-wide OAuth callback handoff, issuer discovery, auth-failure surfacing, SSE probe, jsonc-preserving `kilo mcp` | `k/mcp/*`, `k/mcp-oauth-callback.ts` | POST (#14724) | MCP OAuth with AS metadata, `mcp auth` | partial (gap narrowed at BASE) | U-E2-22 |
| F-CORE-085 | MCP Apps (UI resources) | `k/mcp/apps.ts` | POST, `KILO_EXPERIMENTAL_MCP_APPS` off | none | post-cutover | U-E11-05 |
| F-CORE-086 | `git:` plugin sources | `k/plugin/git-source.ts` | POST | plugin add/check/update | partial | U-E2-22 |

### A15 Agent coordination, worktrees, processes, notebook

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-087 | Agent Manager host contract (ask/reply/reject, protection) | `k/agent-manager/*` | Δ | none | needs-port | U-E2-27 |
| F-CORE-088a | Worktree runtime: family detection, teardown, `.kilo/worktrees` | `k/worktree-*.ts`, `k/git-refs.ts` | Δ | Project worktrees in `<data>/worktree/<proj>` | partial | U-E2-26 |
| F-CORE-088b | `kilo worktree create/list/remove`, `--worktree` | `k/cli/cmd/{worktree,tui-worktree}.ts` | POST (#12809) | none | needs-port | U-E9-02 |
| F-CORE-089 | Background process tool, sidebar, `/process` | `k/background-process/*` | Δ | Persistent PTY only | needs-port | U-E2-25 |
| F-CORE-090 | Shared agent board (flag default **on**) | `k/board/*`, core migrations `kilocode_board*` | POST (#13629, #14134) | none | needs-port (default-on, see Decision 7 note) | U-E2-24 |
| F-CORE-091 | Native notebook host (VS Code) | `k/notebook/*` | Δ, `experimental.native_notebook_tools` off | none | post-cutover (experimental) | U-E11-05 |

### A16 Remote · A17 Sharing

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-092 | Remote session relay (`kilo remote`, `/remote`, commands, attachments, exit) | `src/kilo-sessions/*`, `k/remote-tui.tsx` | Δ (#13496, #13497, #13565, #14214) | Device pairing + OpenTunnel (different model) | needs-port | U-E4-01 |
| F-CORE-093 | Viewer presence over event service | `k/presence/*`, `kilo-gateway/src/event-service/client.ts` | Δ (client moved) | none | needs-port | U-E4-06 |
| F-CORE-094 | Remote tools `notify_user`, `send_file` | `k/tool/{notify-user,send-file}.ts` | pre | none | needs-port | U-E4-02 |
| F-CORE-095 | PR linking (GitHub, GitLab, Bitbucket), poller, sidebar | `src/kilo-sessions/pr-link*`, `k/tool/link-pr.ts` | POST (#13137, #14195) | none | needs-port | U-E4-07 |
| F-CORE-096 | Headless docs/login link dialog | `…/dialog-headless-link.tsx` | pre | Pairing QR links (different purpose) | needs-port | U-E4-05 |
| F-CORE-097 | Kilo share transport (share/unshare/fork) | shared `src/share/*` (markers) | pre (EMPTY delta) | none | needs-port | U-E5-01 |

### A18 CLI · A19 TUI

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-098 | Kilo command set (`cloud`, `roll-call`, `profile`, `remote`, `daemon`, `config check`, `worktree`, `help --all`, `completion`), removed upstream `web`, generated CLI docs | `src/index.ts`, `k/commands.ts`, `k/help*.ts`, `k/generate-cli-docs.ts` | Δ | Upstream command set | partial | U-E9-02 |
| F-CORE-099 | `kilo run` customizations (variant, auto, drain, stdin) | `k/cli/cmd/run*.ts` | Δ | `opencode run` json/default, v1 flag bridge | partial | U-E9-03 |
| F-CORE-100 | ACP permission mapping | `k/acp/permission.ts` | pre | ACP permissions/elicitation | partial | U-E9-04 |
| F-CORE-101 | Terminal title/icon/activity (OSC), worker thread, VT screen | `k/cli/cmd/tui/*` | POST (activity) | Upstream TUI | partial | U-E9-05 |
| F-CORE-102 | Kilo slash commands and dialogs (`/about`, `/profile`, `/teams`, `/usage`, `/indexing`, `/privacy`, `/remote`, `/memory`, `/process`, `/sandbox`, `/caffeinate`, `/reload`, `/approve-all`) | `k/kilo-commands.tsx`, `kilo-gateway/src/tui*.ts` | Δ | Slots and command palette | partial (each command lands with its feature unit; registry here) | U-E9-06 |
| F-CORE-103 | Home/sidebar plugins: onboarding, tips, footer, usage and balance rows | `k/plugins/{home-*,sidebar-*}.tsx` | pre | `home.footer`, `sidebar.content`, `sidebar.footer` slots | partial | U-E9-07 |
| F-CORE-104 | Session/workspace switcher dialog | `k/plugins/session-switcher/*` | pre, `KILO_EXPERIMENTAL_SESSION_SWITCHER` off | Session tabs | post-cutover (experimental) | U-E11-05 |
| F-CORE-105 | v2 sync and session-v2 debug view | `k/plugins/{sync-v2,session-v2-debug}.tsx` | pre | Native v2 TUI | not-needed (debug); location filtering verified in U-E9-11 | U-E9-11 |
| F-CORE-106 | Vim prompt mode (`/vim`) | `…/prompt/vim.ts` | pre | none | post-cutover (legacy TUI extra; #14378 bindings part) | U-E11-04 |
| F-CORE-107 | Completion/abort/timeout notifications and sound | `k/plugins/attention.ts` | pre | Notifications and sound toggles | partial | U-E9-09 |
| F-CORE-108a | Kilo default theme and logo | `packages/tui/src/theme/assets/kilo.json`, logo | pre | Theme files; donor `theme/src/tui/defaults.ts`, `fallback.ts` deleted at BASE | partial | U-E1-01 |
| F-CORE-108b | Legacy `kilo-v1` and colorblind theme catalogue | `…/assets/kilo-v1.json` | pre | none | post-cutover (#14376) | U-E11-04 |
| F-CORE-109a | Clickable links, @session mentions, double-press guards, notices | `packages/tui/src/kilocode/*` | POST (3 files) | partial | partial | U-E9-10 |
| F-CORE-109b | Legacy keybindings and diff theme | `k/tui/{keybinds,diff}.ts` | pre | Configurable keybinds | post-cutover (#14378 bindings) | U-E11-04 |
| F-CORE-110 | Display preferences (tool/reasoning collapse) and privacy-mode redaction | config keys, `k/pii.ts` | pre | Low-verbosity summaries | partial | U-E9-12 |

### A20 Cloud · A21 Packaging, release, CI

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-111 | `kilo cloud start/send/status/result`, stdin prompts, stream tickets | `k/cli/cmd/cloud*.ts`, `k/cloud/*` | Δ small (#13851) | none | needs-port | U-E9-13 |
| F-CORE-112 | Updater and install-method detection | `k/installation/*` | POST (`latest.ts`) | Updater with opencode literals (`updater.ts:145-198`) | partial | U-E3-06 |
| F-CORE-113 | Build and release pipeline (multi-platform, VSIX bundling, npm/GHCR/AUR/Homebrew/nix/Zed, Windows signing, bundled bwrap, SBOMs, PTY smoke) | `.github/workflows/{publish,beta,smoke-test,…}.yml`, `packages/opencode/script/*`, `script/*` | Δ (SBOM #14513, Windows AVX2 launcher) | Upstream publish pipeline bound to `anomalyco/opencode` | partial | U-E3-07 |
| F-CORE-114 | CI and repository guards (forbidden strings, generated artifacts, annotations, md tables, CodeQL, test sharding, triage bots) | `.github/workflows/*`, `script/check-*.ts` | Δ (47 workflow files +4,888) | Upstream `check.yml`, `test.yml` | partial | U-E3-08 |
| F-CORE-115 | Upstream merge tooling with Kilo transforms | `script/upstream/**` | Δ | none | partial (re-derive for the v2 line) | U-L1-01 |

### A24 Editor services (runtime side) · A26–A28

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-116 | Enhance-prompt, commit-message, branch-name generation endpoints | `k/enhance-prompt.ts`, `k/commit-message/*`, `k/branch-name.ts` | Δ small (#13108) | `generate` protocol group (UNVERIFIED equivalence) | partial | U-E2-28 |
| F-CORE-117 | FIM and next-edit via gateway (`/kilo/fim`, `/kilo/edit`) | `kilo-gateway/src/{fim,edit,autocomplete,mistral-fim-endpoint}.ts` | pre | none | needs-port (hard gate) | U-E6-08 |
| F-CORE-118 | Anaconda Desktop provider (discover local AI Navigator, WorkOS OAuth, TUI setup) | `k/anaconda-desktop/*` | pre (EMPTY delta) | none | needs-port (gate set by consumer) | U-E10-02 |
| F-CORE-119 | Atomic Chat local provider plugin | `packages/plugin-atomic-chat/**` | pre (EMPTY) | Plugin provider API | needs-port | U-E2-29 |
| F-CORE-120 | Speech-to-text transcription | `/kilo/audioTranscriptions`, `experimental.speech_to_text_*` | pre | `@opencode/ai` transcription client (mechanism) | post-cutover | U-E11-01 |
| F-CORE-121 | Image generation tool | `k/tool/generate-image.ts`, `experimental.image_generation` | pre | `@opencode/ai` image client (mechanism) | post-cutover | U-E11-02 |
| F-CORE-122 | KiloClaw | removed on V1 in `3eaf47ba52` (#14209, 2026-09-16) | removed | — | not-needed | U-E11-06 |

### A29 Web properties · A30 SDK · A31 Legacy · A32 Security

| ID | Feature | Paths (V1) | Snap | BASE | Delta | Unit |
|---|---|---|---|---|---|---|
| F-CORE-123 | `kilo console` local settings web app (deprecated) | `packages/kilo-console/**` | Δ small | Upstream settings dialog and web app | not-needed (deprecated on V1; obsolete per old plan) | U-E8-03 |
| F-CORE-124 | kilo.ai/docs site incl. generated CLI reference | `packages/kilo-docs/**` (978 files) | Δ (content) | none (upstream docs are opencode's) | partial (content must describe v2; site must survive the branch flip) | U-L5-01 |
| F-CORE-125 | `kilo-web-ui` embedded web components | `packages/kilo-web-ui/**` | Δ | Upstream `packages/app` served by the service | partial (decide: adopt upstream app or keep Kilo UI) | U-E9-14 |
| F-CORE-126 | Published `@kilocode/sdk` and `@kilocode/plugin` | `packages/sdk/js`, `packages/plugin` | Δ (regen) | `@opencode/sdk`, `@opencode/plugin` | partial (publish under Kilo names; regenerate) | U-E3-09 |
| F-CORE-127 | Legacy Kilo Code migrators (modes, `.kilocoderules`, workflows, MCP settings, `.kilocodeignore`) | `k/config-injector.ts`, `k/*-migrator.ts` | pre | none | needs-port | U-E3-03 |
| F-CORE-128 | Claude Code settings migration | `k/config/claude-migration.ts` | POST, `KILO_EXPERIMENTAL_CLAUDE_MIGRATION` off (VS Code passes a setting) | `.claude` discovery for skills/instructions | post-cutover (experimental) | U-E11-05 |
| F-CORE-129 | PII redaction, GitHub attachment URL validation, forbidden-strings CI | `k/pii.ts`, `k/security/github.ts` | pre | Managed policy, file access | partial | U-E9-12 |

### Shared-file customizations outside the assessment

At V1, 892 non-IDE files carry `kilocode_change`, and 159 of them are absent from the 816-file TSV (added or first marked after SNAP). Hotspots: `packages/core/src/database` migrations (board, model-usage index), `packages/opencode/src/{server,cli,tool,plugin,project,mcp}`, `packages/llm/src/protocols`, `packages/schema/src/{worktree-event,revert,mcp-event,event-manifest}.ts`, `packages/core/src/{repository-cache,location-services}.ts`, and `packages/tui/src/{util,ui,feature-plugins,component}`. The features behind them are covered by the POST rows above. The file-level disposition belongs to the first L2 sweep (U-L2-01).

### Removed between SNAP and V1 (do not port)

| Path at SNAP | Commit | Note |
|---|---|---|
| `k/claw/*` | `3eaf47ba52` (#14209) | KiloClaw (F-CORE-122) |
| `k/interactive-terminal/*` | `b5cf426158` (#13793) | Non-functional interactive terminal tool |
| `k/swe-pruner.ts` | `e1bcb320d9` | Experimental output pruning |
| `k/agent-requirements.ts` | `da10638654` (#13225) | Agent requirements |
| `kilo-vscode/src/legacy-migration` | `25d9448d63` (#13605) | Kilo-classic VS Code migration (−2,011 lines); session migration moved server-side (#13294) |

## Part 3. Kilo v1 customizations: IDE clients

Source: direct read of V1 (`fb7e96ed`), written by the analyst after the delegated clients inventory stalled. Inputs: `packages/kilo-vscode/package.json` (`kilo-code` 7.8.8: 73 commands, one activity-bar view, 40 settings), the extension's SDK call sites (about 120 distinct client methods), `packages/kilo-vscode/src/**`, and `packages/kilo-jetbrains/**` (1,236 files). It is less exhaustive than Part 2. Rows group commands and settings by feature, and per-command detail is UNVERIFIED beyond the cited paths. `kv/` = `packages/kilo-vscode/src/`, `kw/` = `packages/kilo-vscode/webview-ui/src/`, `jb/` = `packages/kilo-jetbrains/`.

### How each client reaches the CLI at V1

| Client | Binary | Contract | Evidence |
|---|---|---|---|
| VS Code | Bundles `bin/kilo`, built from `packages/opencode` **in the same checkout** (`script/local-bin.ts`, `prepare:cli-binary`). Also bundles bwrap, ffmpeg, tree-sitter and sandbox-worker resources | Generated `@kilocode/sdk/v2` client over HTTP/SSE, started by `kv/services/cli-backend/server-manager.ts`. Calls Kilo-specific routes (`kilo.*`, `kilocode.*`, `remote.*`, `network.*`, `suggestion.*`, `commitMessage.*`, `branchName.*`, `anacondaDesktop.*`), core routes (`session.*` incl. `session.deleteMessage`, `permission.*`, `question.*`, `mcp.*`, `pty.*`/`v2.pty.*`, `config.overlay*`, `provider.oauth.*`, `experimental.capabilities.get`, `experimental.controlPlane.moveSession`) | `kv/services/cli-backend/*`, `kv/features.ts` |
| JetBrains | Pins the CLI release named in `jb/package.json` (`version` 7.8.8). `kilo.cli.pinned=false` is dev-only and refused for production builds (`jb/build.gradle.kts:89-98`). Plugin version 7.1.9 on its own `jetbrains/v*` tag line | Split-mode plugin (backend/frontend/shared modules). Kotlin client generated from the CLI's OpenAPI spec (`jb/backend/build.gradle.kts:11-21,64,129`, `generateOpenApiSpec`, `normalizeOpenApiSpec`) | `jb/gradle.properties`, `jb/build.gradle.kts` |

**Consequence for the branch flip (U-E8-01).** The VS Code v1 build compiles its bundled CLI from `packages/opencode` in the same tree. Once `kilo-v2-clean` becomes `main`, a v1 extension cannot be built from `main`. Either the flip waits until after G2 and G3, or v1 IDE releases build from the `v1` branch.

### VS Code (A22, A23, A24 and runtime consumers)

| ID | Feature | Paths (V1) | Flag | Snap | Delta | Unit |
|---|---|---|---|---|---|---|
| F-VSC-001 | Extension host, activation, webview HTML, sidebar view, reload, heap snapshot | `kv/extension.ts`, `kv/KiloProvider.ts`, `kv/kilo-provider/*` | — | Δ | needs-port | U-E6-01 |
| F-VSC-002 | Webview UI app and shared components (`kilo-ui`, `kilo-i18n`) | `kw/**` (661 files), `packages/kilo-ui`, `packages/kilo-i18n` | — | Δ | needs-port | U-E6-01 |
| F-VSC-003 | Server manager, connection, retry, SSE adapter, explicit abort, bundled CLI resources | `kv/services/cli-backend/*` | — | Δ | needs-port | U-E6-02 |
| F-VSC-004 | Server capability probe (`experimental.capabilities.get`) and feature gating | `kv/features.ts` | — | Δ | partial (basis for the v2 handshake) | U-E6-02 |
| F-VSC-005 | Sidebar chat: new task, close, history, focus input, chat search, agent-mode cycling, auto-approve toggle | commands `kilo-code.new.{plusButtonClicked,closeTask,closeAllTasks,historyButtonClicked,focusChatInput,toggleChatSearch,cycleAgentMode,toggleAutoApprove}` | — | Δ | needs-port | U-E6-03 |
| F-VSC-006 | Open session in editor tab, independent panel routing | `kilo-code.new.openInTab` | — | Δ | needs-port | U-E6-04 |
| F-VSC-007 | Settings editor webview and settings search | `kv/SettingsEditorProvider.ts`, `kilo-code.new.settings*` | — | Δ | needs-port | U-E6-05 |
| F-VSC-008 | Profile, organization, auth, provider OAuth, provider usage | `kw/components/profile`, `kilo.profile`, `kilo.organization.set`, `provider.oauth.*`, `kilocode.providerUsage.*` | — | Δ | needs-port | U-E6-06 |
| F-VSC-009 | Commit message generation (SCM) | `kv/services/commit-message`, `commitMessage.generate`, setting `languageCommitMessage` | — | Δ small | needs-port | U-E6-07 |
| F-VSC-010 | Enhance prompt, branch naming for worktrees | `kv/enhance-prompt-error.ts`, `branchName.generate`, setting `agentManager.autoBranchNaming` | — | Δ small | needs-port | U-E6-07 |
| F-VSC-011 | Code actions: explain, fix, improve, add to context; terminal add/fix/explain; generate terminal command | `kv/services/code-actions`, `kilo-code.new.{explainCode,fixCode,improveCode,addToContext,terminal*,generateTerminalCommand}` | — | Δ small | needs-port | U-E6-07 |
| F-VSC-012 | Autocomplete (FIM) and next-edit, chat autocomplete, model/provider selection | `kv/services/autocomplete`, `kilo.fim`, `kilo.edit`, `kilo-code.new.autocomplete.*`, settings `autocomplete.*` | — | Δ small | needs-port (hard gate) | U-E6-08 |
| F-VSC-013 | Terminal integration and PTY tickets | `kv/services/terminal`, `pty.*`, `v2.pty.*` | — | Δ | needs-port | U-E6-09 |
| F-VSC-014 | Agent Manager: worktrees (new, quick, advanced, pool, update from base, close), sessions, tabs, terminals, run script, diff, PR, shortcuts, diagnostics, browser previews | `kv/agent-manager/**` (136 files), `kilo-code.new.agentManager.*`, settings `agentManager.*` | — | Δ (+55k lines in A15) | needs-port | U-E6-10 |
| F-VSC-015 | Browser tab and open-in-browser broker; image preview; document viewer; sub-agent viewer; diff virtual provider; show changes | `kv/browser-tab`, `kv/image-preview.ts`, `kv/DocumentViewerProvider.ts`, `kv/SubAgentViewerProvider.ts`, `kv/DiffVirtualProvider.ts`, `kilo-code.new.{openBrowser,showChanges}` | — | Δ | needs-port | U-E6-11 |
| F-VSC-016 | Notifications and suggestions (`kilo.notifications`, `suggestion.list/accept/dismiss`) | `kv/services/attention`, webview chat | — | Δ | needs-port | U-E6-12 |
| F-VSC-017 | Marketplace panel; agent, skill and MCP removal; MCP OAuth sign-in | `kv/MarketplacePanelProvider.ts`, `kv/services/{marketplace,agent-removal.ts,mcp-removal.ts,mcp-auth}` | — | Δ | needs-port | U-E6-13 |
| F-VSC-018 | Task timeline, token throughput, diff rendering style | settings `showTaskTimeline`, `showTokenThroughput`, `diff.*` | — | Δ | needs-port | U-E6-14 |
| F-VSC-019 | Remote status and enable/disable; presence visibility | `kv/services/RemoteStatusService.ts`, `remote.*` | — | Δ | needs-port | U-E6-15 |
| F-VSC-020 | Memory show/toggle, indexing consent and controls, sandbox preference, network ask/reply, caffeination toggle, attention settings, telemetry | `kilo-code.new.{showMemory,toggleMemory,toggleCaffeination}`, `kv/indexing-consent.ts`, `kv/services/{sandbox-preference.ts,caffeination,telemetry}`, `network.*` | — | Δ | needs-port | U-E6-16 |
| F-VSC-021 | Kilo-classic task/session migration and Roo import | `kv/legacy-migration/sessions/*`, `kv/roo-import/service.ts`, `kilocode.sessionImport.*`, `kw/components/migration` | — | Δ (settings migration removed #13605) | needs-port | U-E6-17 |
| F-VSC-022 | Session extras: board, background jobs (promote/cancel), wakeups, retention, model usage, snapshot prepare/remove, session move, cloud session import | `kilocode.{sessionBoard,backgroundJob*,wakeups,retention.*,sessionModelUsage,snapshot.prepare,removeSnapshot}`, `experimental.controlPlane.moveSession`, `kilo.cloudSessions`, `kilo.cloud.session.*` | — | NEW for most | needs-port | U-E6-18 |
| F-VSC-023 | Message deletion caller | `session.deleteMessage` | — | Δ | needs-port (consumer of U-E2-05) | U-E6-03 |
| F-VSC-024 | Max cost, auto-approve reason, shortcut hints, font size, language, extra CA certs, model default | settings `maxCost`, `showAutoApprovalReason`, `showShortcutHints`, `fontSize`, `language`, `extraCaCerts`, `model.*` | — | Δ | needs-port | U-E6-05 |
| F-VSC-025 | Notebook host (native notebook tools) | `kv/services/notebook`, `kilocode.notebook.*` | `experimental.native_notebook_tools` | Δ | post-cutover | U-E11-05 |
| F-VSC-026 | Browser automation | `kv/services/browser-automation`, settings `browserAutomation.*` | `experimental.browserAutomation` | Δ | post-cutover | U-E11-05 |
| F-VSC-027 | Claude Code compatibility and migration | settings `claudeCodeCompat`, `experimental.claudeMigration` | experimental | POST | post-cutover | U-E11-05 |
| F-VSC-028 | Conversation prompt history | setting `experimental.conversationPromptHistory` | experimental | POST | post-cutover | U-E11-05 |
| F-VSC-029 | Speech-to-text capture | `kv/speech-to-text`, `kw/components/speech-to-text` | `speechToText` feature (off in remote windows) | Δ small | post-cutover | U-E11-01 |
| F-VSC-030 | Image generation | `kv/image-generation` | `experimental.image_generation` | pre | post-cutover | U-E11-02 |
| F-VSC-031 | Anaconda Desktop bridge (`anacondaDesktop.status/open/sync`) | `kv/anaconda-desktop/bridge.ts` | — | pre | needs-port (gate set by consumer) | U-E10-02 |
| F-VSC-032 | VSIX packaging and Marketplace/Open VSX publishing | `packages/kilo-vscode/script/*`, `vscode-packaging.md` | — | Δ | needs-port | U-E6-19 |

### JetBrains (A25)

| ID | Feature | Paths (V1) | Snap | Delta | Unit |
|---|---|---|---|---|---|
| F-JB-001 | Plugin shell: split-mode backend/frontend/shared, plugin.xml, actions, tool window, onboarding | `jb/src/main/resources/META-INF/plugin.xml`, `jb/frontend/.../client/{app,actions,plugin,ui}` | Δ | needs-port | U-E7-02 |
| F-JB-002 | CLI pinning, release line, Gradle build, generated OpenAPI client | `jb/build.gradle.kts`, `jb/backend/build.gradle.kts`, `jb/package.json` | Δ | needs-port | U-E7-02 |
| F-JB-003 | Backend CLI lifecycle: start, discovery, workspace, run, provider, dev isolation | `jb/backend/.../backend/{cli,workspace,run,provider,app,dev}` | Δ | needs-port | U-E7-02 |
| F-JB-004 | Sessions: history, model, settings, background, subagents, board, context, scrolling views | `jb/frontend/.../client/session/*` | Δ (swarm board, session cleanup, prompt navigator) | needs-port | U-E7-03 |
| F-JB-005 | Prompt completion (mentions/commands in the prompt, not FIM) | `jb/frontend/.../session/ui/prompt/KiloPromptCompletionProvider.kt` | Δ | needs-port | U-E7-03 |
| F-JB-006 | Settings UI, MCP OAuth, checkpoint settings | `jb/frontend/.../client/settings` | Δ | needs-port | U-E7-03 |
| F-JB-007 | Diff viewer and VFS integration | `jb/frontend/.../client/{diff,vfs}`, `jb/backend/.../diff` | Δ | needs-port | U-E7-04 |
| F-JB-008 | Agent Manager, worktrees, marketplace | `jb/frontend/.../client/agentManager`, `jb/backend/.../{worktree,marketplace}` | Δ | needs-port | U-E7-05 |
| F-JB-009 | Legacy plugin (v5) migration incl. autocomplete **settings** only | `jb/backend/.../migration/*`, `jb/frontend/.../onboarding/providers/v5migration/*`, `jb/frontend/.../autocomplete/KiloAutocompleteSettingsService.kt` | Δ | needs-port | U-E7-05 |
| F-JB-010 | Telemetry | `jb/frontend/.../client/telemetry`, `jb/backend/.../telemetry` | Δ | needs-port | U-E7-03 |
| F-JB-011 | Enhance prompt and branch name consumers (per `editor-services-inventory.md`) | UNVERIFIED paths | Δ | needs-port | U-E7-04 |

**FIM at V1 JetBrains.** No FIM or next-edit producer or consumer exists in `packages/kilo-jetbrains` at V1. The only `autocomplete` hits are a settings holder (`KiloAutocompleteSettingsService.kt`, persisting `enableAutoTrigger`, `enableSmartInlineTaskKeybinding`, `enableChatAutocomplete` migrated from the legacy plugin), the migration engine (`LegacyMigrationEngine.kt:84,349-353`) and a CHANGELOG line about the VS Code change #13655. This matches `technical-notes/baseline/editor-services-inventory.md`. Decision 7 makes FIM a hard G3 gate even though JetBrains v1 has no FIM. Deferred as Q-G3-01 in `v2-unit-register.md`.

## Part 4. Upstream v2 features without a Kilo v1 counterpart

Each needs a product disposition, so it maps to a unit even when no port is needed.

| ID | Feature | Paths (BASE) | Disposition | Unit |
|---|---|---|---|---|
| F-V2-001 | Global paths (`app="opencode"`) | `util/src/global.ts` | Rename via a counted patch | U-E1-01 |
| F-V2-002 | App identity (`App.Info`, UA, `x-opencode-client`) | `core/src/app.ts`, `server/src/options.ts` | Configure; UA prefix needs a patch | U-E1-01 |
| F-V2-003 | DB location (`opencode.db`, channel DBs) | `cli/src/database-path.ts` | Kilo v2 store (D6) | U-E1-02 |
| F-V2-004 | Binary and launcher (`opencode`, `opencode2`) | `cli/script/build.ts:16` | Rename; channel naming open (see register) | U-E3-12 |
| F-V2-005 | Config discovery and folding | `core/src/config/discovery.ts` | Add `.kilo`/`kilo.json` | U-E1-07 |
| F-V2-006 | opencode v1 config migration | `core/src/v1/config/*` | Reuse decoder for the Kilo importer | U-E3-03 |
| F-V2-007 | Managed policy | `core/src/managed-policy.ts` | Inherit | U-E1-07 |
| F-V2-008 | Session core (inbox, runner, coordinator) | `core/src/session/*` | Inherit, verify | U-E2-06 |
| F-V2-009 | Retry policy | `session/runner/retry.ts` | Extend for offline wait | U-E2-01 |
| F-V2-010 | Compaction and overflow | `session/compaction.ts` | Add Kilo thresholds | U-E2-02 |
| F-V2-011 | Snapshots and revert | `core/src/snapshot.ts` | Add Kilo policy | U-E2-04 |
| F-V2-012 | Restart recovery | `session/execution/restart.ts` | Inherit; covers part of task resume | U-E2-07 |
| F-V2-013 | Fork, move, background | protocol `session.*` | Inherit | U-E3-05 |
| F-V2-014 | Session export/import (v2 transfer) | `core/src/session/transfer.ts` | Inherit | U-E3-05 |
| F-V2-015 | opencode v1→v2 migration (in place, destructive, bun only) | `core/src/database/v1-migration.bun.ts` | Reuse pure transforms only; never point at `kilo.db` | U-E3-01 |
| F-V2-016 | TUI v1 config/theme migrate | `tui/src/config/v1` | Inherit; check against Kilo TUI config | U-E3-03 |
| F-V2-017 | Auth export/import, multi-credential | `core/src/credential*` | Host Kilo gateway credentials | U-E1-03 |
| F-V2-018 | Integrations (key/OAuth/command/external) | `core/src/integration*` | Host Kilo login | U-E1-03 |
| F-V2-019 | Providers, `@opencode/ai` | `core/src/plugin/provider/*` | Inherit; override `kilo.ts` branding | U-E1-04 |
| F-V2-020 | models.dev catalog | `core/src/models-dev.ts` | Swap source or merge gateway catalog | U-E1-04 |
| F-V2-021 | System prompts, identity, verbosity | `plugin/system-prompt/*` | Re-seat Kilo selectors | U-E1-05 |
| F-V2-022 | Agents | `core/src/plugin/agent.ts` | Transform to Kilo agents | U-E2-12 |
| F-V2-023 | Plan mode | `core/src/plugin/plan.ts` | Replace with Kilo plan workflow | U-E2-13 |
| F-V2-024 | Commands (`/init`, `/review`) | `core/src/plugin/command.ts` | Inherit plus Kilo policy | U-E2-14 |
| F-V2-025 | Skills | `core/src/skill*` | Inherit plus Kilo trust | U-E2-15 |
| F-V2-026 | Instructions discovery | `core/src/instructions/*` | Add Kilo rules dirs | U-E2-15 |
| F-V2-027 | Tools | `core/src/tool/plugin/*` | Inherit plus Kilo tools | U-E2-16 |
| F-V2-028 | Permissions | `core/src/permission*` | Inherit plus Kilo policy | U-E2-17 |
| F-V2-029 | Forms | `core/src/form.ts` | Host question tool | U-E2-16 |
| F-V2-030 | Websearch providers | `plugin/websearch/*` | Inherit | U-E2-16 |
| F-V2-031 | MCP | `core/src/mcp/*` | Inherit plus Kilo deltas | U-E2-22 |
| F-V2-032 | Worktrees | `core/src/worktree/*` | Inherit plus Kilo layout | U-E2-26 |
| F-V2-033 | Background subagents | `tool/plugin/subagent.ts` | Inherit | U-E2-07 |
| F-V2-034 | Persistent PTY/terminals | `core/src/persistent-pty*` | Inherit; host for background processes and IDE terminals | U-E2-25 |
| F-V2-035 | Background service | `client/src/service*`, `cli/src/services/*` | Inherit, Kilo service command and file | U-E9-01 |
| F-V2-036 | Server/HttpApi and plugin RPC | `protocol/src/groups/*` | Primary seam for Kilo endpoints | U-E1-08 |
| F-V2-037 | Device pairing and OpenTunnel remote access | `server/src/pairing.ts`, `cli/services/remote-tunnel.ts` | Decide coexistence with Kilo relay | U-E4-05 |
| F-V2-038 | Workspace/environment drivers | `core/src/workspace/driver.ts`, `core/src/environment/*` | Seam for sandbox | U-E2-20 |
| F-V2-039 | Headless run | `cli/src/run/*` | Inherit plus Kilo flags | U-E9-03 |
| F-V2-040 | ACP | `cli/src/acp/*` | Inherit | U-E9-04 |
| F-V2-041 | Misc CLI (api, models, stats, debug, plugin, mini, upgrade, uninstall) | `cli/src/commands/*` | Inherit, brand | U-E9-02 |
| F-V2-042 | TUI (tabs, diff viewer, dialogs, slots) | `packages/tui` | Inherit, Kilo plugins via slots | U-E9-05 |
| F-V2-043 | Themes and semantic tokens | `packages/theme` | Kilo default theme | U-E1-01 |
| F-V2-044 | Notifications and sound | `tui/feature-plugins/system/notifications.ts` | Kilo attention policy | U-E9-09 |
| F-V2-045 | Keybinds | `tui/src/config/keybind.ts` | Inherit | U-E9-10 |
| F-V2-046 | Updater | `cli/src/services/updater*.ts` | Rebrand | U-E3-06 |
| F-V2-047 | Observability (OTLP) | `util/src/observability*` | Coexists with Kilo telemetry | U-E2-21 |
| F-V2-048 | Code Mode | `packages/codemode` | Underlies post-cutover PTC | U-E11-05 |
| F-V2-049 | Electron desktop and web app, GUI extensions | `packages/desktop`, `packages/app`, `gui-extensions` | No Kilo v1 counterpart: ship, hide or defer | U-E9-15 |
| F-V2-050 | SDK, client, plugin APIs | `packages/{sdk,client,plugin}` | Primary composition seam | U-E0-02 |
| F-V2-051 | `@opencode/ai` media clients | `packages/ai/src/{image,speech,transcription,video}*` | Mechanism for post-cutover voice/image | U-E11-01 |
| F-V2-052 | VCS (git, Mercurial) | `plugin/vcs/*` | Inherit | U-E2-26 |
| F-V2-053 | Stats | `cli stats`, TUI stats | Inherit | U-E9-02 |
| F-V2-054 | Simulation, http-recorder | `packages/simulation`, `http-recorder` | Test infrastructure for acceptance | U-L4-01 |
| F-V2-055 | Hosted web properties (web, console, enterprise, function, stats, posts, storybook) | `packages/{web,console,…}` | Not applicable to Kilo; keep inert, never deploy from the fork | U-E0-04 |
| F-V2-056 | CI container images | `packages/containers` | Inherit or ignore (not a sandbox) | U-E0-04 |
| F-V2-057 | `sdks/vscode` thin launcher, `publish-vscode.yml` | `sdks/vscode` | Not a Kilo extension; must not publish from the fork | U-E0-04 |
| F-V2-058 | LaTeX and mermaid rendering | `packages/latex`, `packages/merman` | Inherit | U-E9-05 |

## Native-equivalence verdict per area

Checked on scope (S), errors (E), cancellation (C), persistence (P) and presentation (Pr) at BASE. "Since donor base" says whether the verdict changed between `59b29de4` and BASE.

| Area | BASE verdict | Key evidence | Since donor base |
|---|---|---|---|
| A01 Identity/store | partial | Global layer replacement, `App.configured`, `ServerOptions.app/database/config/models`; product name hard-coded in `util/src/global.ts:12` plus ~10 direct `Global.Path` users, bins, config filenames, plan dir, updater, desktop IDs, `OPENCODE_*` env, UA | unchanged |
| A02 Daemon/server | native (mechanism) | Managed service, standalone, `--server` attach, reload, registration file, PTY handoff, reconnecting UI. Parent watchdog absent | improved, verdict unchanged |
| A03 Gateway/account | absent (mechanism present) | Integration and credential framework can host Kilo login; no org/profile/balance | unchanged |
| A04 Provider/catalog | partial | Catalog source swappable; Kilo routing, auto, pricing UI absent; `plugin/system-prompt.ts` seam deleted | **changed**: prompt-selector seam moved |
| A05 Config | partial | Folding, diagnostics, opencode-only v1 migration | unchanged |
| A06 Session policy | partial | Retry bounded (no offline wait), compaction native without Kilo thresholds, snapshots without Kilo hardening, no message deletion, no wakeups or goals | compaction hardened, verdict unchanged |
| A07 Portability/import | partial | Export/import/fork/move native; v1 migration in-place and destructive (`v1-migration.bun.ts:540-560`) | auth export/import added |
| A08 Agents/plan/skills | partial | Native agents, plan (wrong location, no `plan_exit`), review, skills | unchanged |
| A09 Tools/permissions | partial | Permissions and forms native; Kilo tools missing; no todo or LSP diagnostics | policies added |
| A10 Memory | absent | — | — |
| A11 Indexing | absent | — | — |
| A12 Sandbox | absent (seam present) | `EnvironmentDriver{spawner, files}` | unchanged |
| A13 Telemetry | partial | OTLP only | unchanged |
| A14 MCP | partial, near native | OAuth with AS metadata, CLI auth; marketplace absent | gap narrowed |
| A15 Agent coordination | partial | Worktrees, background subagents, persistent PTY native; agent manager, board, notebook, background-process tool absent | worktree API project-based |
| A16 Remote | partial (different model) | Pairing + OpenTunnel exposes the whole server; no Kilo relay or presence | pairing new |
| A17 Sharing | absent | Config key only | unchanged |
| A18 CLI/ACP | native | run json, ACP, plugin management | improved |
| A19 TUI | native mechanism | Themes, tokens, keybinds, notifications, slots; heavy churn (219 commits since donor base) | theme files deleted |
| A20 Cloud CLI | absent | — | — |
| A21 Packaging | partial | Updater and publish pipeline bound to opencode identity and repo | unchanged |
| A22 VS Code host | absent | `sdks/vscode` is a launcher | — |
| A23 Webview UI | absent | `session-ui`, `ui`, `app` are possible donors only | — |
| A24 Editor services | absent | — | — |
| A25 JetBrains | absent | — | — |
| A26 Anaconda | absent | Electron desktop + GUI extensions is not equivalent | — |
| A27 Atomic chat | absent | — | — |
| A28 Voice/image | absent (media clients only) | — | — |
| A29 Web properties | not applicable | Upstream web properties are opencode's | — |
| A30 SDK/plugin | native | In-process host, generated client, plugin RPC | plugin API grew |
| A31 Legacy migration | absent | — | — |
| A32 Security/PII | partial | Managed and permission policies; no PII redaction or ignore migration | policies added |

## Snapshot discrepancy

`marker-audit/v1-kilo-marker-port-assessment.md:9` pins the 816-file assessment at `d99662338e` (2026-08-10, merge #13046). `migration-context.md` names `f7115470` (2026-08-12) as the snapshot. `d99662338..f7115470` is 800 commits and touches 124 files in `packages/opencode/src/kilocode`, `kilo-vscode` and `kilo-gateway` alone. Staleness in this discovery is measured from `f7115470` as the brief instructs. Files changed only in the gap were never assessed. The register's gap table (732 files) shows that no area verdict changes: every area that moved in the gap is already MATERIAL. The gap files still need file-level dispositions, which the first L2 sweep assigns, and `migration-context.md` should record both SHAs.

## Decision 7 applied to V1 flags

| Flag on V1 | Default | Applied verdict | Note |
|---|---|---|---|
| `KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS` | **on** (kill switch, `packages/opencode/src/effect/runtime-flags.ts:47-49`) | gating (U-E2-07) | Literal Decision 7 would defer a default-on feature; see Q-NOW-01 in the register |
| `KILO_EXPERIMENTAL_SHARED_AGENT_BOARD` | **on** (kill switch, `runtime-flags.ts:61-62`) | gating (U-E2-24) | Same |
| `experimental.openTelemetry` | on (opt-out) | gating (U-E2-21) | Same |
| `KILO_EXPERIMENTAL_SCOUT`, `_CONTEXT_TOOLS`, `_CODE_MODE`, `_MCP_APPS`, `_SESSION_SWITCHER`, `_EVENT_SYSTEM`, `_CLAUDE_MIGRATION`, `_LSP_TOOL`, `KILO_ENABLE_EXA`, `experimental.native_notebook_tools`, `experimental.image_generation`, `experimental.speech_to_text_*` | off | post-cutover (E11) | `_EVENT_SYSTEM` debug view is not-needed |
| `KILO_EXPERIMENTAL_OUTPUT_TOKEN_MAX`, `_BASH_DEFAULT_TIMEOUT_MS`, `_FILEWATCHER`, `_DISABLE_COPY_ON_SELECT`, `_CUSTOMIZE_SKILL` | tunables | carried with their feature unit | Tunables, not features |
| `sandbox.enabled` | off (opt-in) | gating (U-E2-20) | Not an experimental flag on V1 |
| Defined without consumers: `KILO_EXPERIMENTAL_SESSION_SWITCHING`, `_ICON_DISCOVERY`, `_MARKDOWN` | — | not-needed (UNVERIFIED usage) | |
| Upstream-owned: `_WORKSPACES`, `_REFERENCES`, `_OXFMT`, `_LSP_TY`, `_NATIVE_LLM`, `_WEBSOCKETS`, `KILO_ENABLE_PARALLEL` | — | not Kilo features | |
