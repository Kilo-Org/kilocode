# Plan delta 2026-10-20: clients, identity and sync gates

Status: dated record. The decisions below are authoritative in [`migration-context.md`](migration-context.md) (decisions 11 to 18) and applied in [`kilo-v2-migration-plan.md`](kilo-v2-migration-plan.md) and [`v2-host-strategy.md`](v2-host-strategy.md). This file keeps the evidence and the rejected alternatives so they are not re-argued.

## 1. What was decided

| # | Decision | One line |
|---|---|---|
| 11 | Direction | Code moves from upstream files into Kilo-owned files, never back; a mirror is rung 2; a patch never changes an upstream default (#15281) |
| 12 | Config names | Kilo v2 reads `kilo.json`, `kilo.jsonc`, `.kilo`, `.kilocode` only; `opencode.*` dropped on purpose; generic layout seam with host-supplied names (#15282) |
| 13 | Identity | Internal line is `kilo2` (binary #15288, app directories #15270); at public release it becomes `kilo` with a one-shot import; v1 directories never written |
| 14 | No facade | D-5 answered: no v1 wire facade for any client; the archived port's backend adapter and `vscode-v2-boot` are rejected |
| 15 | Clients | New stripped-down package per client on `origin/v2`, native `@opencode/client` plus Kilo RPCs, port UI and rewrite the data layer; VS Code skeleton now; JetBrains and cloud after the fan-out gate |
| 16 | Unit shape | RPC first (schema, `kilo-plugin`), then TUI consumer, then VS Code consumer; settings RPC first |
| 17 | Hard cut | No in-place migration on `main`; not a strangler; cut with import |
| 18 | Sync gates | `upstream-deps.json` lock, impact report, mirror drift and checker rung rules are gates that fail CI, not reports |

## 2. Why no facade: the evidence

### The contract does not carry the behavior

`PATCH /config/overlay` in v1 (`packages/opencode/src/kilocode/server/httpapi/handlers/config-console.ts` on `main`):

| Behind the call | In the OpenAPI contract | In v2 today |
|---|---|---|
| picks the target file by precedence and scope | nothing | `Config.update` writes one key (`shell`) to the global file |
| revision check under a file lock, 409 on conflict | status code only | no revision, no lock |
| shadow check, 422 when a nearer file wins | status code only | not exposed |
| applies at once: cache invalidation, instance disposal, no restart for console-only keys | nothing | debounced per-Location reload, no instance disposal |

An adapter that matches the shapes returns 200, the next read shows the new value, and the running session keeps the old one. The same pattern repeats for permissions (persistent rules, protected paths), events (durable order and replay versus a volatile stream), PTY lifetime and session status (`offline`, `scheduled` have no v2 state).

### State is separate

v1 stores sessions in `kilo.db` (SQLite, `session`, `message`, `part` tables); the v2 host uses `kilo2.db` with `session_v2` and `session_message`, refuses to open a store with a v1 `session` table, and upstream's `V1Migration` deletes the v1 event log on import. A v1 client over any facade would see a different world than the v1 client next to it. Compatibility at the API layer cannot exist without shared state.

### Both adapters measured

| Adapter | What it is | Coverage | Its own verdict |
|---|---|---|---|
| Archived port, `kilo-v2:packages/kilo-vscode/src/backend` (25 files) | in-process v1 `KiloClient` facade over the v2 client, compiled into a modified v1 extension; no HTTP server | 88 methods mapped; the v1 extension uses 129 distinct paths, 57 have no facade leaf; `session.deleteMessage` and `session.diff` are called but absent | "adapter acceptance, not complete UI parity"; real typecheck failing; "no row claims complete E2E acceptance"; "#12887 (strangler) is not the strategy" |
| `vscode-v2-boot` (2026-10-20, 2 commits on `main`) | `Proxy` facade plus event folding and projection, 1,150 lines plus a 9,100-line vendored client | 43 methods mapped of 99 call sites; 8 constant stubs (`config.overlay → {}`, `saveAlwaysRules → true`, `sandbox → unavailable`) | "most of the 67 unmapped methods are missing on the server, not in the client ... the client-side approach does not make it smaller" |

Both stay as mechanism references: server spawn over `--stdio`, status derivation from execution events, the eight concept mismatches (model and agent on the session, replies routed per session, questions as forms, no status event, part ID ordering, cursor format, late catalog, tool names). Neither merges.

### What upstream did

Measured on `upstream/dev`, tags `v1.19.3` and `v2.0.0`:

| Client | How it reached v2 | Evidence |
|---|---|---|
| TUI | moved (`fe0c4f8c743`, 2026-06-06), re-wired to `@opencode/client` (`8b682c42b66`, `36f8cb70548`); 74% of paths survive | `packages/tui` 187 files at v1.19.3, 138 same path at v2.0.0 |
| Web app | re-wired incrementally behind a vendored v2 client (`e45210c6d21`, `0a6637e17aa`); the shim `server-compat.ts` made the **new-API client** work against **old servers**, then was deleted (`9314992f985`, 2026-08-06); 56% of files survive as moves | 98 old-SDK imports at v1.19.3, 0 at v2.0.0 |
| Desktop | Electron shell kept, client added (`c2b754bb036`), v1 sidecar removed (`eb22768a238`) | |
| Server | **no v1 routes, no v1 events**; only data (`core/src/database/v1-migration.ts`, one-shot, `migration.v1-v2` state key) and config (`core/src/v1/config/migrate.ts`, in-memory key mapping) | `packages/server/src` has no v1 handler |

Upstream could migrate its app in place because its v1 server already served the new API over one database (`packages/opencode` imported `@opencode-ai/core/database` by v1.19.3). Kilo's two lines do not share state, so the same move is not available to us (decision 17).

## 3. Rejected alternatives, with reasons

| Alternative | Why not |
|---|---|
| v1 wire facade with a removal date | cannot guarantee behavior (section 2); every reproduced behavior is a second v1 runtime Kilo maintains alone |
| Adapter inside the v1 extension (`vscode-v2-boot` shape) | the view model stays v1; every v2 concept is translated or stubbed; the server-side gap is the same size |
| In-place migration of `kilo-vscode` on `main` toward the new client | `main`'s server never gains the v2 Kilo RPCs; the API on `main` has drifted from `v2.x`; every migrated call site is migrated twice |
| Copying the extension into `origin/v2` and adapting it | two copies of the extension drift; 108 files import v1 SDK types that have no server on `v2` |
| Rewriting from scratch with no reuse | upstream's own numbers (74% and 56% survival) say port the UI and replace the data layer |

## 4. Sync gates: the measurement that decided it

Against `upstream/dev` at 166 commits past the `v2.0.30` pin, on 2026-10-20: Kilo-owned code imports 37 upstream files; 11 had changed; 1 of those is a marked file (`cli/src/server-process.ts`) and would have conflicted; the other 10 (`plugin/sdk.ts` semantics of `Updated`, `shell.ts` +68/-50, `variant.ts` new export, `schema/credential.ts` -2, ...) would have passed a marker-only sync with no signal. A report of these rows nobody reads is not a detector, so each Kilo package gets an `upstream-deps.json` lock with content hashes, and CI fails until the entry is updated by whoever read the diff (U-L3-02). The mirror drift check is the same gate over the host's mirrored files (U-L3-03). The shared-patch checker classifies rungs mechanically and rejects forked upstream test files (U-L3-04), which is what let #15018 land as a "seam" with Kilo imports in upstream files and six forked tests.

## 5. Units added

| Unit | Title | Gate |
|---|---|---|
| U-E0-06 | Startup fix: Gateway catalog must not block plugin activation (#15244 fix half, unowned) | pre-gate |
| U-E1-09 | Settings RPC replacing the v1 `/config/*` group, owning reload semantics | G1 |
| U-E1-10 | Client fan-out gate: RPC set stable two releases, versioned client, breaking-changes document | G1 (gate) |
| U-E6-22 | VS Code walking skeleton, new package, native client | G2, started 2026-10-20 |
| U-E6-23 | `v1-v2-client-breaking-changes.md`, wire-level | G2, input to U-E1-10 |
| U-L3-02 | `upstream-deps.json` lock and impact report | continuous |
| U-L3-03 | `mirroredFiles` drift gate | continuous |
| U-L3-04 | Checker rung classification and forked-test rule | continuous |
| U-L3-05 | Progress map client view; remove `facade` | continuous |

Retired: U-E6-01 (re-land the v1 extension behind v2 adapters), replaced by U-E6-22.

## 6. Documents changed by this delta

`migration-context.md` (decisions 13 to 18, working model, deferred decisions), `kilo-v2-migration-plan.md` (Part A objective, D5, D6, phase diagram and table; Part B rows above), `v2-host-strategy.md` (sections 2, 4, 7, 8, 9, 10), `v2-fork-conventions.md`, the `v2-migration`, `v2-feature-placement` and `kilocode-merge-minimizer` skills, `AGENTS.md`, and the superseded banners of the archived plans.
