# Draft unit register

Status: discovery output, 2026-10-11. Single writer: discovery analyst. **Draft.** The planner turns this into Part B of the plan (Decision 9). No GitHub issue was created or closed. Units without an issue are marked `new`, and creating them is left to the user.

Companions: `v2-feature-inventory.md` (feature IDs F-CORE, F-VSC, F-JB, F-V2), `v2-epic-taxonomy.md` (epics and exit criteria).

## How to read a row

| Column | Meaning |
|---|---|
| Unit | `U-<epic>-<nn>`. One unit maps to one session, one branch and one PR at execution time. The planner may split units further |
| Surface | One of: shared runtime, gateway/cloud, CLI/TUI, packaging, import, VS Code, JetBrains, external consumer, repo |
| Gate | Exactly one: pre-gate, G1, G2, G3, post-cutover, post-G3, continuous |
| Features | Inventory IDs covered (every inventory row appears in exactly one unit) |
| Issues | Existing GitHub issues; `new` = no issue yet |
| Delta | needs-port / native / partial / not-needed / post-cutover, as in the inventory |
| Stale | V1 staleness of the files the unit touches, SNAP `f7115470` → V1 `fb7e96ed` (Decision 4): EMPTY, SMALL, MATERIAL, NEW (post-SNAP; no donor can exist). Area figures are in "Staleness per area" |
| Donor | Reuse from `kilo-v2-checkpoints-2026-09`: yes / partial / no, with confidence (H/M/L) and the main donor path. Per Decision 3, donor supplies the v2 mechanism only. When Stale is not EMPTY, behavior is re-derived from V1 |

Donor paths are relative to the donor tag; `kc/` = `packages/kilo-cli/src/`, `kv/` = `packages/kilo-vscode/src/`.

