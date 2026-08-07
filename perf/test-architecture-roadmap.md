# Test Pipeline Architecture & Refactoring Roadmap

This document outlines the architectural plan to transition Kilo's testing pipeline from the legacy process-per-file model (~6-9 minutes on CI) to a deterministic, in-process testing model (<2-3 minutes total CI, <30 seconds for local unit passes).

Tracking Issue: [#12986](https://github.com/Kilo-Org/kilocode/issues/12986)

---

## 1. Background & Technical History

### How Upstream OpenCode Tests
Upstream OpenCode evolved toward a **one-process-per-domain** test methodology. By decoupling business logic into pure packages (`packages/core`, `packages/schema`, `packages/llm`), upstream models stateful workflows as **Event-Sourced Aggregate Roots** (`EventV2`, `SessionV2`, `ContextEpoch`).
- Aggregate roots are pure state machines: `state = events.reduce(fold, initial)`.
- Testing business logic only requires folding in-memory events with a virtual clock (`TestClock`) and in-memory SQLite (`:memory:`).
- Because there is zero disk I/O and no shared mutable singletons, **hundreds of test files run in parallel within a single in-process `bun test` pass in ~5 to 10 seconds**.

### Why Kilo Couldn't Use Upstream's One-Process Model Directly
Kilo extends OpenCode with cross-cutting capabilities (Agent Manager multi-worktree orchestration, custom AI gateway routing, snapshot rollback engine, subagent delegation, and interactive terminals).

Because these capabilities were built inside the monolithic `packages/opencode`, they share:
1. **Module-Level Singletons (`InstanceState.make`):** State maps keyed by directory via `AsyncLocalStorage`. In a single process, async callbacks and event listeners bleed across test boundaries.
2. **Disk-Backed SQLite & Storage Singletons:** Tests that initialize `Database.node` or `Storage.Service` connect to real SQLite files on disk (`~/.local/share/kilo/kilo.db`), causing `database is locked` errors and Windows `EBUSY` lock cleanup crashes when tests run concurrently.
3. **Lingering Native Handles:** Native `@parcel/watcher` and `node-pty` handles remain active beyond individual test fibers, causing cross-test contamination and port collisions.

### The Intermediate Fix: Process-Per-File Isolation & Sharding
To stabilize tests and stop state cross-contamination, we introduced:
1. **Isolated Test Runner (`packages/opencode/script/test-runner.ts`):** Spawns a dedicated OS child process for every single test file (`bun test <file>`), ensuring separate PIDs, fresh memory, and isolated temp directories.
2. **Size-Based LPT Sharding (`script/kilocode/test-shard.ts`):** Uses Longest Processing Time bin-packing based on file byte size to distribute tests across CI matrix shards (2 shards on Linux, 4 on Windows).
3. **Curated macOS Profile (`test-profile.ts`):** Restricted macOS PR runs to platform-specific subsystems (PTY, Seatbelt sandbox, FSEvents watcher), cutting macOS time by ~65%.

### Why the Intermediate Fix Has Hit a Hard Limit
While the runner stopped cross-test contamination, running 651 test files in separate child processes incurs a massive performance penalty:
- **Process Startup Overhead:** Spawning 651 separate `bun test <file>` processes means 651 cold engine boots, 651 TypeScript compilation passes, and 651 module resolution cycles for heavy bundles (Effect, Hono, AI SDK). This costs **500s to 800s of cumulative startup overhead**.
- **Windows Process Spawning Tax:** Windows process creation (`CreateProcessW` + Windows Defender scanning) is 2-3x slower than Linux, causing 4 shards with concurrency 2 to take 8 to 9+ minutes.
- **Size-Based Shard Imbalance:** File byte size is a poor proxy for duration. Heavy subprocess tests (e.g. `run-process.test.ts` which takes ~112s despite being only 7KB) clump into shard 1, creating 8.5-minute stragglers while other shards finish in 4 minutes.
- **HttpApi Exerciser Serial Execution:** `bun turbo test:httpapi` runs ~150 scenarios serially through `mode coverage`, `mode auth`, `mode effect`. In `dsl.ts`, every scenario defaults to `project: { git: true }`, running ~80 redundant `git init` repository setups even for routes that only test simple JSON decoding or auth status.

---

## 2. Current CI Platform Timings (PR Checks)

| Platform / Job | Runner | Current Duration | Bottleneck / Root Cause |
|---|---|---|---|
| **Linux Unit Tests** | `blacksmith-4vcpu-ubuntu-2404` | **6m 55s - 8m 46s** | Only 2 shards for 651 files (~325 files/shard; ~80 files per core). |
| **Windows Unit Tests** | `blacksmith-4vcpu-windows-2025` | **7m 45s - 9m 12s** | 4 shards, concurrency 2; slow process spawn (`CreateProcessW` + Defender). |
| **HttpApi Exerciser** | `blacksmith-8vcpu-ubuntu-2404` | **6m 08s - 7m 16s** | Runs ~150 scenarios serially; defaults every scenario to `git: true` temp repo. |
| **macOS Unit Tests** | `macos-15` | **3m 08s - 4m 16s** | Runs curated `darwin` profile (~60 files). |
| **JetBrains / VS Code** | `blacksmith-4vcpu-ubuntu-2404` | **~1m 15s** | Already fast and well-cached. |

---

## 3. Target Architecture & Root Aggregate Design

```
                      ▲
                     / \
                    /   \      OS Integration Tier (~40 files, ~1 min)
                   / E2E \     - Real node-pty, Seatbelt sandbox, Git worktrees.
                  /───────\    - Spawns child processes in parallel via test-runner.ts.
                 /         \
                /  Domain   \  Fast In-Process Tier (~600 files, <15-30 sec)
               / Aggregates  \ - Pure Effect Services & Aggregate Roots (SessionV2, EventV2).
              /───────────────\- Tested in-memory (:memory: DB, TestClock, mocked ports).
                               - Runs in 1 single in-process 'bun test' pass.
```

### Core Architectural Principles
1. **Decouple Business Logic into Pure Aggregate Roots:** State transitions should be tested by applying events to in-memory aggregate state machines rather than creating real SQLite databases on disk or spawning child processes.
2. **Capability & Service Injection over Singletons:** Replace module-level `InstanceState.make` and `process.env` reads with scoped Effect Services (`Context.Tag` + `Layer.effect`).
3. **Fail-Closed Test Database Isolation:** Unit tests must resolve `KILO_DB === ":memory:"` and never access disk database paths under `Global.Path.data`.
4. **Lightweight Test Fixtures:** Route tests that only verify HTTP decoding, status codes, and schema validation must use pure in-memory mock projects instead of creating real Git repositories on disk.

---

## 4. Parallel Refactoring Work Packages

These 5 work packages are strictly orthogonal, operate on disjoint file trees, and can be executed concurrently by separate agents or worktrees without merge conflicts.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       5 PARALLEL REFACTORING WORK PACKAGES                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ Issue #13000: CI Matrix Rebalancing (Immediate Win)                         │
│   • Scope: .github/workflows/test.yml, script/test-runner.ts                │
│   • Goal: Bump Linux shards (2 -> 4) and Windows shards (4 -> 6) to drop    │
│           CI test duration to ~2.5m today.                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│ Issue #12999: HttpApi Exerciser Optimization (Strip Redundant Git Fixtures) │
│   • Scope: packages/opencode/test/server/httpapi-exercise/                  │
│   • Goal: Strip git:true default from 80+ route scenarios that only test    │
│           decoding/auth; cut exerciser time from 7m -> <2m.                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ Issue #12996: Provider & Model Domain (Pure In-Process Test Migration)      │
│   • Scope: packages/opencode/test/provider/, packages/opencode/src/tool/   │
│   • Goal: Migrate 225+ pure transform tests to fast in-process bun test;    │
│           eliminate 3 tool process.env reads.                               │
├─────────────────────────────────────────────────────────────────────────────┤
│ Issue #12997: Storage & Database Domain (Injectable Root & Fail-Closed DB)  │
│   • Scope: packages/opencode/src/storage/, test/storage/, test/preload.ts   │
│   • Goal: Make Storage.layer({ dir }) injectable; remove filesystem         │
│           remapping hack; enforce fail-closed KILO_DB=":memory:".           │
├─────────────────────────────────────────────────────────────────────────────┤
│ Issue #12998: Kilo Singletons Extraction (InstanceState.make -> Services)   │
│   • Scope: packages/opencode/src/kilocode/{notebook, terminal, background,  │
│           project-id, agent-manager}                                        │
│   • Goal: Refactor 5 Kilo InstanceState.make singletons to scoped Effect    │
│           Services; decrement allowlist from 7 -> 2.                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Work Package 1: CI Matrix Rebalancing ([#13000](https://github.com/Kilo-Org/kilocode/issues/13000))
* **Files:** `.github/workflows/test.yml`, `packages/opencode/script/kilocode/test-shard.ts`
* **Tasks:**
  1. Increase Linux shards from 2 to 4 (`shard: [1, 2, 3, 4]`, `total: 4`).
  2. Increase Windows shards from 4 to 6 (`shard: [1, 2, 3, 4, 5, 6]`, `total: 6`).
  3. Optionally restore JUnit XML artifacts in CI to balance shards dynamically by measured runtime.
* **Validation:** Run CI on a PR touching CLI code; verify all shards finish in ~2.5m without stragglers.

### Work Package 2: HttpApi Exerciser Optimization ([#12999](https://github.com/Kilo-Org/kilocode/issues/12999))
* **Files:** `packages/opencode/test/server/httpapi-exercise/{dsl.ts, index.ts, routing.ts}`
* **Tasks:**
  1. In `dsl.ts`, change default scenario fixture from `project: { git: true }` to pure in-memory mock projects.
  2. Opt in with `.inProject({ git: true })` only for the ~10 scenarios that specifically test Git worktrees or VCS.
  3. Separate static OpenAPI coverage checking from live request execution.
* **Validation:** `bun test packages/opencode/test/server/httpapi-exercise/` (wall-clock drops from 7m to <2m).

### Work Package 3: Provider & Model Domain ([#12996](https://github.com/Kilo-Org/kilocode/issues/12996))
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

### Work Package 4: Storage & Database Domain ([#12997](https://github.com/Kilo-Org/kilocode/issues/12997))
* **Files:**
  - `packages/opencode/src/storage/storage.ts`
  - `packages/opencode/test/storage/storage.test.ts`
  - `packages/opencode/test/preload.ts`
* **Tasks:**
  1. Make `Storage.layer({ dir })` accept an explicit root directory so instances and tests do not mutate `Global.Path.data`.
  2. Remove the filesystem remapping workaround in `test/storage/storage.test.ts`.
  3. Add a fail-closed check in `test/preload.ts` ensuring unit tests cannot open `~/.local/share/kilo/kilo.db` on disk.
* **Validation:** `bun run check:architecture && bun test packages/opencode/test/storage/storage.test.ts`

### Work Package 5: Kilo Singletons Extraction to Scoped Effect Services ([#12998](https://github.com/Kilo-Org/kilocode/issues/12998))
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

---

## 5. Architecture Enforcement System (PR #12990 Merged)

We enforce domain decoupling using automated ratchets in CI (`script/check-architecture.ts` and `script/architecture-allowlist.json`):

### Active Ratchets
1. **Core Directionality:** `packages/core`, `packages/llm`, `packages/schema` must never import from `packages/opencode`, `@/*`, or `packages/kilo-vscode`.
2. **Kilo InstanceState Ratchet:** Freezes all 7 existing `InstanceState.make` singletons in Kilo-owned code.
3. **Database Constructor Guard:** Direct `new Database()` / `new DatabaseSync()` is banned in Kilo code (must use `Database.Service`).
4. **Tool Environment Guard:** Classifies direct `process.env` reads in Kilo tools.
5. **HttpApi Handler Boundaries:** Forbids raw OS/process calls (`child_process`, `Bun.spawn`, `node:fs`) in Kilo route handlers.

---

## 6. Expected Target Outcomes

| Metric | Current Baseline | After Work Packages | Target Architecture |
|---|---|---|---|
| **HttpApi Exerciser** | 6m 08s - 7m 16s | **~1m 30s - 2m 00s** | **<1m (in-process)** |
| **Linux Unit Matrix** | 6m 55s - 8m 46s | **~2m 15s - 2m 45s** | **<30s (in-process)** |
| **Windows Unit Matrix** | 7m 45s - 9m 12s | **~2m 45s - 3m 15s** | **<45s (in-process)** |
| **Total PR CI Wall Clock** | **7m 30s - 9m 15s** | **~2m 30s - 3m 00s** | **<2m total** |
