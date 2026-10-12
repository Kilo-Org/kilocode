# Epic taxonomy (validated)

Status: discovery output, 2026-10-11. Single writer: discovery analyst. The planner owns the final epic list. This file proposes it with evidence. Feature facts live in `v2-feature-inventory.md`; units, gates, staleness and donor verdicts live in `v2-unit-register.md`.

## Why

Every feature, chore and task must sit in exactly one epic and one surface, so that gate readiness can be counted without double-booking. The brief supplied a starting set (E0–E8 plus L). This file tests that set against both inventories, records each change with its reason, and gives each epic concrete exit criteria.

## Result

| Epic | Name | Gate | Surface(s) | Change vs starting set |
|---|---|---|---|---|
| E0 | Foundation | pre-gate (blocks all) | repo, shared runtime | kept, scope narrowed to one-time setup |
| E1 | Core and identity | G1 (prerequisite for G2/G3) | shared runtime, gateway | kept |
| E2 | Runtime behavior | G1 (some units G2) | shared runtime | **renamed and split** from "CLI/TUI runtime" |
| E9 | CLI/TUI surface | G1 | CLI/TUI | **new** (split out of E2) |
| E3 | Import and distribution | G1 (per-surface children later) | packaging, import | kept |
| E4 | Remote sessions | G1 | gateway/cloud, CLI/TUI | kept |
| E5 | Sharing | G1 | gateway/cloud, CLI/TUI | kept; non-gating sharing moved to E11 |
| E6 | VS Code track | G2 | VS Code, editor services | kept; owns the FIM/next-edit producer |
| E7 | JetBrains track | G3 | JetBrains | kept |
| E10 | External consumers | set per consumer (Decision 7) | cloud agents, Anaconda Desktop, other CLI consumers | **new** |
| E8 | Retirement | after G3 | repo, storage | kept; scope made explicit |
| E11 | Post-cutover backlog | post-cutover | mixed | **new** |
| L | Cross-cutting lanes (L1–L5) | continuous | repo | kept, split into five named lanes |

## Changes and reasons

