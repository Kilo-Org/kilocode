# Test Pipeline Architecture & Refactoring Roadmap

This document outlines the architectural plan to transition Kilo's testing pipeline from the legacy process-per-file model (~6-9 minutes on CI) to a deterministic, in-process testing model (<2-3 minutes total CI, <30 seconds for local unit passes).

Tracking Issue: [#12986](https://github.com/Kilo-Org/kilocode/issues/12986)

---

## 1. Problem Statement & Bottleneck Analysis

Currently, running unit tests in `packages/opencode` spawns 651 separate OS child processes (`script/test-runner.ts`) to avoid cross-test contamination from legacy singletons and disk-backed SQLite databases. Spawning 651 child processes adds ~500-800 seconds of pure TypeScript parsing and bundle initialization overhead.

### Current CI Platform Timings (PR Checks)

| Platform / Job | Runner | Current Duration | Bottleneck / Root Cause |
|---|---|---|---|
| **Linux Unit Tests** | `blacksmith-4vcpu-ubuntu-2404` | **6m 55s - 8m 46s** | Only 2 shards for 651 files (~325 files/shard; ~80 files per core). |
| **Windows Unit Tests** | `blacksmith-4vcpu-windows-2025` | **7m 45s - 9m 12s** | 4 shards, concurrency 2; slow process spawn (`CreateProcessW` + Defender). |
| **HttpApi Exerciser** | `blacksmith-8vcpu-ubuntu-2404` | **6m 08s - 7m 16s** | Runs ~150 scenarios serially; defaults every scenario to `git: true` temp repo. |
| **macOS Unit Tests** | `macos-15` | **3m 08s - 4m 16s** | Runs curated `darwin` profile (~60 files). |
| **JetBrains / VS Code** | `blacksmith-4vcpu-ubuntu-2404` | **~1m 15s** | Already fast and well-cached. |

---

## 2. Target Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Tier 3: Apps & Integration Shells                               │
│  (packages/opencode CLI, packages/kilo-vscode, TUI, HTTP Server) │
│  - Composition Root only: builds layers, parses CLI args.        │
│  - Concrete OS adapters (node-pty, seatbelt, git worktree).      │
└────────────────────────────────┬─────────────────────────────────┘
                                 │ depends on
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  Tier 2: Domain Services & Aggregate Roots (packages/core)       │
│  - Pure Effect Services (SessionV2, SessionInput, Catalog, etc.)  │
│  - Event Sourcing (EventV2), Projections (SessionProjector).     │
│  - ZERO backward imports from packages/opencode or vscode.       │
└────────────────────────────────┬─────────────────────────────────┘
                                 │ depends on
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  Tier 1: Protocol & Pure Engine (packages/llm, packages/schema)  │
│  - Pure schemas, protocol state machines, LLM client transforms. │
│  - ZERO filesystem, database, or environment dependencies.       │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Parallel Refactoring Work Packages

These 4 work packages are strictly orthogonal, operate on disjoint file trees, and can be executed concurrently by separate agents or worktrees without merge conflicts.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       4 PARALLEL REFACTORING WORK PACKAGES                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ Agent 1: Provider & Model Domain (Pure In-Process Test Migration)           │
│   • Scope: packages/opencode/test/provider/, packages/opencode/src/tool/   │
│   • Goal: Migrate 225+ pure transform tests to fast in-process bun test;    │
│           eliminate 3 tool process.env reads.                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ Agent 2: Storage & Database Domain (Injectable Root & Fail-Closed Memory DB)│
│   • Scope: packages/opencode/src/storage/, test/storage/                    │
│   • Goal: Make Storage.layer({ dir }) injectable; remove filesystem         │
│           remapping hack; enforce fail-closed KILO_DB=":memory:".           │
├─────────────────────────────────────────────────────────────────────────────┤
│ Agent 3: Kilo Singletons Extraction (InstanceState.make -> Scoped Services) │
│   • Scope: packages/opencode/src/kilocode/{notebook, terminal, background,  │
│           project-id, agent-manager}                                        │
│   • Goal: Refactor 5 Kilo InstanceState.make singletons to scoped Effect    │
│           Services; decrement allowlist from 7 -> 2.                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ Agent 4: HttpApi Exerciser Optimization (Strip Redundant Git Fixtures)      │
│   • Scope: packages/opencode/test/server/httpapi-exercise/                  │
│   • Goal: Strip git:true default from 80+ route scenarios that only test    │
│           decoding/auth; cut exerciser time from 7m -> <2m.                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Work Package 1: Provider & Model Domain
* **Files:**
  - `packages/opencode/src/tool/mcp-websearch.ts`
  - `packages/opencode/src/tool/warpgrep.ts`
  - `packages/opencode/src/tool/websearch.ts`
  - `packages/opencode/test/provider/transform.test.ts`
  - `packages/opencode/test/provider/model.test.ts`
* **Tasks:**
  1. Migrate `transform.test.ts` (225 tests) to run directly in `bun test` in-process (runs in <1 second instead of spawning 225 child processes).
  2. Pass API keys and provider options through `Tool.Context` instead of reading top-level `process.env`.
  3. Remove 3 entries from `kilo-tool-process-env` in `script/architecture-allowlist.json`.
* **Validation:** `bun run check:architecture && bun test packages/opencode/test/provider/transform.test.ts`

### Work Package 2: Storage & Database Domain
* **Files:**
  - `packages/opencode/src/storage/storage.ts`
  - `packages/opencode/test/storage/storage.test.ts`
  - `packages/opencode/test/preload.ts`
* **Tasks:**
  1. Make `Storage.layer({ dir })` accept an explicit root directory so instances and tests do not mutate `Global.Path.data`.
  2. Remove the filesystem remapping workaround in `test/storage/storage.test.ts`.
  3. Add a fail-closed check in `test/preload.ts` ensuring unit tests cannot open `~/.local/share/kilo/kilo.db` on disk.
* **Validation:** `bun run check:architecture && bun test packages/opencode/test/storage/storage.test.ts`

### Work Package 3: Kilo Singletons Extraction to Scoped Effect Services
* **Files:**
  - `packages/opencode/src/kilocode/background-process/index.ts`
  - `packages/opencode/src/kilocode/interactive-terminal/index.ts`
  - `packages/opencode/src/kilocode/notebook/service.ts`
  - `packages/opencode/src/kilocode/project-id.ts`
* **Tasks:**
  1. Convert `InstanceState.make` in these 4 services into standard `Context.Tag` + `Layer.effect` services.
  2. Provide services via the application layer instead of module-level singleton maps.
  3. Decrement `kilo-instance-state-singletons` in `script/architecture-allowlist.json` from 7 down to 2.
* **Validation:** `bun run check:architecture && bun run test:unit` in `packages/kilo-vscode/`

### Work Package 4: HttpApi Exerciser Optimization
* **Files:**
  - `packages/opencode/test/server/httpapi-exercise/dsl.ts`
  - `packages/opencode/test/server/httpapi-exercise/index.ts`
  - `packages/opencode/test/server/httpapi-exercise/routing.ts`
* **Tasks:**
  1. Change default scenario fixture from `{ git: true }` to pure in-memory mock projects.
  2. Opt in with `.inProject({ git: true })` only for the ~10 scenarios that specifically test Git worktrees or VCS.
  3. Separate the static OpenAPI coverage verification pass from the live request execution pass.
* **Validation:** `bun test packages/opencode/test/server/httpapi-exercise/`

---

## 4. Architecture Enforcement System

We enforce domain decoupling using automated ratchets in CI (`script/check-architecture.ts` and `script/architecture-allowlist.json`):

### Active Ratchets (PR #12990)
1. **Core Directionality:** `packages/core`, `packages/llm`, `packages/schema` must never import from `packages/opencode`, `@/*`, or `packages/kilo-vscode`.
2. **Kilo InstanceState Ratchet:** Freezes all 7 existing `InstanceState.make` singletons in Kilo-owned code.
3. **Database Constructor Guard:** Direct `new Database()` / `new DatabaseSync()` is banned in Kilo code (must use `Database.Service`).
4. **Tool Environment Guard:** Classifies direct `process.env` reads in Kilo tools.
5. **HttpApi Handler Boundaries:** Forbids raw OS/process calls (`child_process`, `Bun.spawn`, `node:fs`) in Kilo route handlers.

### Planned Follow-up Ratchets
6. **Test Execution Tier Ratchet:** New test files must run in-process via `bun test` by default; stateful tests maintained on an allowlist.
7. **Test Database Memory Ratchet:** Fails closed if any test accesses a disk-backed SQLite database without an integration allowlist entry.
8. **Test Sleep Anti-Pattern:** Flags `Effect.sleep` in tests, requiring `Deferred`, `Latch`, or `SessionStatus` polling instead.
9. **Session Direct-SQL Write Ratchet:** Forbids direct Drizzle writes to `SessionTable` outside `SessionProjector` (enforcing `EventV2`).

---

## 5. Expected Outcomes

| Metric | Current Baseline | After Phase 1 Refactors | Target Architecture |
|---|---|---|---|
| **HttpApi Exerciser** | 6m 08s - 7m 16s | **~1m 30s - 2m 00s** | **<1m (in-process)** |
| **Linux Unit Matrix** | 6m 55s - 8m 46s | **~2m 30s** | **<30s (in-process)** |
| **Windows Unit Matrix** | 7m 45s - 9m 12s | **~3m 00s** | **<45s (in-process)** |
| **Total PR CI Wall Clock** | **7m 30s - 9m 15s** | **~2m 30s - 3m 00s** | **<2m total** |
