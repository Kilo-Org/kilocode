# Plan: Port Kilo Capabilities to OpenCode v2

> [!IMPORTANT]
> **Superseded.** This document is retained as historical planning context only.
> Do not use it to sequence implementation work. The authoritative plan is
> [Kilo-Org/kilocode#13750](https://github.com/Kilo-Org/kilocode/issues/13750),
> with a local snapshot in
> [`plans/kilo-opencode-v2-issue-13750.md`](./kilo-opencode-v2-issue-13750.md).

## Status

This is the planning baseline for bead `kilocode-w5i`. It incorporates the
initial repository investigation and the independent adversarial review in BB
thread `thr_7myjrm57ar`.

No OpenCode v2 integration branch, implementation worktree, product code, or
cutover commitment is created by this document. Phase 0 must be completed and
reviewed before feature implementation starts.

Phase 0 slice 1 (bead `kilocode-cmy`) is committed locally on the slice branch
`johnnyeric/v2-baseline`, pending review and integration. Nothing is pushed. Its
evidence lives in `kilocode/baseline/pinned-v2-baseline.md` and its fork rules
in `kilocode/v2-fork-conventions.md`; the evidence snapshot below was
re-verified against those refs on 2026-08-13. This document is itself part of
that slice.

## Objective

Create a Kilo product line on OpenCode v2 before upstream makes v2 its default,
without destabilizing the current production fork or carrying the legacy fork
as one large patch set.

The result should:

- keep `origin/main` as the production line while the port is incomplete;
- preserve `upstream/v2` ancestry and remain practical to sync;
- port Kilo capabilities and user-visible invariants rather than legacy files;
- keep Kilo-specific code in Kilo-owned paths with narrow upstream hooks;
- support an isolated `kilo2` preview that can coexist with production `kilo`;
- establish protocol and generated-client contracts before adding clients;
- provide explicit migration, rollback, security, and client-readiness gates;
- avoid a calendar estimate until the generated parity ledger exists.

## Correct framing

This is not a conventional v1-to-v2 rewrite. Kilo main already ships an older
generation of OpenCode's v2 Core, SQLite storage, durable events, and `/api/*`
HTTP surface from inside the current CLI. The work is therefore a hybrid-Core
to current-v2 migration plus a port of the remaining Kilo product surface.

The legacy `packages/opencode` tree is source material, not a patch set. A
capability can be:

- already provided correctly by upstream v2;
- present in the older Core integration and needing forward-porting;
- a Kilo-only capability that should move into a Kilo-owned v2 module;
- incompatible with v2 architecture and needing redesign;
- deliberately deferred or dropped.

## Evidence snapshot

The following facts were verified during planning on 2026-08-11 and re-verified
on 2026-08-13 against the pinned refs recorded in
`kilocode/baseline/pinned-v2-baseline.md`. They are context for Phase 0, not
permanent constants.

- `upstream/dev` and `upstream/v2` diverged at `0e2dd4ad` on 2026-06-26.
  `0e2dd4ad` is also the `origin/main`..`upstream/v2` merge base.
- Verified 2026-08-13 from that base: `upstream/dev` is 899 commits ahead,
  `upstream/v2` 1,470, and Kilo `origin/main` 3,391. The 2026-08-11 figures
  were 872, 1,331, and 3,334.
- Only a small number of dev-line patches had equivalents on v2. Dev fixes
  cannot be assumed to reach the v2 branch.
- `packages/opencode` is deleted on `upstream/v2`; the replacement CLI lives in
  `packages/cli` and uses the `opencode2` binary identity
  (`packages/cli/script/build.ts`). Upstream's own root `AGENTS.md` still
  describes `packages/opencode` as present for reference; that line is stale at
  the pinned SHA.
- Kilo main contains 24 `packages/core/src/kilocode/` files and 22
  `packages/core/test/kilocode/` tests that are already used by the production
  CLI.
- The planning scan found 99 marked Core files, with 77 paths still present on
  v2 and 22 moved or removed. The removed set includes the old tool layer,
  which v2 replaces with registered tool plugins. Not re-verified in slice 1;
  it becomes ledger output in slice 2.
- The legacy CLI contains roughly 454 Kilo-path source files, 401 Kilo-path
  tests, and 381 shared files carrying Kilo change markers. Not re-verified in
  slice 1; it becomes ledger output in slice 2.
- OpenCode v2's dependency direction is Schema to Core/Protocol to Server.
  Clients and the extracted TUI consume generated protocol clients rather than
  backend internals.
- Corrected 2026-08-13: upstream v2 does **not** document a clean storage
  break. It ships `docs/design/v1-v2-database-migration.md` and an implemented
  backfill (`feat(core): migrate v1 data to v2`, upstream #40723). Its declared
  V1 baseline is the upstream `dev` schema, so it does not automatically cover
  Kilo main's June-era Core fork.
- The design doc and the pinned implementation disagree about how that backfill
  is triggered, and only the code was verified:
  - The doc describes `GET` for status plus a **blocking `POST`** to run or
    resume, checked only at interactive TUI startup, with noninteractive `run`,
    ACP, raw API, service, health, version, and help flows not triggering it.
  - At the pin there is **no `POST`**. `packages/protocol/src/groups/migration.ts`
    declares one endpoint, `migration.v1.status` (`GET`), and
    `packages/server/src/handlers/migration.ts` handles only that.
  - The backfill instead starts itself. `V1Migration.layer`
    (`packages/core/src/database/v1-migration.bun.ts:442`) sets running state
    and forks `run()` with `Effect.forkScoped({ startImmediately: true })`, and
    `packages/server/src/routes.ts:165` merges that layer unconditionally into
    the server layer. Any process that builds the routes layer starts it, not
    just an interactive TUI.
  - `run()` early-returns `completed` when the legacy `session` table is absent
    (`v1-migration.bun.ts:478`), so it is a no-op on a clean store. The trigger
    is still ambient rather than user-initiated.
  - `packages/tui/src/component/migration-overlay.tsx` polls the `GET` status
    and renders progress. It observes the migration; it does not start it.
- Phase 0's data assessment must therefore evaluate the **actual** lifecycle,
  not the documented one: when the layer is constructed across `serve`, the
  managed service, ACP, and noninteractive runs; what a background fiber writing
  to the store means for `kilo2` isolation; whether Kilo's June-era schema
  satisfies or trips the `hasLegacySessions` guard and the transform; and
  whether the ambient trigger must be disabled or gated in the Kilo preview.
  Do not treat the documented interactive `GET`/`POST` flow as implemented.
- The VS Code extension has one connection-service choke point, but almost all
  of its backend usage remains on the legacy API. Nested `client.v2.*` use is
  still limited to `ScriptTerminalManager` PTY operations: six call sites in
  `packages/kilo-vscode/src/agent-manager/ScriptTerminalManager.ts` plus three
  assertions in `tests/unit/agent-manager-arch.test.ts`.
- The pinned baseline is not green. Upstream CI at `76dbaf20` fails its own
  `unit (linux)` and `unit (windows)` jobs. See
  `kilocode/baseline/pinned-v2-baseline.md` for the failure inventory.

Phase 0 must turn these one-time counts into reproducible reports so the plan
does not depend on hand-maintained numbers.

## Scope

The parity ledger must cover at least:

- CLI identity, configuration, storage, credentials, updates, and packaging;
- Kilo Gateway authentication, organization state, model catalog, and policy;
- providers, streaming, accounting, and provider-isolation behavior;
- agents, sessions, messages, compaction, retry, and snapshots;
- permissions, questions, sandboxing, filesystem, and network boundaries;
- Kilo tools, MCP, memory, indexing, telemetry, and other runtime services;
- TUI branding, commands, plugins, settings, account, and organization flows;
- generated TypeScript and Kotlin clients;
- VS Code, Agent Manager, JetBrains, and other supported clients;
- data migration, coexistence, rollback, observability, and release operations.

## Non-goals

- Do not merge `origin/main` or `upstream/dev` wholesale into the v2 line.
- Do not recreate the entire legacy server API on v2.
- Do not copy the legacy `packages/opencode` tree into `packages/cli`.
- Do not rename or fork every upstream package to add Kilo branding.
- Do not share a writable database between `kilo` and `kilo2`.
- Do not build a generic Kilo extension framework before two real consumers
  prove the abstraction.
- Do not make the v2 preview depend on solving production data migration.
- Do not treat importing `@kilocode/sdk/v2/client` as proof that a caller uses
  the new nested OpenCode v2 API.

## Branch and worktree model

1. Fetch `origin`, `upstream/dev`, and `upstream/v2` immediately before work.
2. Record the exact SHAs and confirm their merge bases and ancestry.
3. Create a BB isolated worktree at the pinned `upstream/v2` commit.
4. Create the long-lived integration branch
   `johnnyeric/kilo-opencode-v2` in that worktree.
5. Create short-lived branches named `johnnyeric/v2-<slice>` from the
   integration branch.
6. Target slice PRs at `johnnyeric/kilo-opencode-v2`, not `main`.
7. Merge `upstream/v2` into the integration branch regularly. Never rebase the
   shared integration branch.
8. Snapshot every upstream v2 SHA consumed by the branch so force-pushes or
   rewritten history are visible.
9. If upstream rewrites v2 ancestry, stop and assess a new integration base.
   Do not silently force-push the Kilo integration branch to match it.
10. Track important `upstream/dev` and Kilo-main fixes in a separate ledger
    lane. Port individual fixes only after classifying their v2 relevance.

Selective cherry-picks are acceptable only for isolated commits whose
dependency and provenance are understood. The default is to re-implement the
capability against v2 architecture.

## BB execution model

Phases are dependency and acceptance gates, not worktree boundaries. A phase
may contain several independently reviewable slices, and each implementation
slice should have its own BB thread, worktree, and short-lived branch.

- Keep one long-lived integration branch, `johnnyeric/kilo-opencode-v2`, based
  on the pinned `upstream/v2` snapshot.
- Keep one integration worktree clean. Its coordinator owns upstream-v2 syncs,
  the parity ledger, phase-gate decisions, and integration of reviewed slices;
  it should not also be the general feature-development worktree.
- Give each slice exactly one writing agent and a branch named
  `johnnyeric/v2-<slice>`, based on the latest integration branch.
- Use a separate review thread after a slice is ready. Prefer an independent
  reviewer and a fresh read-only worktree for high-risk protocol, storage,
  provider, or client-boundary changes.
- Merge a slice into the integration branch only after its definition of done
  and phase-specific gate pass. Rebase or recreate an unmerged slice branch as
  needed; never rebase the shared integration branch.
- Parallelize only slices whose dependencies and files are demonstrably
  independent. Early baseline, identity, protocol, and Gateway proof work stays
  sequential because each establishes the contract for the next.
- Do not keep one agent alive for the entire migration. Preserve continuity in
  the plan, ledger, decision records, and integration history rather than in an
  agent's conversation context.

The preferred BB shape is:

```text
coordinator thread + clean integration worktree
  -> implementation thread + worktree for one slice
  -> independent review thread
  -> validated merge into integration
  -> next dependent slice branches from updated integration
```

Within a later phase, multiple implementation threads may run concurrently
only when the ledger shows they do not share a protocol contract, generated
artifact, schema migration, or shared upstream hook.

## Product decision gates

Unless explicitly changed during Phase 0, the plan uses these defaults.

| Gate | Recommended default | Blocks |
|---|---|---|
| G1: upstream posture | Track pinned `upstream/v2` snapshots and merge forward; treat reconciliation with `dev` as unknown | Feature work if ancestry cannot be preserved safely |
| G2: user data | `kilo2` preview starts clean and never imports production data automatically | GA migration and cutover design |
| G3: client order | CLI preview, then TUI, then VS Code/Agent Manager, then JetBrains; required clients block default cutover, not initial preview | Default release |
| G4: distribution | Separate `kilo2` binary, app identity, storage, service identity, and update channel | Preview packaging |
| G5: v1 change policy | Continue production fixes; every new feature gets an explicit port, defer, or drop decision | Scope control and parity claim |

Phase 0 should convert these defaults into short architecture decision records.

## Parity ledger

The ledger must be generated or checked by a script. Each row should contain:

- stable capability ID and owning product;
- user-visible invariant;
- current Kilo source files and source commits;
- existing tests and fixtures;
- v2 destination and dependency layer;
- classification: `upstream-equivalent`, `port`, `redesign`, `defer`, or
  `drop`;
- protocol and generated-client impact;
- storage and migration impact;
- security and permission impact;
- operating-system and process-boundary impact;
- client impact for CLI, TUI, VS Code, Agent Manager, and JetBrains;
- dev-line fix dependencies;
- implementation and validation status.

The ledger is the scope and scheduling source of truth. File counts remain a
diagnostic input, not the project estimate.

## Phase 0: Baseline, ledger, and data assessment

No product feature porting occurs in this phase.

### Work

- Pin and record all three branch baselines and merge bases.
- Build, typecheck, and test pristine upstream v2 using the commands defined by
  that branch. Record existing failures separately.
- Add parity-ledger generation and produce ledger v0.
- Inventory all Kilo packages, shared hooks, tests, generated contracts, and
  client consumers.
- Diff the June-era Core schema used on Kilo main against current v2:
  - database tables and migrations;
  - credentials and configuration;
  - sessions and messages;
  - durable events;
  - filesystem and storage layout.
- Produce a read-only feasibility report for production data migration.
- Add the upstream-v2 drift report and dev-fix triage lane.
- Document v2 fork conventions, Kilo-owned paths, marker rules, generation
  commands, and baseline validation commands.
- Accept or revise G1 through G5.

### Exit gate

- Every production capability has a ledger classification.
- The baseline is reproducible and existing failures are known.
- The schema difference and possible migration boundaries are documented.
- Upstream drift and force-push handling are operationally defined.
- G1 through G5 have recorded decisions.

No calendar estimate is made before this gate passes.

## Phase 1: Isolated `kilo2` shell

Build the smallest Kilo-branded CLI that can coexist with production Kilo.

### Isolate

- binary and application identity;
- config, data, cache, database, logs, and credential paths;
- config precedence and environment variables;
- service-election identity and managed-service state;
- process names, lock files, sockets, ports, and PTY self-command behavior;
- update channel and preview distribution identity.

The shell needs only lifecycle behavior such as version, help, diagnostics, and
backend startup. It must not read production Kilo state by default.

### Exit gate

- `kilo` and `kilo2` run side by side without observing or mutating each
  other's state.
- Isolation tests cover macOS, Linux, and Windows path/process behavior.
- Removing the preview leaves production state untouched.

## Phase 2: Kilo protocol and SDK seam

Establish the real contract before Gateway or client UI work.

Follow the v2 dependency direction:

```text
Schema -> Core/Protocol -> Server -> generated clients
```

### Work

- Choose the smallest real Kilo operation required by the Gateway proof.
- Add its schema and protocol surface in Kilo-owned modules.
- Add only the narrow shared registration hook needed to expose it.
- Generate the TypeScript client through v2's authoritative client build.
- Add server/client contract tests.
- Establish the OpenAPI and Kotlin generation path for later JetBrains work.
- Add the VS Code mirror-type and fixture checklist to the generation workflow.
- Report handwritten and generated diffs separately.

Do not build a generic extension framework in this phase. The seam should be a
small real feature whose design can be tested end to end.

### Exit gate

One real Kilo protocol operation works through a generated client, with
schema, server, and client contracts validated together.

## Phase 3: Headless Gateway vertical proof

The first product proof is CLI-only. TUI and IDE work are deliberately excluded.

### Flow

1. `kilo2` completes Kilo Gateway login.
2. Credentials are stored only in the isolated preview namespace.
3. `kilo2` lists the real Kilo model catalog.
4. `kilo2 run` streams one real prompt through the Kilo provider.
5. The same binary runs one non-Kilo provider as a control.

### Validation

- Capture real Gateway responses before defining fixtures or response types.
- Validate streaming and durable-event lifecycle.
- Smoke-test cost and accounting behavior against real response fields.
- Verify Kilo policy does not leak into the control provider.
- Verify production config, credentials, and databases are not read.
- Exercise permission, cancellation, filesystem, network, and error behavior.
- Test configuration precedence and secret redaction.

### Exit gate

The vertical slice is repeatable and demonstrates that Kilo Gateway fits v2's
provider, protocol, storage, and process model without compromising a non-Kilo
provider.

Failure at this gate triggers redesign before expanding runtime scope.

## Phase 4: Runtime parity

Use the ledger to port only gaps not already satisfied by upstream v2.

Candidate capability groups include:

- agent definitions, selection, and configuration;
- prompt admission, steer, queue, and cancellation;
- sessions, messages, compaction, and snapshots;
- permissions and questions;
- retry, rate limiting, and provider/model policy;
- accounting and costs;
- sandboxing, filesystem, and network boundaries;
- service election, suspend/resume, managed restart, and crash recovery.

Each group should land as its own reviewable vertical slice with a non-Kilo
provider control whenever provider isolation could be affected.

## Phase 5: Tools and Kilo services

Port one capability at a time through v2's tool/plugin registration model.

The ledger should cover:

- Kilo-specific tools;
- MCP behavior and configuration;
- memory and indexing;
- telemetry and observability;
- sandbox extensions;
- remote integrations;
- branch, commit, and other Kilo service endpoints.

Do not reconstruct the legacy tool directory. Implement Kilo tools as Kilo-owned
plugins and use the smallest upstream registration hook that supports them.

Every tool or service slice must test permissions, cancellation, failure,
filesystem/network scope, and cross-platform behavior where relevant.

## Phase 6: TUI parity

Treat the extracted TUI as an SDK client.

### Work

- Port branding, commands, settings, account, and organization flows.
- Port Kilo TUI plugins and sidebar behavior against generated SDK data.
- Keep backend internals out of the TUI package.
- Regenerate client contracts before consuming new fields.
- Add every new user-facing key to all supported locales.
- Retain a non-Kilo-provider control in TUI validation.

### Exit gate

The preview TUI performs the supported Kilo workflows exclusively through the
generated client and has no hidden dependency on the legacy CLI implementation.

## Phase 7: Client migration

### Compatibility model

`KiloConnectionService` becomes the adapter boundary for two explicit backend
modes:

- a legacy adapter for production `kilo serve`;
- a v2 adapter for preview `kilo2 serve`.

Select the adapter through an explicit backend version or capability handshake.
Do not mix legacy and v2 routes within one session, and do not silently fall
back to a second backend process.

An incomplete v2 adapter must expose unsupported preview features explicitly.
The preview may ship with gated features, but v2 cannot become the default
until every required client group is complete.

### VS Code and Agent Manager order

Migrate endpoint groups approximately in this order:

1. health, connection, instance, project, config, and authentication;
2. session lifecycle, prompts, messages, abort, and SSE events;
3. permissions, questions, and suggestions;
4. providers, models, MCP, commands, and search;
5. PTY, terminals, worktrees, and Agent Manager;
6. Kilo-specific endpoints and remaining hand-written HTTP or WebSocket calls.

For every group:

- implement v2 adapter coverage;
- add server/client contract tests;
- update extension-host and webview mirror types;
- update captured fixtures and Storybook data where applicable;
- add the group to the capability matrix;
- gate unsupported preview behavior explicitly;
- remove the legacy path only after the matrix proves the replacement.

The existing nested `client.v2.pty` use in `ScriptTerminalManager` is evidence
that the adapter boundary can work. It is not evidence that Agent Manager or
the extension is already substantially migrated.

### JetBrains

After the protocol stabilizes:

- regenerate the Kotlin client from the integration branch's OpenAPI output;
- update call sites and event handling;
- validate authentication, sessions, terminal behavior, and reconnects;
- keep the Kotlin client generated rather than maintaining a parallel manual
  protocol implementation.

Read `packages/kilo-jetbrains/AGENTS.md` before planning or editing the plugin.

### Compatibility-cliff gate

Route-by-route work avoids a compatibility cliff only when all of the following
are true:

- backend capability negotiation is explicit;
- v1 and v2 adapter behavior has contract tests;
- unsupported v2-preview features are visible rather than silently broken;
- the endpoint-group matrix reaches required coverage before default cutover;
- no session relies on a mixture of incompatible legacy and v2 semantics.

## Phase 8: Preview, migration, and cutover

### Preview

- Publish `kilo2` through an opt-in preview channel.
- Keep production `kilo` installed and untouched as the rollback path.
- Monitor crashes, protocol failures, auth failures, session durability, and
  provider leakage.
- Validate packaging, signing, updating, and coexistence on every supported OS.

### Data decision

Use the Phase 0 report to select one explicit GA policy:

- a clean start;
- an opt-in one-way import with backup and verification;
- or a supported migration tool with rollback documentation.

Never let both versions write the same database. A migration must have failure
recovery and a way to return to the untouched v1 store.

### Default-cutover gate

Make v2 the default only when:

- required ledger capabilities are complete or explicitly dropped;
- required VS Code, Agent Manager, and JetBrains support is complete according
  to G3;
- migration and rollback behavior matches G2;
- security and cross-platform gates pass;
- packaging and update channels are production-ready;
- the v1 rollback window and eventual cleanup policy are documented.

## First ten reviewable PRs

These PRs begin in the isolated v2 worktree and target
`johnnyeric/kilo-opencode-v2`. This planning document is not a PR of its own; it
ships as a supporting artifact of PR 1.

1. Pin the upstream baseline, record pristine build/typecheck/test evidence,
   document v2 fork conventions, and carry this plan into the branch. Committed
   locally on `johnnyeric/v2-baseline` as Phase 0 slice 1, pending review and
   integration; a fork CI workflow is deferred, with the reasons recorded in
   `kilocode/baseline/pinned-v2-baseline.md`.
2. Add parity-ledger generation and produce ledger v0.
3. Add the Core schema and data-migration feasibility report, then record G1
   through G5.
4. Add upstream-v2 drift detection, snapshot handling, and dev-fix triage.
5. Add the isolated `kilo2` identity and storage shell.
6. Add the first Kilo schema/protocol extension and client-generation pipeline.
7. Add isolated credentials and Kilo Gateway device-flow login.
8. Add the Kilo provider and real model listing.
9. Add streamed `kilo2 run` with event and cost checks.
10. Add the non-Kilo control provider and leakage/security matrix.

Later runtime, tool, TUI, and client PRs are ordered from the generated ledger.

## Definition of done for every slice

- Record the exact upstream baseline and source Kilo commits.
- Update the parity ledger.
- Keep Kilo logic in Kilo-owned paths where possible.
- Keep shared upstream changes minimal and mark them with `kilocode_change`.
- Regenerate protocol and client surfaces together.
- Report generated and handwritten diffs separately.
- Run the smallest relevant typecheck, tests, build, and repository guards.
- Use real implementation behavior and captured external fixtures; avoid mocks
  that duplicate production logic.
- Validate security, permissions, cancellation, filesystem, network, and
  process boundaries affected by the slice.
- Validate Windows whenever paths, PTYs, signals, services, or child processes
  change.
- Validate a non-Kilo provider whenever global provider behavior changes.
- Merge the latest pinned `upstream/v2` and review drift before declaring the
  slice ready.

Phase 0 must record the authoritative v2 commands. Do not assume the current
main-branch `packages/opencode` commands apply after moving to `packages/cli`.

## Merge-conflict policy

- Prefer Kilo-owned directories in the reorganized v2 packages.
- Use narrow, independently reviewable hooks in shared files.
- Do not refactor upstream code while adding a Kilo hook.
- Preserve `kilocode_change` markers in shared upstream files and keep Kilo
  files free of unnecessary markers.
- Run the annotation and Promise-facade guards whenever their affected shared
  service areas are touched.
- Resolve upstream merges in favor of the current v2 architecture, then
  reapply the Kilo invariant through its owned seam.
- Re-run the relevant ledger and contract checks after every upstream merge.

## Replan triggers

Stop feature work and revisit the plan when:

- upstream force-pushes or replaces the v2 branch ancestry;
- upstream announces that v2 will be squashed or merged into another release
  line;
- the Gateway proof requires a broad shared-core fork rather than a narrow
  seam;
- storage analysis shows the preview can corrupt or accidentally share
  production state;
- the non-Kilo provider control reveals global policy leakage;
- generated-client boundaries cannot support required TUI or IDE behavior;
- a required client would need the complete legacy API recreated on v2;
- the ledger grows materially because new v1 work was not classified.

## Planning deliverables before implementation

Phase 0 produces:

- pinned-ref and pristine-baseline report;
- generated parity ledger v0;
- Core schema and data-migration feasibility report;
- upstream-v2 drift and dev-fix report;
- G1 through G5 decision records;
- initial PR backlog with owners and validation commands.

Only after those artifacts are reviewed should the project estimate effort or
start PR 5, the isolated `kilo2` shell.