| Change | Reason and evidence |
|---|---|
| **Split E2 into E2 Runtime behavior and E9 CLI/TUI surface** | The starting E2 "CLI/TUI runtime" would hold about 70 of 129 core features (A06, A08–A15, A18, A19). Two populations live there. Runtime policy lives in `packages/core` seams, Kilo plugins and engines, and G2/G3 consume it: message deletion (#14380), Agent Manager contracts (#14391), generation endpoints (#14389), skill/agent removal (#14393). Presentation lives in `packages/tui` and the CLI, and only G1 consumes it. The old plan already had to serialize every TUI issue on the same files (`kilo-opencode-v2-execution-plan.md:112`). The split gives the IDE tracks a clean dependency on E2 without waiting on TUI work. New ID E9 avoids renumbering the brief's epics |
| **New E10 External consumers** | Decision 7 says cloud agents and Anaconda Desktop gate "whichever surface they consume", so they belong to no single surface epic. Discovery evidence shows they consume the CLI package, not an IDE. `cloud-agent-next` pins `@kilocode/cli@7.8.1`; the auto-routing benchmark and MCP-catalog CI float on `@latest` (`technical-notes/baseline/cloud-agent-consumers.md:48-63`). Anaconda Desktop embeds Kilo, and V1 ships an `anaconda-desktop` provider (`packages/opencode/src/kilocode/anaconda-desktop/*`). Other CLI consumers would otherwise be orphans: the Zed extension (`packages/extensions/zed`) and the GitHub Action (`github/action.yml`). One epic gives the "npm `latest` flip" risk an owner |
| **New E11 Post-cutover backlog** | Decision 7 lists non-gating scope (voice, image generation, team and incremental sharing, legacy TUI extras, default-off experimental features). Leaving these inside E4–E7 would make those epics' exit criteria ambiguous ("done except…"). Moving them gives gate epics crisp exits and a single place for ship/defer/drop decisions. KiloClaw is recorded here as not-needed (removed on V1, `3eaf47ba52`) so it has a home |
| **E0 narrowed to one-time setup** | Recurring work (upstream merges, v1 delta sweeps, shared-patch ratchet, acceptance runs, docs) is continuous and has no exit. It moves to named lanes L1–L5, so E0 can actually finish |
| **E5 keeps individual sharing as gating** | Individual share/unshare/fork-from-share and the public viewer for v2 messages are v1 CLI features. The old plan already made them G1 (`execution-plan.md:69`). Team ownership (#14399 ownership part) and incremental sync (#14400) are post-cutover (Decision 7) and go to E11. The fail-closed refusal of team upload stays in E5 |
| **FIM/next-edit producer in E6, consumed by E7** | One home per unit. VS Code is the first consumer. The producer is a gateway endpoint plus an editor-side engine (`kilo-gateway/src/{fim,edit,autocomplete}.ts`). E7 takes a dependency only if the G3 FIM gate stays: V1 JetBrains has no FIM producer or consumer, only migrated autocomplete settings (`packages/kilo-jetbrains/frontend/.../autocomplete/KiloAutocompleteSettingsService.kt`; see inventory Part 3). Deferred as Q-G3-01 in the register, to settle at U-E7-01 with the JetBrains owners |
| **Presence split across E4 and E6** | #14395 has a host-registration part (CLI remote, G1) and a VS Code visibility-reporting part (G2). The old plan split it the same way; this taxonomy keeps it as two units in two epics |
| **No separate "Editor services" epic** | #14021 was a subissue, but its consumers are the IDE tracks. Its runtime-side generation endpoints (enhance prompt, commit message, branch name) are E2; its editor consumers are E6/E7. That avoids a second epic with a split gate |
| **Dropped: Phase 0 "create issues" as an epic** | Issue creation is user work (brief: "leave issue creation to the user"). It is a planner checklist item, not an epic |

Considered and rejected:

| Option | Why not |
|---|---|
| Merge E4 and E5 (both talk to Kilo cloud) | Different backends and contracts: relay `ingest.kilosessions.ai` vs the share API in `services/session-ingest` (`technical-notes/session-sharing.md`). Different external verifications (#14401, #14407). Keep separate |
| Split E3 into Import and Distribution | They share the cutover runbook and the store decision (D6). Each half is too small alone. Revisit if E3 exceeds about 15 units |
| Put engines (memory, indexing, sandbox, telemetry) in their own epic | Each is one or two units. They share E2's seams (plugin, RPC, host composition) and gate together at G1 |
| Treat the desktop/Electron app as an epic | Kilo v1 has no counterpart. A product-disposition unit in E9 (ship, hide or defer) is enough until the user decides otherwise |

## Surfaces

Each unit has exactly one surface.

| Surface | Meaning |
|---|---|
| shared runtime | Server, core policy, Kilo plugins and engines; consumed by every client |
| gateway/cloud | Code that talks to Kilo cloud services (gateway, relay, share, ingest, cloud agents) |
| CLI/TUI | Terminal product surface |
| packaging | Build, release, update, install, CI |
| import | v1 data, config and credential import into the v2 store |
| VS Code | Extension host and webviews |
| JetBrains | JetBrains plugin |
| external consumer | A product outside this repo that consumes the Kilo CLI |
| repo | Docs, conventions, branches, lanes |

## Epics

### E0 Foundation

- **Why:** the clean base has no Kilo package at all (`git ls-tree HEAD packages/` lists only upstream packages). Every other epic needs a host, a registration pattern and a working CI signal first.
- **What:** Kilo host/composition package; Kilo RPC and plugin scaffolding; re-landed Kilo `AGENTS.md`, rewritten fork conventions and migration-tracking index; Kilo CI lane on Kilo's `origin/v2`; disable or neutralize upstream workflows and publish targets that must not run from the fork; v1 reference fixtures for the runtime-policy units.
- **Exit criteria:**
  - A Kilo host package builds and starts an isolated server through public seams only, verified by a service smoke test.
  - One sample Kilo RPC, registered as a plugin, passes a round-trip test through the generated client.
  - A Kilo-owned workflow runs `bun run check` and package tests on PRs to `origin/v2`, with results compared to `pinned-v2-baseline.md`.
  - No upstream publish or deploy workflow can publish from the fork, verified by reading each workflow's trigger and repository guard.
  - `AGENTS.md` and `v2-fork-conventions.md` name the Kilo integration branch `origin/v2`, BASE and the AGENTS branch rules.
  - v1 reference fixtures for offline wait, overflow, slow snapshot and snapshot retention are committed and replayable.

### E1 Core and identity

- **Why:** product identity, the separate store (D6), Gateway login and the model catalog are prerequisites for every surface.
- **What:** branding and default theme; customer v2 store and paths; Gateway auth/profile/org/Pass/errors; Gateway provider, catalog, routing and options; system-prompt selectors; usage and cost accounting; Kilo config layer; Kilo server extension surface (RPC groups, parent watchdog, reload, capability handshake).
- **Exit criteria:**
  - v1 and v2 run side by side on one machine. A v2 boot never opens a v1 file, verified by a filesystem-access test against a seeded v1 store.
  - Device login, org switch and logout work against the deployed Gateway (external-gated acceptance recorded with SHA).
  - Kilo catalog models are selectable and requests carry Kilo headers, verified by a request-capture test.
  - All eight prompt selectors resolve on BASE seams, verified by a wire test.
  - Each supported Kilo config key folds or is refused with a diagnostic, never silently dropped.
  - Shared-file patches introduced by E1 are counted by the L3 ratchet, each with a stated missing seam.

### E2 Runtime behavior

- **Why:** V1 policy on top of generic runtime services must survive, and the IDE tracks consume it.
- **What:** session policy (offline wait, overflow, snapshots, deletion, drain, subagents, wakeups, goals, retention, recall); agents, plan, review, commands, skills, rules; Kilo tools and permission policy; memory, indexing, sandbox, telemetry; MCP deltas and marketplace; board, background processes, worktree runtime, Agent Manager host contract; generation endpoints; Atomic Chat provider.
- **Exit criteria:**
  - Every E2 unit with gate G1 passes its acceptance against the E0 v1 reference fixtures where one exists.
  - Every native-equivalence claim in the inventory is backed by a test covering scope, errors, cancellation, persistence and presentation.
  - G2-gated E2 units (message deletion, Agent Manager contract, generation endpoints, removal callers) expose public contracts that the generated client consumes.
  - No client package imports Core or Server internals (L3 ratchet count is 0 for client→Core/Server).

### E9 CLI/TUI surface

- **Why:** G1 ships the terminal product. It needs Kilo commands, headless behavior and presentation, not just runtime parity.
- **What:** service/daemon UX; Kilo command set and help/docs generation; `kilo run`; ACP host; TUI shell, slash commands and dialogs; home and sidebar plugins; model picker and info; notifications; session scope switching; location/event filtering; alerts and sound; display and privacy preferences; `kilo cloud`; embedded web UI decision; disposition of upstream-only surfaces (desktop, web app).
- **Exit criteria:**
  - Every G1 CLI/TUI scenario in the rewritten test plan passes on an isolated real host (L4), recorded with SHA.
  - `kilo --help --all` lists the V1 Kilo command set or an explicit removal note for each missing command.
  - A product decision is recorded for each upstream-only surface (desktop, web app, pairing) and implemented: shipped, hidden or deferred.

### E3 Import and distribution

- **Why:** customers need a v2 binary that installs, updates and imports v1 data without touching v1 files (D6).
- **What:** opt-in, re-runnable import of sessions, credentials, config and legacy migrators; external transcript and cloud-session import; fork/move verification; updater; build and release pipeline incl. signing; CI hardening; SDK/plugin publishing; preview release train; canary and runbook (G1 child); binary and channel naming.
- **Exit criteria:**
  - Importing a fixture store from each supported V1 release preserves the original byte-for-byte. A second run imports only new sessions (test).
  - Signed artifacts for every V1 platform install cleanly beside v1 and update/roll back on real artifacts.
  - A v1 IDE build cannot resolve the v2 binary through PATH, global install or dist-tag (test).
  - The G1 canary runbook exists and has been exercised once.

### E4 Remote sessions

- **Why:** `kilo remote` is a V1 CLI feature, so it gates G1.
- **What:** relay wire protocol and dispatcher; transcript, attachments and file delivery; suggestions; detach/exit/heartbeat; metadata and capabilities (incl. headless link and upstream-pairing coexistence); presence host registration; PR linking; deployed acceptance.
- **Exit criteria:**
  - Local contract tests pass for every relay message in `CLIOutboundMessageSchema`.
  - Deployed relay acceptance (#14407) is recorded with SHA, or explicitly waived by the user.
  - Unsupported capabilities are not advertised.

### E5 Sharing

- **Why:** individual share/unshare/fork-from-share and the public viewer are V1 CLI features.
- **What:** share transport; payload contract; public viewer for v2 messages; fail-closed team upload refusal; background session ingest to Kilo cloud; deployed acceptance.
- **Exit criteria:**
  - Share, unshare and fork-from-share round-trip against the deployed backend (#14401), recorded with SHA.
  - The public viewer renders self-contained v2 messages.
  - Team upload is refused with a clear message.
  - Session ingest uploads scrubbed v2 sessions, and opt-out works.

### E6 VS Code track (G2)

- **Why:** VS Code stays on v1 until G2 (D5). The deliverable is the original Kilo extension UI on the v2 backend (user decision 2026-09-08, working log lines 71-79).
- **What:** extension and webview re-copied from V1 behind v2 backend adapters; real typecheck; chat, tabs, settings, connection, auth, generation, terminals, Agent Manager, notifications/suggestions, removal callers, timeline/diff; FIM/next-edit producer and consumer; code actions; VS Code-only tools; presence visibility; handshake and store/import switch; G2 scenario set.
- **Exit criteria:**
  - `typecheck` for the extension is a real check with no skip shim.
  - Every G2 scenario passes on a real VS Code host (L4), recorded with SHA.
  - The extension never mixes v1 and v2 routes in one session, and it detects the backend through the capability handshake.
  - Rollback to the previous extension version works on untouched v1 files.

### E7 JetBrains track (G3)

- **Why:** JetBrains pins a v1 CLI version until G3 (D5). The plugin is absent from both BASE and the donor.
- **What:** contract inventory; server startup, discovery, auth and version checks; sessions, streaming, permissions, history, config; terminal and editor-service dependencies; IDE validation; G3 scenario set.
- **Exit criteria:**
  - The plugin builds from Kilo's `origin/v2` and talks to the v2 runtime only through the generated client from the assembled OpenAPI contract.
  - Every G3 scenario passes in each supported IDE, recorded with SHA.
  - Version-mismatch handling refuses incompatible CLIs with a clear message.

### E10 External consumers

- **Why:** consumers outside this repo break when the CLI changes package, binary or protocol.
- **What:** cloud agent adaptation and validation; Anaconda Desktop integration and provider; other CLI consumers (Zed extension, GitHub Action, floating `@latest` users).
- **Exit criteria:**
  - Each consumer has a recorded disposition (adapt, repackage, no change), an owner and the gate it attaches to.
  - Each gating consumer passes its validation before its gate's go/no-go.
  - No floating `@latest` consumer breaks at the dist-tag switch (verified or mitigated by pinning).

### E8 Retirement

- **Why:** the end state is Kilo's `origin/v2` as `main` and v1 on a maintenance branch (`migration-context.md`).
- **What:** branch flip and its timing relative to IDE v1 builds; path consolidation after G3 (D6); re-landing or retiring packages that deploy from `main` (docs site, console); v1 end-of-life policy.
- **Exit criteria:**
  - Every workflow and deployment that builds from `main` has a v2-side owner or is retired before the flip.
  - The v1 maintenance branch builds and releases.
  - Storage consolidation runs once, with a backup, and is never repeated.

### E11 Post-cutover backlog

- **Why:** Decision 7 non-gating scope needs one home and an explicit decision per item.
- **What:** voice/STT; image generation; team sharing ownership; incremental sharing; legacy TUI extras (theme catalogue, bindings, tables, vim); default-off experimental features; KiloClaw (recorded not-needed).
- **Exit criteria:** every item is shipped, dropped or re-scoped by a recorded user decision. Nothing here blocks a gate.

### L Cross-cutting lanes

| Lane | Scope | Exit / steady state |
|---|---|---|
| L1 Upstream sync | Merge `upstream/v2` pinned by SHA; dry-run workflow; merge tooling | Upstream lag recorded after every merge; no missed sync window without a note |
| L2 V1 delta sweep | Advance the assessment cutoff over `cutoff..origin/main`; refresh the experimental-flag list; re-run staleness for touched units | Zero unclassified Kilo-owned or marked V1 files at each gate |
| L3 Shared-patch ratchet and marker sweep | Count marked shared files, client→Core/Server imports and Kilo imports of upstream internals; #14381 | Counts at or below baseline; every increase states its seam |
| L4 Acceptance | Rewrite test plans with gate tags and V1-derived expectations; G2/G3 scenario sets; gate acceptance runs | Each gate's scenarios executed and recorded with SHA |
| L5 Docs | kilo.ai/docs content for v2; migration-tracking upkeep | Docs describe the shipped surface at each gate |

## Orphan check

Method: every row of both inventories (`v2-feature-inventory.md` Parts 1–4) and every issue in #13750's tree has a Unit, and every unit has one epic, one surface and one gate (`v2-unit-register.md`).

| Candidate orphan | Decision |
|---|---|
| Cloud agents (#14023, #14425–#14428) | E10 (new) |
| Anaconda Desktop (#14024, #14429–#14432) and the V1 `anaconda-desktop` provider | E10, one unit |
| Zed extension, GitHub Action, floating `@latest` consumers | E10 |
| Voice, image generation, team/incremental sharing, legacy TUI extras, experimental features | E11 (new) |
| KiloClaw | E11, not-needed |
| `kilo-console` (deprecated) | E8 retire |
| kilo-docs site | content L5; survival across the branch flip E8 |
| `kilo-web-ui` and upstream web/desktop app | E9 product-disposition units |
| Upstream hosted web properties, `sdks/vscode`, `publish-vscode.yml`, CI images | E0 (keep inert, never publish from the fork) |
| v1 assessment-cutoff advance and experimental-flag refresh | L2 |
| #14381 marker sweep | L3 |
| Old-plan units without issues (N1–N17) | Re-homed in the register; N1 (consolidation merge) and N6b (import onto old branch) are not-needed on the clean base |
| Progress-plan rows without issues (old N12–N14) | Re-homed as E9 and E6 units |

No orphans remain after these placements. The unit register lists every placement.