## E0 Foundation

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E0-01 | Kilo host and composition package (server, overrides, Location service replacements, builtin plugin list) | shared runtime | pre-gate | (host for all E1/E2) | new | needs-port | n/a | yes H: `kc/host.ts` (`ServerFetch.make(options,{overrides})`; `server/src/fetch.ts` overrides still present at BASE) | — |
| U-E0-02 | Kilo RPC and plugin scaffolding (`packages/schema/src/kilocode`, plugin `define`, generated client consumption) | shared runtime | pre-gate | F-V2-050, Part 1 "Plugins and SDK" | new | native mechanism | n/a | yes H: `packages/schema/src/kilocode/*` (`schema/src/rpc.ts` unchanged since donor base) | U-E0-01 |
| U-E0-03 | Re-land Kilo `AGENTS.md`; rewrite `v2-fork-conventions.md`, migration-tracking `README.md`, `v2-baseline.ts`; superseded banners on old plans (see `doc-inventory.md` §8) | repo | pre-gate | — | new | needs-port | n/a | no | — |
| U-E0-04 | Kilo CI lane on `kilo-v2-clean`; neutralize upstream publish/deploy workflows, `sdks/vscode` publishing, hosted web properties, CI images | repo | pre-gate | F-V2-055, F-V2-056, F-V2-057 | new (part of #14408 scope) | needs-port | n/a | no | admin task: Actions permissions |
| U-E0-05 | v1 reference fixtures for offline wait, overflow, slow snapshot, snapshot retention (data at V1, harness on BASE) | repo | pre-gate | — | new (old N5) | needs-port | MATERIAL (A06) | partial M: `kc/test/fixtures/v1-session`, `v1-writer*` (built at V1 `d99662338`/`ecccd1f`; regenerate at V1 `fb7e96ed`) | U-E0-01 |

## E1 Core and identity

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E1-01 | Product identity and branding: app dir, binary, env prefix, UA, config filenames, default theme and logo | shared runtime | G1 | F-CORE-001, F-CORE-108a, F-V2-001, F-V2-002, F-V2-043 | new | partial | SMALL (A01) | yes H paths / L theme: `kc/paths.ts`, `kc/tui-plugin/logo*.tsx`; donor theme patches target `theme/src/tui/{defaults,fallback}.ts`, **deleted at BASE** | U-E0-01 |
| U-E1-02 | Customer v2 store and paths (D6): distinct data/config dirs, fail-closed on v1/opencode stores, DB preflight and SQLite errors, log correlation | shared runtime | G1 | F-CORE-002, F-CORE-004, F-V2-003 | new (old N8) | partial | SMALL (A01: WAL recovery `97abdab66c`, interrupted first access `1988e54fd6`) | yes H: `kc/paths.ts`, `kc/storage.ts` | U-E1-01 |
| U-E1-03 | Gateway auth, profile, organizations, teams, Pass, error codes, tRPC client, via the integration/credential framework | gateway/cloud | G1 | F-CORE-015, F-CORE-016, F-CORE-017, F-CORE-019, F-CORE-021, F-V2-017, F-V2-018 | new (runtime side; VS Code side is #14388) | partial | MATERIAL (A03: org default model `8c077fbee7`, credential precedence `acd3d1ff9b`) | yes M: `kilo-gateway/src/{account,gateway}.ts`, `schema/kilocode/gateway.ts`, `kc/auth.ts` | U-E0-02 |
| U-E1-04 | Gateway provider, catalog merge/refresh/recovery, Kilo Auto and routed model, provider options, Codex/cloud auth | gateway/cloud | G1 | F-CORE-022…026, F-V2-019, F-V2-020 | new | partial | MATERIAL (A04: catalog recovery `5539dd3ae5` #14723, malformed entries #14794, cache breakpoints `ad173c7e9a`) | yes L-M: `kilo-gateway/src/{models,plugin,startup-cache}.ts`, `packages/ai/src/kilocode/*routed*` (`packages/ai` +151 commits since donor base) | U-E1-03 |
| U-E1-05 | System-prompt selectors (8), memory guidance, editor `<env>` context on BASE seams | shared runtime | G1 | F-CORE-029, F-V2-021 | new | partial | MATERIAL (A04) | partial L: `kc/model-prompt-policy.ts`; donor patch on `core/src/plugin/system-prompt.ts`, **deleted at BASE** (#47447, #47559) | U-E1-04 |
| U-E1-06 | Model usage, cost, throughput and provider usage/quotas (`/usage`) | shared runtime | G1 | F-CORE-020, F-CORE-028 | new | needs-port | MATERIAL + NEW (provider usage #11611, Codex usage #13519) | partial M: `kc/session-usage*.ts`, `kc/tui-plugin/sidebar-usage.tsx` | U-E1-04 |
| U-E1-07 | Kilo config layer: keys, `kilo.json`/`.kilo` discovery, overlay/sources/writer, references, managed policy | shared runtime | G1 | F-CORE-031, F-CORE-032, F-V2-005, F-V2-007 | new | partial | MATERIAL (A05: `memory_model` #14781, swarm #14160, PTC #14230, cleanup #14054) | partial M: `kc/{settings,settings-rpc,config-write,project-config}.ts`, donor patch `core/src/config.ts` (+70/−33 drift) | U-E1-01 |
| U-E1-08 | Kilo server extension surface: route groups as plugin RPC, parent watchdog, instance reload, watcher policy, capability/version handshake (server side) | shared runtime | G1 | F-CORE-006, F-CORE-007, F-CORE-008, F-CORE-009, F-CORE-011, F-V2-036, Part 1 "Server and API" | new (old N9 server side) | partial | MATERIAL (A02: `/reload` #14103, shutdown deadline, DB reclaim #14540) | yes M: `kc/{server,runtime,interactive-server}.ts`, `kc/*-rpc.ts` | U-E0-02 |

## E2 Runtime behavior

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E2-01 | Offline network wait and reconnect | shared runtime | G1 | F-CORE-034, F-V2-009 | #14371 | needs-port | MATERIAL (A06; incl. #14893 at the V1 tip) | no (progress row "Needs port") | U-E0-05 |
| U-E2-02 | Overflow accounting, `threshold_percent`, chunked compaction, payload recovery | shared runtime | G1 | F-CORE-035, F-V2-010, Part 1 "Compaction" | #14372 | partial | MATERIAL (`5edf432c2f` #14318) | no (native reuse only) | U-E0-05 |
| U-E2-03 | Slow-snapshot interaction policy and UI | shared runtime | G1 | F-CORE-036a | #14373 | partial | MATERIAL | no | U-E0-05 |
| U-E2-04 | Snapshot seed/materialize, locking, cleanup, retention, restore/diff | shared runtime | G1 | F-CORE-036b, F-V2-011 | #14374 | partial | MATERIAL (+490; lock/cleanup NEW) | no | U-E0-05 |
| U-E2-05 | Message deletion runtime operation, Kilo revert, stable ordering | shared runtime | G2 | F-CORE-042 | #14380 | needs-port | MATERIAL | no | U-E0-02 |
| U-E2-06 | Session core verification: drain/control, prompt queue and steer, title, processing hardening | shared runtime | G1 | F-CORE-037, F-CORE-043, F-CORE-044, F-CORE-045, F-V2-008, Part 1 "Sessions" | new | partial | MATERIAL + NEW (drain, steer; ~128 fixes) | no (native reuse) | U-E0-01 |
| U-E2-07 | Subagent resume, background subagents (default on), steering | shared runtime | G1 | F-CORE-041, F-V2-012, F-V2-033 | new | partial | MATERIAL (#14702, #13641) | no | U-E2-06 |
| U-E2-08 | Wakeups and cron (persisted, re-armed) | shared runtime | G1 | F-CORE-038 | new | needs-port | NEW (#14094, #14312) | no | U-E2-06 |
| U-E2-09 | Goal mode | shared runtime | G1 | F-CORE-039 | new | needs-port | NEW (#13679, #14504) | no | U-E2-08 |
| U-E2-10 | Backend-owned session retention | shared runtime | G1 | F-CORE-040 | new | needs-port | NEW (#14054) | no | U-E1-07 |
| U-E2-11 | Session transcript recall search | shared runtime | G1 | F-CORE-046 | new | needs-port | MATERIAL | partial M: `kc/session-search*` (old VS Code backend `backend/session-search.ts`) | U-E0-02 |
| U-E2-12 | Kilo agents (code, ask, debug, orchestrator, plan), mode reminders, agent builder | shared runtime | G1 | F-CORE-055, F-CORE-056, F-CORE-058, F-V2-022, Part 1 "Agents" | new | partial | MATERIAL (agent requirements removed #13225) | yes M: `kc/agent-policy.ts` | U-E0-02 |
| U-E2-13 | Plan workflow and Plan-to-Code handoff | shared runtime | G1 | F-CORE-057, F-V2-023 | #14382 | needs-port | MATERIAL (`6024a76db5`) | yes M: `kc/plan-policy.ts`, `plan-prompt.txt` | U-E2-12 |
| U-E2-14 | Kilo review policy over native `/review` | shared runtime | G1 | F-CORE-059, F-V2-024 | new | partial | MATERIAL (`46bd29d733`) | yes M: `kc/review-policy.ts` | U-E2-12 |
| U-E2-15 | Commands and workflows, skills (trust, builtin, remove), rules and primary-worktree discovery | shared runtime | G1 | F-CORE-060, F-CORE-061, F-CORE-062, F-V2-025, F-V2-026 | new (VS Code callers: #14393) | partial | MATERIAL | yes M: `kc/{commands,skill-policy*,skill-shell*}.ts` | U-E1-07 |
| U-E2-16 | Kilo tool set: registry and client gating, question, suggest, TS check, rich read, model tools, repo overview, encoding, todo | shared runtime | G1 | F-CORE-064, F-CORE-067, F-CORE-068, F-CORE-069, F-CORE-071, F-CORE-073, F-CORE-074, F-CORE-078, F-CORE-079, F-V2-027, F-V2-029, F-V2-030, Part 1 "Tools", "LSP" | new | partial | MATERIAL + NEW (+2,205 lines in `tool/`) | partial L-M: `kc/{tool-authorization,request-policy}.ts` | U-E0-02 |
| U-E2-17 | Permission customizations and bash hierarchy | shared runtime | G1 | F-CORE-065, F-CORE-066, F-V2-028, Part 1 "Permissions" | new | partial | MATERIAL (#14051) | partial M: `kc/tool-authorization.ts`, `explore-policy-v2-parity.md` counts | U-E2-16 |
| U-E2-18 | Memory engine, tools and RPC | shared runtime | G1 | F-CORE-080 | new | needs-port | SMALL (A10: `memory_model` #14781, SSE fix #13122) | yes H: `packages/kilo-memory`, `kc/memory-*.ts`, `schema/kilocode/memory.ts` | U-E0-02 |
| U-E2-19 | Codebase indexing engine, worker, `semantic_search` | shared runtime | G1 | F-CORE-081 | new | needs-port | MATERIAL (moderate: embedder fixes, root safeguards, `@parcel/watcher` #12784) | yes M-H: `packages/kilo-indexing` (closer to V1 than SNAP), `kc/indexing*.ts` | U-E0-02 |
| U-E2-20 | Sandbox: shell/MCP/PTY confinement, network relay, git classifier, per-session lifecycle, on workspace/environment driver seam | shared runtime | G1 | F-CORE-082, F-V2-038 | new | needs-port | MATERIAL (git classifier #14222) | yes M: `kc/sandbox{,-mcp,-pty}.ts`; donor has no `kilo-sandbox` package; donor MCP SpawnHooks patch on a file rewritten upstream (+197/−292) | U-E0-01 |
| U-E2-21 | Telemetry with consent and privacy policy, coexisting with OTLP | shared runtime | G1 | F-CORE-083, F-V2-047 | new | needs-port | SMALL (#14638) | partial M: `kc/telemetry*.ts` (own opt-in OTLP exporter, not `kilo-telemetry`; see `telemetry-v2-overlap.md`) | U-E1-01 |
| U-E2-22 | MCP deltas (OAuth callback handoff, issuer discovery, auth-failure surfacing, SSE probe, jsonc writes) and `git:` plugin sources | shared runtime | G1 | F-CORE-084, F-CORE-086, F-V2-031, Part 1 "MCP" | new | partial | NEW (`k/mcp/*` #14724) | partial L: `kc/sandbox-mcp.ts` only | U-E0-02 |
| U-E2-23 | Marketplace (MCP servers, skills, modes, plugins) | gateway/cloud | G1 | F-CORE-063 | new | needs-port | NEW (#12714, #14510) | no | U-E2-22 |
| U-E2-24 | Shared agent board / swarm (default on) | shared runtime | G1 | F-CORE-090 | new | needs-port | NEW (#13629, #14134) | partial M: `kc/swarm{,-store}.ts` (SNAP-era model; re-derive) | U-E2-07 |
| U-E2-25 | Background processes tool, sidebar data, `/process`, on persistent PTY | shared runtime | G1 | F-CORE-089, F-V2-034 | new | needs-port | MATERIAL | partial M: `kv/backend/processes.ts`, `sidebar-processes-v2-parity.md` | U-E0-02 |
| U-E2-26 | Worktree runtime: family detection, teardown, Kilo layout, VCS | shared runtime | G1 | F-CORE-088a, F-V2-032, F-V2-052, Part 1 "Workspaces" | new | partial | MATERIAL | no | U-E0-01 |
| U-E2-27 | Agent Manager host contract and control plane (ask/reply/reject, protection) | shared runtime | G2 | F-CORE-087 | #14391 | needs-port | MATERIAL (A15 +55k lines) | partial L: SNAP-era `kv/agent-manager` | U-E2-26 |
| U-E2-28 | Generation endpoints: enhance prompt, commit message, branch name | shared runtime | G2 | F-CORE-116 | new (consumers: #14389) | partial | SMALL (A24: #13108, editor-context prefix #13379) | yes M: `kc/generation-plugin.ts`, `schema/kilocode/generation.ts` | U-E0-02 |
| U-E2-29 | Atomic Chat local provider plugin | shared runtime | G1 | F-CORE-119 | new | needs-port | EMPTY (version bumps only) | no | U-E1-04 |

## E9 CLI/TUI surface

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E9-01 | Service/daemon UX: `kilo daemon` compatibility over native service, startup performance, port warning | CLI/TUI | G1 | F-CORE-005, F-CORE-010, F-V2-035 | new | native | MATERIAL (A02) | yes M: `kc/{daemon,daemon-entry}.ts` | U-E1-08 |
| U-E9-02 | Kilo command set, help, generated CLI docs, roll-call, `kilo worktree` commands, inherited commands (api, models, stats, debug, plugin) | CLI/TUI | G1 | F-CORE-030, F-CORE-088b, F-CORE-098, F-V2-041, F-V2-053, Part 1 "CLI commands" | new | partial | MATERIAL (worktree cmds #12809) | yes M: `kc/{commands,index}.ts` | U-E0-01 |
| U-E9-03 | `kilo run` and headless behavior (variant, auto, drain, stdin, question handling) | CLI/TUI | G1 | F-CORE-099, F-V2-039 | new | partial | MATERIAL | yes M: `kc/{run,run-input}.ts` | U-E2-06 |
| U-E9-04 | ACP host with Kilo permission mapping | CLI/TUI | G1 | F-CORE-100, F-V2-040, Part 1 "ACP" | new | partial | MATERIAL (A18 ACP +226/−45) | yes M: `kc/acp.ts`, `packages/cli/src/kilocode/acp.ts` | U-E2-17 |
| U-E9-05 | TUI shell: terminal title/activity, caffeinate, TUI config hot reload, worker transport check, inherited TUI and rendering | CLI/TUI | G1 | F-CORE-012, F-CORE-013, F-CORE-033, F-CORE-101, F-V2-042, F-V2-058, Part 1 "TUI" | new | partial | MATERIAL (A19) | partial L-M: `kc/tui-plugin/*`; 14 donor TUI patches on files with heavy drift (session route +540/−887) | U-E1-01 |
| U-E9-06 | Kilo slash-command registry and dialogs; gateway notifications and news | CLI/TUI | G1 | F-CORE-018, F-CORE-102 | new (notifications VS Code side: #14392) | partial | MATERIAL | partial M: `kc/tui-plugin/*` | U-E1-03 |
| U-E9-07 | Home and sidebar plugins (onboarding, tips, footer, usage/balance, PR, indexing, memory, processes rows); model picker, info panel, free/training disclosure | CLI/TUI | G1 | F-CORE-027, F-CORE-103 | new (old N12 picker part) | partial | MATERIAL | yes M: `kc/tui-plugin/sidebar-*.tsx`, `kc/model-picker.ts` (sidebar order facts in `cli-remainder-next-gaps.md`) | U-E1-06 |
| U-E9-08 | Per-session soft maximum-cost alert | CLI/TUI | G1 | F-CORE-047 | new | needs-port | MATERIAL (A06 area; feature itself pre) | no | U-E1-06 |
| U-E9-09 | Completion/abort/timeout notifications and attention policy | CLI/TUI | G1 | F-CORE-107, F-V2-044 | #14375 | partial | MATERIAL | partial L | U-E9-05 |
| U-E9-10 | Session scope switching, list actions, clickable links, @session mentions, double-press guards, keybinds | CLI/TUI | G1 | F-CORE-109a, F-V2-045 | #14377 | needs-port | MATERIAL | no | U-E9-05 |
| U-E9-11 | Location/session projection and foreign-project event filtering on v2 | CLI/TUI | G1 | F-CORE-105 | #14379 | partial (likely native at BASE; verify) | MATERIAL | no | U-E9-05 |
| U-E9-12 | Multiline alerts and default sound (#14378 G1 part); display preferences; privacy-mode and PII redaction | CLI/TUI | G1 | F-CORE-110, F-CORE-129 | #14378 (part) | partial | MATERIAL (A19); SMALL (A32) | partial L: `kc/privacy*.ts` | U-E9-05 |
| U-E9-13 | `kilo cloud` Cloud Agent CLI | gateway/cloud | G1 | F-CORE-111 | new | needs-port | SMALL (#13851 stdin) | yes H-M: `kc/cloud-*.ts`, `kc/cloud/*` (7 tests) | U-E1-03 |
| U-E9-14 | Embedded web UI decision: `kilo-web-ui` vs upstream `packages/app` served by the service | CLI/TUI | G1 | F-CORE-125 | new | partial (decision) | MATERIAL (A29) | no | U-E9-15 |
| U-E9-15 | Product disposition of upstream-only surfaces: Electron desktop, web app, GUI extensions | CLI/TUI | G1 | F-V2-049 | new (user decision) | n/a (decision) | n/a | no | — |

## E3 Import and distribution

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E3-01 | Opt-in, re-runnable v1 session/data import into the v2 store (read `kilo.db` read-only; reuse upstream pure transforms; legacy JSON storage) | import | G1 | F-CORE-003, F-CORE-050, F-V2-015 | #14413 | needs-port | MATERIAL (A07) | partial M: `kc/import-v1-session.ts`, fixtures; `v1-session-schema-audit.md` says copy-then-migrate is not proven lossless | U-E1-02 |
| U-E3-02 | Credential import (host-local only) | import | G1 | F-CORE-054 | #14413 (part) | partial | MATERIAL (A07) | yes M: `kc/credential-import.ts` | U-E1-03 |
| U-E3-03 | Config key mapping and legacy Kilo Code migrators (modes, rules, workflows, MCP, ignore); TUI config migration | import | G1 | F-CORE-127, F-V2-006, F-V2-016 | #14413 (part) | needs-port | MATERIAL (A05/A31) | partial M: `kc/import-v1-config.ts` (`config-mapping-v2-gap.md`) | U-E1-07 |
| U-E3-04 | External transcript resume (Claude Code, Codex), migrate API, cloud session import and `--cloud-fork` | import | G1 | F-CORE-049, F-CORE-051 | new | needs-port | MATERIAL + NEW (#13294, #13483) | partial L: `kc/{external-sessions,resume-external}.ts` (shape changed on V1) | U-E3-01 |
| U-E3-05 | Fork, move and portability diff verification | import | G1 | F-CORE-052, F-CORE-053, F-V2-013, F-V2-014 | new | native/partial | MATERIAL (A07) | no | U-E2-06 |
| U-E3-06 | Updater and installation detection under Kilo identity | packaging | G1 | F-CORE-112, F-V2-046 | #14410 | partial | MATERIAL (A21) | yes M: `kc/updater.ts` (`updater-local-parity.md`) | U-E1-01 |
| U-E3-07 | Build and release pipeline: platforms, npm/GHCR/AUR/Homebrew/nix/install script, SBOM, PTY smoke, signing and notarization, payload format, clean install | packaging | G1 | F-CORE-014, F-CORE-113 | #14409, #14411, #14412 | partial | MATERIAL (SBOM #14513, Windows AVX2 launcher) | partial M: `kc/../script/{build,build-tui,build-portable,update-manifest}.ts` | U-E0-04 |
| U-E3-08 | CI and repository guards hardening (forbidden strings, generated artifacts, markers, md tables, CodeQL, sharding, bots) | packaging | G1 | F-CORE-114 | #14408 | partial | MATERIAL (47 workflow files) | no | U-E0-04 |
| U-E3-09 | Publish `@kilocode/sdk` and `@kilocode/plugin` from BASE packages | packaging | G1 | F-CORE-126 | new | partial | SMALL (regen) | no | U-E3-07 |
| U-E3-10 | v2 preview release train | packaging | G1 | — | new (old N17) | needs-port | n/a | no | U-E3-06, U-E3-07 |
| U-E3-11 | Canary and cutover/rollback runbook, G1 child (G2/G3 children later) | packaging | G1 | — | #14414 | needs-port | n/a | no | U-E3-10 |
| U-E3-12 | Binary and channel naming; v1-IDE isolation from the v2 binary (answer Q-DIST-01 before U-E3-10 starts) | packaging | G1 | F-V2-004 | new (deferred user decision Q-DIST-01) | needs-port | n/a | no | U-E1-01 |

## E4 Remote sessions

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E4-01 | Relay wire protocol and command dispatcher | gateway/cloud | G1 | F-CORE-092 | #14402 | needs-port | MATERIAL (A16: #13496, #13497, #13565) | yes M: `kc/remote-{plugin,protocol,rpc,session}.ts`, `schema/kilocode/remote.ts` | U-E1-03 |
| U-E4-02 | Streamed transcript, attachments, `notify_user`/`send_file`, reconnect without duplication | gateway/cloud | G1 | F-CORE-094 | #14403 | needs-port | MATERIAL | yes M: `kc/remote-transcript.ts` | U-E4-01 |
| U-E4-03 | Remote suggestion lifecycle and subscribed-session ownership | gateway/cloud | G1 | — (consumes the suggest tool from U-E2-16) | #14404 | needs-port | MATERIAL | yes M: `kc/remote-suggestions.ts` | U-E4-01, U-E2-16 |
| U-E4-04 | Detach/exit, interruption, heartbeat fencing | gateway/cloud | G1 | — | #14405 | needs-port | MATERIAL | yes M: `kc/remote-status.ts` | U-E4-01 |
| U-E4-05 | Metadata differences, capability advertisement, instance identity, directory listing, headless link dialog, coexistence with upstream pairing/OpenTunnel | gateway/cloud | G1 | F-CORE-096, F-V2-037 | #14406 | needs-port | MATERIAL (+NEW identity fields) | partial M | U-E4-01 |
| U-E4-06 | Presence registry/relay: host registration | gateway/cloud | G1 | F-CORE-093 | #14395 (part) | needs-port | MATERIAL (client moved to `kilo-gateway`) | yes M: `kc/presence-*.ts`, `schema/kilocode/presence.ts` | U-E4-01 |
| U-E4-07 | PR linking (GitHub, GitLab, Bitbucket), poller, sidebar row | gateway/cloud | G1 | F-CORE-095 | new | needs-port | NEW (#13137, #14195) | no | U-E4-01 |
| U-E4-08 | Deployed relay and consumer verification (external-gated) | gateway/cloud | G1 | — | #14407 | needs-port | n/a | no | U-E4-01…07 |

## E5 Sharing

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E5-01 | Share transport normalization; share/unshare/fork client operations | gateway/cloud | G1 | F-CORE-097, Part 1 "Sharing" | #14396 | needs-port | EMPTY (A17) | partial M-H: `kilo-gateway/src/session.ts`, `test/sharing*` (donor faithful on behavior) | U-E1-03 |
| U-E5-02 | v2 share payload contract (self-contained messages, metadata-first upload) | gateway/cloud | G1 | — | #14397 | needs-port | EMPTY | partial M | U-E5-01 |
| U-E5-03 | Public shared-transcript viewer for v2 messages (cloud repo) | gateway/cloud | G1 | — | #14398 | needs-port | EMPTY | no | U-E5-02 |
| U-E5-04 | Team upload stays refused (fail-closed) | gateway/cloud | G1 | — | #14399 (part) | needs-port | EMPTY | partial M | U-E5-01 |
| U-E5-05 | Deployed share contract verification (external-gated) | gateway/cloud | G1 | — | #14401 | needs-port | n/a | no | U-E5-01…04 |
| U-E5-06 | Background session export/ingest to Kilo cloud (scrubbed), opt-out | gateway/cloud | G1 | F-CORE-048 | new | needs-port | pre (no change) at feature level; A07 MATERIAL overall | no | U-E1-03 |

## E6 VS Code track (G2)

Shared facts for E6. Staleness is MATERIAL for every unit (A22: 527 files, +64,678/−5,971; A23: 545 files, +49,247/−15,679), except A24 editor services, which is SMALL. The donor's extension and webview are SNAP-era copies (donor `kilo-vscode` vs V1: 1,702 differing files). Per Decision 4, re-copy the extension and webview from V1 and keep only the donor's v2 backend-adapter pattern (`kv/backend/*`, 25 adapters; `connection.ts`, `local-server.ts`).

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E6-01 | Re-land the V1 extension host, webview, `kilo-ui`, `kilo-i18n` on the clean base behind v2 backend adapters; real typecheck with no skip shim | VS Code | G2 | F-VSC-001, F-VSC-002 | #14383 | needs-port | MATERIAL | partial L: adapter pattern `kv/backend/*`; donor UI is SNAP-era | U-E0-02 |
| U-E6-02 | Connection: server manager for the v2 binary, auto-start, capability handshake (client side), v2 store and opt-in first-launch import switch | VS Code | G2 | F-VSC-003, F-VSC-004 | #14387 (+ old N9 client side) | needs-port | MATERIAL | partial M: `kv/connection.ts`, `kv/local-server.ts` | U-E6-01, U-E1-08, U-E3-01 |
| U-E6-03 | Sidebar chat lifecycle end to end: streaming, Stop, reconnect, Restricted Mode key conflict, message-deletion caller | VS Code | G2 | F-VSC-005, F-VSC-023 | #14384 | needs-port | MATERIAL | partial L: `kv/backend/{session,events,projection}.ts` | U-E6-02, U-E2-05 |
| U-E6-04 | Editor tabs: streaming, restore, independent session routing | VS Code | G2 | F-VSC-006 | #14385 | needs-port | MATERIAL | partial L | U-E6-03 |
| U-E6-05 | Settings webview controls and persistence (incl. max cost, display, language, CA certs) | VS Code | G2 | F-VSC-007, F-VSC-024 | #14386 | needs-port | MATERIAL | partial M: `kv/backend/settings.ts` | U-E6-01, U-E1-07 |
| U-E6-06 | Models, accounts, auth and provider OAuth variants, org switch, provider usage | VS Code | G2 | F-VSC-008 | #14388 | needs-port | MATERIAL | partial M: `kv/backend/{account,models,model-state,usage}.ts` | U-E6-02, U-E1-03 |
| U-E6-07 | Generation consumers: commit message (SCM), enhance prompt, branch naming; code actions and terminal actions | VS Code | G2 | F-VSC-009, F-VSC-010, F-VSC-011 | #14389, #14417 | needs-port | SMALL (A24) | partial M: `kv/backend/generation.ts` | U-E2-28 |
| U-E6-08 | FIM/autocomplete and next-edit: gateway producer, service contract, editor integration (`#14415` inventory is done evidence: `editor-services-inventory.md`) | VS Code | G2 | F-CORE-117, F-VSC-012 | #14416 (#14415) | needs-port | SMALL (A24: shared FIM model selection only) | no (donor autocomplete is a SNAP copy; V1 barely changed, so port V1 directly) | U-E1-03 |
| U-E6-09 | Terminal integration and ticket lifecycle in the original panel | VS Code | G2 | F-VSC-013 | #14390 | needs-port | MATERIAL | partial M: `kv/backend/{pty,terminal-connection}.ts` | U-E6-02 |
| U-E6-10 | Agent Manager UI on the v2 control plane: worktrees, sessions, tabs, terminals, PR, diff, browser previews | VS Code | G2 | F-VSC-014 | #14391 (consumer side) | needs-port | MATERIAL (+55k lines) | partial L: SNAP-era `kv/agent-manager` | U-E2-27, U-E6-09 |
| U-E6-11 | VS Code-only tools and panels: browser tab/open, chart, image preview, document viewer, sub-agent viewer, diff virtual provider | VS Code | G2 | F-CORE-072, F-CORE-077, F-VSC-015 | new | needs-port | MATERIAL + NEW (browser-open) | partial L | U-E6-01, U-E2-16 |
| U-E6-12 | Notifications and suggestions lifecycle | VS Code | G2 | F-VSC-016 | #14392 | needs-port | MATERIAL | no | U-E2-16, U-E9-06 |
| U-E6-13 | Marketplace panel; agent, skill and MCP removal; MCP OAuth sign-in | VS Code | G2 | F-VSC-017 | #14393 | needs-port | MATERIAL + NEW | partial L: `kv/backend/mcp.ts` | U-E2-15, U-E2-22, U-E2-23 |
| U-E6-14 | Task timeline and editor diff viewer projection detail; token throughput | VS Code | G2 | F-VSC-018 | #14394 | needs-port | MATERIAL | partial L | U-E6-03 |
| U-E6-15 | Remote status and presence visibility reporting | VS Code | G2 | F-VSC-019 | #14395 (VS Code part) | needs-port | MATERIAL | partial M: `kv/backend/{presence,remote}.ts` | U-E4-06 |
| U-E6-16 | Engine and policy controls: memory, indexing consent and write controls, sandbox preference, network ask, caffeination, attention, telemetry proxy | VS Code | G2 | F-VSC-020 | new (old N14) | needs-port | MATERIAL | partial M: `kv/backend/memory.ts` | U-E2-18…U-E2-21 |
| U-E6-17 | Kilo-classic session migration and Roo import | import | G2 | F-VSC-021 | new | needs-port | MATERIAL (scope reduced by #13605) | partial L (donor copies predate #13605) | U-E3-01 |
| U-E6-18 | Session extras: board, background jobs, wakeups, retention, model usage, snapshots, session move, cloud session import | VS Code | G2 | F-VSC-022 | new | needs-port | NEW | no | U-E2-08, U-E2-10, U-E2-24, U-E3-04 |
| U-E6-19 | VSIX packaging and publishing of the v2 extension (bundles the v2 binary) | packaging | G2 | F-VSC-032 | new | needs-port | MATERIAL | partial M: `vscode-packaging.md` (`vsce package --no-dependencies`) | U-E6-02, U-E3-07 |

## E7 JetBrains track (G3)

Shared facts for E7. The plugin is absent from BASE and from the donor (no reuse). Staleness is MATERIAL (A25: 873 files, +108,897/−7,992 SNAP→V1). Behavior comes entirely from V1.

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E7-01 | Inventory plugin contracts (routes used by the generated Kotlin client, events, terminal) and map each to a public v2 interface | JetBrains | G3 | — | #14420 | needs-port | MATERIAL | no | U-E0-02 |
| U-E7-02 | Re-land the plugin on the clean base: Gradle build, CLI pinning to a v2 release, OpenAPI client generated from the assembled v2 contract, server startup, discovery, auth, version checks | JetBrains | G3 | F-JB-001, F-JB-002, F-JB-003 | #14421 | needs-port | MATERIAL | no | U-E7-01, U-E3-07 |
| U-E7-03 | Sessions, streaming, permissions, history, config, board, subagents, prompt completion, settings, MCP OAuth, telemetry | JetBrains | G3 | F-JB-004, F-JB-005, F-JB-006, F-JB-010 | #14422 | needs-port | MATERIAL | no | U-E7-02 |
| U-E7-04 | Terminal, diff/VFS and shared editor-service consumers (enhance prompt, branch name; FIM only if the gate stays, Q-G3-01) | JetBrains | G3 | F-JB-007, F-JB-011 | #14423 | needs-port | MATERIAL | no | U-E7-02, U-E2-28 |
| U-E7-05 | Agent Manager, worktrees, marketplace, legacy v5 migration | JetBrains | G3 | F-JB-008, F-JB-009 | new | needs-port | MATERIAL | no | U-E2-27, U-E7-03 |
| U-E7-06 | Validate in supported IDEs: reconnect, restart, version mismatch | JetBrains | G3 | — | #14424 | needs-port | n/a | no | U-E7-02…05 |

## E10 External consumers

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E10-01 | Cloud agent consumers: adapt confirmed gaps through public interfaces and validate (discovery done: `cloud-agent-consumers.md`, `cloud-agent-contracts.md`) | external consumer | G1 (consumer pins `@kilocode/cli@7.8.1`, independent cutover; gate attachment needs user confirmation) | — | #14427, #14428 (#14425, #14426 have evidence) | needs-port | n/a | no | U-E3-12, U-E3-01 |
| U-E10-02 | Anaconda Desktop: integration mode, compatibility, adaptation and validation; V1 `anaconda-desktop` provider | external consumer | set by #14429 discovery (UNVERIFIED which surface) | F-CORE-118, F-VSC-031 | #14429, #14430, #14431, #14432 | needs-port | EMPTY (A26) | no (SNAP copy in `kv/anaconda-desktop` only) | U-E1-04 |
| U-E10-03 | Other CLI consumers: Zed extension, GitHub Action, floating `@latest` users (benchmark, MCP-catalog CI) | external consumer | G1 | — | new | needs-port | n/a | no | U-E3-12 |

## E8 Retirement

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E8-01 | Branch flip (`main`→`v1`, `kilo-v2-clean`→`main`) and its timing relative to IDE v1 builds | repo | post-G3 | — | new (old N10) | needs-port | n/a | no | G3 go/no-go |
| U-E8-02 | Storage path consolidation after G3 (D6), one-time with backup | import | post-G3 | — | new (old N10) | needs-port | n/a | no | U-E8-01 |
| U-E8-03 | Packages that deploy from `main`: keep (docs site), retire (`kilo-console`, F-CORE-123), re-home their workflows | repo | post-G3 | F-CORE-123 | new (old N6a/N6b in part) | not-needed (console) / needs-port (docs deploy) | MATERIAL (A29) | no | U-L5-01 |
| U-E8-04 | v1 end-of-life policy and maintenance window | repo | post-G3 | — | new | needs-port | n/a | no | U-E8-01 |

## E11 Post-cutover backlog

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-E11-01 | Speech-to-text (CLI gateway endpoints and VS Code capture) | gateway/cloud | post-cutover | F-CORE-120, F-V2-051, F-VSC-029 | #14418 | post-cutover | SMALL (A28) | no (SNAP copy) | — |
| U-E11-02 | Image generation (tool and VS Code consumer) | gateway/cloud | post-cutover | F-CORE-121, F-VSC-030 | #14419 (image part) | post-cutover | SMALL | no (SNAP copy) | — |
| U-E11-03 | Team sharing ownership model; incremental sharing with deletion/revert semantics | gateway/cloud | post-cutover | — | #14399 (ownership part), #14400 | post-cutover | EMPTY | no | U-E5-02 |
| U-E11-04 | Legacy TUI extras: kilo-v1/colorblind theme catalogue, legacy bindings, fixed-width tables, vim mode | CLI/TUI | post-cutover | F-CORE-106, F-CORE-108b, F-CORE-109b | #14376, #14378 (tables/bindings part) | post-cutover | MATERIAL (A19) | partial L | U-E9-05 |
| U-E11-05 | Default-off experimental features: Exa, context tools, code mode/PTC, MCP Apps, session switcher, native notebook tools, Claude migration, scout, LSP tool | mixed (shared runtime) | post-cutover | F-CORE-070, F-CORE-075, F-CORE-076, F-CORE-085, F-CORE-091, F-CORE-104, F-CORE-128, F-V2-048, F-VSC-025, F-VSC-026, F-VSC-027, F-VSC-028 | new | post-cutover | NEW for most | no | — |
| U-E11-06 | KiloClaw: record not-needed (removed on V1 `3eaf47ba52`); delete donor remnants if copied | repo | post-cutover | F-CORE-122 | #14419 (Claw part) | not-needed | n/a | no (donor has 40 stale paths per `editor-services-inventory.md`) | — |

## L Cross-cutting lanes

| Unit | Title | Surface | Gate | Features | Issues | Delta | Stale | Donor | Depends |
|---|---|---|---|---|---|---|---|---|---|
| U-L1-01 | Upstream sync: merge `upstream/v2` pinned by SHA; dry-run workflow; v2 merge tooling | repo | continuous | F-CORE-115 | new (old N3) | needs-port | MATERIAL (`script/upstream/**`) | no | U-E0-04 |
| U-L2-01 | V1 delta sweep: advance the cutoff, refresh the experimental-flag list, re-run staleness for affected units | repo | continuous | — | new (old N4) | needs-port | n/a | no | — |
| U-L3-01 | Shared-patch ratchet and marker disposition sweep | repo | continuous | — | #14381 (old N2) | needs-port | n/a | no | U-E0-01 |
| U-L4-01 | Acceptance: rewrite test plans with gate tags and V1-derived expectations; simulation/http-recorder harness; gate acceptance runs (G1 child first) | repo | continuous | F-V2-054 | new (old N11, N15, N16) | needs-port | n/a | no | — |
| U-L5-01 | Docs: kilo.ai/docs content for v2 at each gate | repo | continuous | F-CORE-124 | new | partial | MATERIAL (A29) | no | — |

## Staleness per area (SNAP `f7115470` → V1 `fb7e96ed`)

Method (reproducible with `git diff --numstat f7115470 fb7e96ed` and `git log --no-merges --full-history`; each changed file is assigned to exactly one area, first match wins):

- **Counted paths.** Kilo-owned paths: `packages/opencode/src/kilocode/**`, `packages/opencode/{test,bin}/kilocode/**`, `packages/opencode/src/kilo-sessions/**` (A16), `packages/kilo-*/**`, `packages/plugin-atomic-chat/**`. Also shared files that carry `kilocode_change` at SNAP or V1, appear in the 816-file TSV, or were touched by a Kilo commit. Every changed file in the range falls in one of these (0 upstream-only files).
- **Kilo-owned paths by keyword on the sub-path,** in this order: A28 claw/image/speech → A27 atomic-chat → A26 anaconda → A07 session-export/import/portability/resume/cloud-session → A31 legacy-migration/roo/migrate → A20 cloud → A10 memory → A11 indexing/semantic-search/lancedb/embedding → A12 sandbox → A13 telemetry/feedback → A14 mcp/marketplace → A24 autocomplete/fim/edit/code-action/branch-name/commit-message/enhance-prompt/editor-context → A16 remote/presence/send-file → A17 share → A15 agent-manager/worktree/board/background-process/notebook/pr-link/git-refs → A03 auth/gateway/balance/profile/organization/provider-usage/console/caffeination → A04 provider/model-*/routed-model/system-prompt/catalog → A05 config/migrator/overlay → A06 session/snapshot/task-resume/wakeup/cron/compaction/goal/cost → A08 agent/plan/review/command/skill/rules/workflow/mode → A09 tool/permission/question/bash-hierarchy/suggestion/ts-check/websearch/shell/pty → A32 security/pii/encoding/ignore → A02 daemon/server/instance/parent-watchdog/event/effect/process/bootstrap/project/network/watcher → A01 paths/const/project-id/storage/database/log → A21 installation/bin → A18 cli/acp/help/docs/run → A19 tui/components/plugins/theme/logo → A30 plugin.
- **Package-level rules.** `kilo-vscode` → A28/A26/A31/A24/A15/A14/A13/A12/A11/A16 by feature directory, `webview-ui/**` → A23, build files → A21, else A22. `kilo-jetbrains` → A25. `kilo-docs`, `kilo-web-ui`, `kilo-console` → A29. `kilo-ui`, `kilo-i18n`, `packages/{ui,session-ui,storybook}` → A23. `.github/**`, `script/**`, `nix/**`, `patches/**`, `.changeset/**`, root manifests and `packages/opencode/{package.json,CHANGELOG.md,script/}` → A21.
- **Shared files by directory.** `share/` A17; `acp/`, `cli/` A18; `cli/cmd/tui`, `packages/tui` A19; `session/`, `snapshot/` A06; `provider/` A04; `config/` A05; `mcp/` A14; `tool/`, `permission/`, `question/`, `pty/` A09; `agent/`, `command/`, `skill/` A08; `worktree/` A15; `installation/` A21; `auth/` A03; `storage/`, `database/` A01; `plugin/`, `packages/{sdk,llm,plugin,client}` A30; `server/`, `project/`, `bus/`, `effect/`, events, lsp, filesystem A02.
- **Counting.** Commits are non-merge. `sig` excludes release, chore, docs, test, style and ci commits. Release bumps touching every `packages/kilo-*/package.json` are excluded from `sig`.

| Area | Files (A/D/M) | +/− | Kilo commits (sig) | Verdict | What changed |
|---|---|---|---|---|---|
| A01 Identity/store | 16 (5/0/11) | +474/−168 | 12 (10) | SMALL | WAL recovery, interrupted first access, project-ID cache |
| A02 Daemon/server | 97 (13/0/84) | +4,042/−1,011 | 161 (112) | MATERIAL | `/reload` reloads project (#14103), serve shutdown deadline, DB reclaim (#14540), event bridge, startup perf |
| A03 Gateway/account | 39 (17/0/22) | +4,494/−728 | 80 (44) | MATERIAL | Provider usage center (#11611), Codex usage (#13519), org default model, credential precedence, caffeinate |
| A04 Provider/catalog | 42 (20/1/21) | +3,605/−668 | 56 (47) | MATERIAL | Catalog recovery (#14723), malformed provider tolerance (#14794), cache breakpoints, task model selection (#13557) |
| A05 Config | 99 (72/0/27) | +5,020/−233 | 55 (52) | MATERIAL | New keys (`memory_model`, swarm, PTC, task model, cleanup), overlay write errors; 61 upstream config fixtures |
| A06 Session policy | 165 (84/1/80) | +24,599/−1,246 | 203 (177) | MATERIAL + NEW | Goals, wakeups/cron, steering, background agents survive stop, deferred title, compaction fix, ~128 fixes, conn-reset retry (#14893) |
| A07 Portability/import | 14 (4/2/8) | +1,852/−258 | 22 (17) | MATERIAL | Claude/Codex import, server-side migrate API (#13294), cloud transcript import (#13483) |
| A08 Agents/plan/skills | 44 (18/4/22) | +4,172/−1,275 | 78 (70) | MATERIAL | Task subagent model selection, agent requirements removed, agent-created plans open |
| A09 Tools/permissions | 91 (30/12/49) | +5,355/−1,870 | 117 (102) | MATERIAL + NEW | link_pr, cron/wakeup tools, self-context tools, PTC, preselected answers, rejection feedback; interactive terminal removed |
| A10 Memory | 12 (0/0/12) | +341/−52 | 47 (10) | SMALL | `memory_model` with fallback; SSE auto-save fix |
| A11 Indexing | 35 (5/0/30) | +2,118/−737 | 85 (47) | MATERIAL (moderate) | Semantic search reporting, embedder dimension fixes, root/home safeguards, watcher swap, VS Code consent |
| A12 Sandbox | 21 (6/0/15) | +1,293/−33 | 59 (23) | MATERIAL (policy) | Git classifier, prompt before sandboxed git writes, offline mutation worker |
| A13 Telemetry | 11 (2/0/9) | +238/−36 | 46 (6) | SMALL | Identity dedupe, lifecycle person props, autocomplete failure sampling |
| A14 MCP/marketplace | 104 (69/5/30) | +8,401/−1,530 | 52 (47) | MATERIAL + NEW | Marketplace in CLI API, npm/git plugin install, MCP OAuth in core, MCP Apps, CIMD |
| A15 Agent coordination | 406 (201/4/201) | +55,004/−8,654 | 560 (533) | MATERIAL + NEW | Shared boards, Agent Manager multi-project, browser previews, PTY durability |
| A16 Remote | 24 (9/0/15) | +6,644/−292 | 34 (31) | MATERIAL | PR linking, instance identity, messageID forward, directory listing, session log |
| A17 Sharing | 0 | 0 | 0 | EMPTY | — |
| A18 CLI/ACP | 72 (12/3/57) | +3,264/−1,115 | 72 (61) | MATERIAL | `kilo worktree`, caffeinate, cloud stdin, clickable links, ACP changes |
| A19 TUI | 47 (14/1/32) | +2,720/−666 | 106 (64) | MATERIAL | Subagent steering UI, last-commit diff, About dialog, goal UI, new plugins |
| A20 Cloud CLI | 6 (3/0/3) | +365/−32 | 4 (4) | SMALL | Stdin prompts (#13851) |
| A21 Packaging/CI | 176 (94/7/75) | +17,076/−1,486 | 402 (269) | MATERIAL | SBOMs (#14513), Windows AVX2 launcher, 47 workflow files |
| A22 VS Code host | 527 (273/13/241) | +64,678/−5,971 | 728 (613) | MATERIAL | Browser tab, settings search, session tabs, MCP OAuth sign-in, speech source |
| A23 Webview/shared UI | 545 (198/44/303) | +49,247/−15,679 | 671 (606) | MATERIAL | `kilo-ui` +5,843/−1,335 and webview changes |
| A24 Editor services | 16 (2/0/14) | +386/−70 | 18 (13) | SMALL | Shared FIM model selection, quick-fix code action, add-to-context, commit-message errors |
| A25 JetBrains | 873 (513/13/347) | +108,897/−7,992 | 627 (518) | MATERIAL | MCP OAuth, swarm board, session cleanup, checkpoint settings, prompt navigator |
| A26 Anaconda | 0 | 0 | 0 | EMPTY | — |
| A27 Atomic chat | 1 | +1/−1 | 0 sig | EMPTY | Version bump only |
| A28 Voice/image/Claw | 28 (4/11/13) | +606/−2,541 | 10 (9) | SMALL | KiloClaw removed (#14209), custom STT source |
| A29 Docs/web/console | 419 (131/54/234) | +4,773/−3,958 | 393 (110) | MATERIAL (content) | Docs syncs |
| A30 SDK/llm/plugin | 47 (6/0/41) | +9,683/−3,408 | 135 (90) | SMALL for Kilo | Mostly upstream regen; regenerate |
| A31 Legacy migration | 10 (2/4/4) | +243/−2,372 | 3 (3) | MATERIAL (removal) | VS Code Kilo-classic migration removed (#13605) |
| A32 Security/PII | 1 | +1/−0 | 1 (1) | SMALL | One line in `pii.ts` |

### Unassessed gap `d99662338..f7115470`

The 816-file assessment was pinned at `d99662338` (2026-08-10), not at SNAP. Files changed in the 800 commits between them were never assessed. Same path sets and classifier as above; 732 files in total. "Non-meta" excludes `.changeset`, `package.json` and `CHANGELOG` churn.

| Area | Files (non-meta) | +/− | Effect on the verdict above |
|---|---|---|---|
| A01 | 2 (2) | +82/−7 | none (database migration compat) |
| A02 | 13 (12) | +127/−55 | none (already MATERIAL) |
| A03 | 3 (2) | +62/−3 | none |
| A04 | 10 (10) | +1,514/−312 | none |
| A05 | 10 (10) | +625/−44 | none |
| A06 | 21 (21) | +1,082/−352 | none; touches `core/src/session/compaction.ts`, `runner/llm.ts`, `opencode/src/session/{processor,prompt}.ts`, which matters for U-E2-01/02 fixtures |
| A08 | 3 (3) | +30/−21 | none |
| A09 | 21 (21) | +123,945/−67,036 | none (dominated by a large generated or fixture file; UNVERIFIED which) |
| A10 | 1 (0) | +1/−1 | none (version bump) |
| A11 | 3 (2) | +15/−37 | none |
| A12 | 3 (2) | +2/−11 | none |
| A13 | 1 (0) | +1/−1 | none |
| A14 | 10 (10) | +1,540/−1,944 | none |
| A15 | 57 (57) | +2,164/−344 | none |
| A16 | 1 (1) | +0/−1 | none |
| A17 | 0 | 0 | stays EMPTY |
| A18 | 10 (10) | +179/−42 | none |
| A19 | 17 (16) | +375/−49 | none |
| A20 | 0 | 0 | stays SMALL |
| A21 | 116 (30) | +2,401/−1,709 | none |
| A22 | 18 (17) | +1,096/−52 | none |
| A23 | 204 (199) | +11,460/−1,826 | none |
| A24 | 0 | 0 | stays SMALL |
| A25 | 55 (53) | +1,442/−163 | none |
| A26 | 0 | 0 | stays EMPTY |
| A27 | 1 (0) | +1/−1 | stays EMPTY |
| A28 | 0 | 0 | stays SMALL |
| A29 | 32 (29) | +212/−22 | none |
| A30 | 22 (17) | +703/−32 | none |
| A31, A32 | 0 | 0 | unchanged |
| Unclassified (shared misc, repo meta) | 98 (89) | +38,198/−118 | for L2 to disposition |

No area verdict changes: every area that moved in the gap is already MATERIAL, and the EMPTY/SMALL areas did not move. The first L2 sweep should still start from `d99662338`, so that each gap file gets a file-level disposition.

## Donor facts

| Fact | Value |
|---|---|
| Donor upstream base | `59b29de409` (2026-09-03); 1,454 upstream commits behind BASE |
| Donor Kilo packages | `kilo-cli` (278 files), `kilo-gateway` (18, a rewrite), `kilo-memory` (67), `kilo-indexing` (121), `kilo-client` (4), `kilo-vscode` (1,106, SNAP-era plus 25 v2 backend adapters), `kilo-ui` (241), `kilo-ide-ui` (1,755, vendored V1 `packages/ui`), `kilo-i18n` (22), `packages/schema/src/kilocode` (10 RPC defs), `packages/ai/src/kilocode` (3) |
| Missing in donor | `kilo-jetbrains`, `kilo-sandbox`, `kilo-telemetry`, `kilo-docs`, `kilo-web-ui`, `kilo-console`, `plugin-atomic-chat` |
| Donor shared patches | 29 files with `kilocode_change` (core 5, plugin 1, theme 4, tui 14, plus tests). Drift on them to BASE: +2,325/−2,726. Deleted at BASE: `core/src/plugin/system-prompt.ts`, `theme/src/tui/defaults.ts`, `theme/src/tui/fallback.ts` |
| Stable seams | `schema/src/rpc.ts` (0 changes), `plugin/src/effect/plugin.ts` (+8/−4), `plugin/src/effect/rpc.ts` (+3/−3), `server/src/fetch.ts` overrides (+2/−2) |
| Summary | Donor mechanism (host overrides, plugin+RPC registration, schema RPC defs) sits on seams that barely moved. Donor shared patches in TUI, theme, system prompt and MCP sit on files that moved a lot or were deleted. Donor behavior is SNAP-era. Whether donor tests pass at BASE is UNVERIFIED (not run) |

## Issue coverage

Every issue in the #13750 tree maps to a unit or is closed out as a tracker.

| Issue | Unit | Issue | Unit |
|---|---|---|---|
| #13750 | tracker (plan root) | #14402 | U-E4-01 |
| #14016 | tracker → E6 | #14403 | U-E4-02 |
| #14017 | tracker → E2, E9 | #14404 | U-E4-03 |
| #14018 | tracker → E5 (+E11) | #14405 | U-E4-04 |
| #14019 | tracker → E4 | #14406 | U-E4-05 |
| #14020 | tracker → E3 | #14407 | U-E4-08 |
| #14021 | tracker → E2 (generation), E6 (editor services) | #14408 | U-E3-08 |
| #14022 | tracker → E7 | #14409 | U-E3-07 |
| #14023 | tracker → E10 | #14410 | U-E3-06 |
| #14024 | tracker → E10 | #14411 | U-E3-07 |
| #14371 | U-E2-01 | #14412 | U-E3-07 |
| #14372 | U-E2-02 | #14413 | U-E3-01 (+ U-E3-02, U-E3-03) |
| #14373 | U-E2-03 | #14414 | U-E3-11 (G1 child; G2/G3 children later) |
| #14374 | U-E2-04 | #14415 | U-E6-08 (evidence: `editor-services-inventory.md`) |
| #14375 | U-E9-09 | #14416 | U-E6-08 |
| #14376 | U-E11-04 | #14417 | U-E6-07 |
| #14377 | U-E9-10 | #14418 | U-E11-01 |
| #14378 | U-E9-12 (alerts, sound) + U-E11-04 (tables, bindings) | #14419 | U-E11-02 (image) + U-E11-06 (Claw) |
| #14379 | U-E9-11 | #14420 | U-E7-01 |
| #14380 | U-E2-05 | #14421 | U-E7-02 |
| #14381 | U-L3-01 | #14422 | U-E7-03 |
| #14382 | U-E2-13 | #14423 | U-E7-04 |
| #14383 | U-E6-01 | #14424 | U-E7-06 |
| #14384 | U-E6-03 | #14425 | U-E10-01 (evidence) |
| #14385 | U-E6-04 | #14426 | U-E10-01 (evidence) |
| #14386 | U-E6-05 | #14427 | U-E10-01 |
| #14387 | U-E6-02 | #14428 | U-E10-01 |
| #14388 | U-E6-06 | #14429 | U-E10-02 |
| #14389 | U-E6-07 | #14430 | U-E10-02 |
| #14390 | U-E6-09 | #14431 | U-E10-02 |
| #14391 | U-E2-27 (+ VS Code consumer in E6) | #14432 | U-E10-02 |
| #14392 | U-E6-12 | #14396 | U-E5-01 |
| #14393 | U-E6-13 | #14397 | U-E5-02 |
| #14394 | U-E6-14 | #14398 | U-E5-03 |
| #14395 | U-E4-06 (host) + U-E6-15 (VS Code) | #14399 | U-E5-04 (fail-closed) + U-E11-03 (ownership) |
| #14400 | U-E11-03 | #14401 | U-E5-05 |

## Old-plan units (N1–N17) re-homed

| Old unit | Disposition on the clean base |
|---|---|
| N1 consolidation merge and scope-rename codemod | not-needed: the base is already a clean upstream commit with the `@opencode/*` scope. Code copied from the donor still needs the rename at copy time (each unit) |
| N2 ratchet | U-L3-01 |
| N3 sync automation and e2e lane | U-L1-01 (+ U-E0-04 for the CI lane) |
| N4 delta sweep | U-L2-01 |
| N5 v1 reference fixtures | U-E0-05 |
| N6a package assessment | folded into U-E8-03 and U-E9-14; `kilo-console` obsolete |
| N6b package imports onto the old branch | not-needed as a unit: each package lands with its epic (kilo-docs via U-E8-03/U-L5-01, kilo-jetbrains via E7) |
| N7 progress-plan alignment | not-needed: the old progress plan is archived; the new plan replaces it (D9) |
| N8 customer v2 store identity | U-E1-02 |
| N9 handshake and extension switch | U-E1-08 (server side) + E6 (client side) |
| N10 v1 retirement | U-E8-01, U-E8-02, U-E8-04 |
| N11 gate acceptance runs | U-L4-01 |
| N12 TUI picker, dialogs, status/footer | U-E9-06, U-E9-07 |
| N13 runtime integration remainder | U-E2-18…U-E2-21 |
| N14 original-extension consumers | E6 |
| N15, N16 scenario sets | U-L4-01 |
| N17 preview release train | U-E3-10 |

## Open questions

Questions are recorded where they become actionable, not answered up front. Each has a trigger: the unit whose start is the deadline for the answer. The coordinator raises a question with the named owners when its trigger unit is about to start. Nothing listed here blocks work that starts earlier.

### Deferred to the VS Code track (G2)

| ID | Question | Trigger | Owners to involve | Evidence |
|---|---|---|---|---|
| Q-G2-01 | When does `main` flip to v2? The v1 VS Code build compiles its bundled CLI from `packages/opencode` in the same tree. Options: flip only after G2 and G3, or build v1 IDE releases from the `v1` branch after the flip | Before any change to `main`; at the latest when E6 starts (U-E6-01) | VS Code owners, release owner | `packages/kilo-vscode/script/local-bin.ts` at V1 |
| Q-G2-02 | Capability handshake shape (what the extension reads to detect a v2 backend), shared with JetBrains | U-E6-02 (server side U-E1-08 can ship a minimal version first) | VS Code and JetBrains owners | `packages/kilo-vscode/src/features.ts` already probes `experimental.capabilities.get` |
| Q-G2-03 | First-launch import UX in the extension, and mapping of v1 extension `globalState` and secrets | U-E6-02 | VS Code owners | Old plan N9 (`kilo-opencode-v2-execution-plan.md:270-274`) |
| Q-G2-04 | Restricted Mode key conflict in the preview, and desktop verification of the Stop fix | U-E6-03 | VS Code owners | Old plan line 25; working log 2026-09-08 |
| Q-G2-05 | Message-deletion semantics on event-sourced v2 sessions (delete vs revert vs tombstone) | U-E2-05 | VS Code owners, core owner | #14380; `v2-v1-session-diffs.md` |
| Q-G2-06 | Agent Manager control-plane contract on v2 (worktree routing, ask/reply/reject, multi-project) | U-E2-27 | VS Code owners | #14391; V1 `kilocode/agent-manager/*` |
| Q-G2-07 | Confirm post-cutover for VS Code experimental settings: browser automation, conversation prompt history, Claude migration, native notebook tools | E6 kickoff | VS Code owners | Inventory Part 3, F-VSC-025…028 |
| Q-G2-08 | Name and channel of the v2 extension build that bundles the v2 binary | U-E6-19 | VS Code owners, release owner | Depends on Q-DIST-01 |

### Deferred to the JetBrains track (G3)

| ID | Question | Trigger | Owners to involve | Evidence |
|---|---|---|---|---|
| Q-G3-01 | Is FIM/next-edit a G3 hard gate (Decision 7), given that V1 JetBrains has no FIM producer or consumer, only migrated autocomplete settings? | U-E7-01 | JetBrains owners | Inventory Part 3, "FIM at V1 JetBrains" |
| Q-G3-02 | Kilo plugin RPC endpoints (`/api/rpc/:rpcID/:method`) may not appear in the assembled OpenAPI that the JetBrains Kotlin client is generated from. How does the plugin reach Kilo-specific operations? | U-E7-01 | JetBrains owners, core owner | `packages/kilo-jetbrains/backend/build.gradle.kts:11-21`; BASE `protocol/src/groups/rpc` (UNVERIFIED coverage in OpenAPI) |
| Q-G3-03 | Which v2 CLI release the plugin pins, and how the `jetbrains/v*` release line maps to it | U-E7-02 | JetBrains owners, release owner | `kilo.cli.pinned`, `packages/kilo-jetbrains/package.json` |
| Q-G3-04 | Supported IDE products and versions, and split-mode support, for validation | U-E7-06 | JetBrains owners | #14424 |
| Q-G3-05 | Is the legacy v5 plugin migration still needed on v2? | U-E7-05 | JetBrains owners | `backend/.../migration/*` at V1 |

### Other deferred questions

| ID | Question | Trigger | Owners to involve | Evidence |
|---|---|---|---|---|
| Q-DIST-01 | Binary name and npm channel for v2 (the cloud owners proposed a `kilo2` binary on npm `next` on 2026-10-07), and how v1 IDEs are kept from resolving the v2 binary | **Must be decided before cutting any beta or preview release that is distributed** (first one: U-E3-10 preview train); also blocks U-E3-12 and U-E6-19. Recorded in `migration-context.md`, Deferred decisions | Release owner, cloud owners | `technical-notes/baseline/cloud-agent-contracts.md:40-47` |
| Q-EXT-01 | Gate attachment for cloud agents (independent pin `@kilocode/cli@7.8.1`) | U-E10-01 | Cloud owners | `cloud-agent-consumers.md:48-63` |
| Q-EXT-02 | Anaconda Desktop integration mode and the surface it gates | U-E10-02 (#14429) | Anaconda Desktop owners | #14429–#14432 |
| Q-PROD-01 | Ship, hide or defer upstream's desktop/web app and pairing | U-E9-15 (U-E4-05 for pairing) | Product owner | Inventory Part 4 (F-V2-037, F-V2-049) |

### Resolved by the user (2026-10-12)

| ID | Resolution | Recorded in |
|---|---|---|
| Q-NOW-01 | Decision 7's experimental-flag rule applies only to features that are off by default on v1. Background subagents and the shared agent board are gating (U-E2-07, U-E2-24) | `migration-context.md`, Decision 7 |
| Q-NOW-02 | Note added: the assessment reviewed `d99662338e`; the first L2 sweep starts there | `migration-context.md`, pinned refs |
