> Work in progress — status reviewed September 10, 2026.

## Branch: [`kilo-v2`](https://github.com/Kilo-Org/kilocode/tree/kilo-v2)

| Quick reference | Link / status |
|---|---|
| Start here | [Migration tracking](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking) |
| Detailed progress | [Implementation and verification inventory](https://github.com/Kilo-Org/kilocode/blob/kilo-v2/migration-tracking/plans/kilo-opencode-v2-plan-progress.md) |
| Remaining work | [Subissues](#subissues) |
| Verification | End-to-end acceptance is incomplete; implemented does not mean fully verified. |
| Product lines | `kilo-v2`: migration work · `main`: v1 product line |

## Summary

The isolated Kilo v2 CLI/runtime foundation is implemented. The original Kilo VS Code interface now builds and has working backend adapters, but full original-client parity and acceptance remain incomplete.

A source assessment of 816 v1 files containing 6,128 Kilo change annotations is complete. It identifies partial and missing behavior as well as native equivalents; it does not grant runtime acceptance.

The inventory below retains the original 36 capability rows. The repository's expanded plan separates these into 88 finer-grained rows.

**Continuing the work:** use the [`migration-tracking/` folder on `kilo-v2`](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking) as your starting point.

1. Read the [progress plan](https://github.com/Kilo-Org/kilocode/blob/kilo-v2/migration-tracking/plans/kilo-opencode-v2-plan-progress.md) and choose an open subissue below.
2. Follow `AGENTS.md` and the [fork conventions](https://github.com/Kilo-Org/kilocode/blob/kilo-v2/migration-tracking/technical-notes/v2-fork-conventions.md); use the relevant technical notes, source assessment and test plans to understand the remaining behavior.
3. Update the repository plan and subissue with changes, verification results and remaining gaps. Keep implementation status separate from end-to-end acceptance.


Migrate Kilo onto the OpenCode v2 architecture as a **target-shaped port**, not a merge of `main` into `v2`, and not a second `packages/opencode` host.

- Branch: `kilo-v2`, tracking a **pinned** `upstream/v2` SHA (record in `migration-tracking/technical-notes/baseline/pinned-v2-baseline.md`). Merge forward once history is shared; perpetual rebase is not the standing policy.
- `main` stays the V1 product line.
- Related (different approach): #12887

## CLI preview
Kilo v2 CLI development preview, September 10, 2026. This screenshot illustrates the interface; end-to-end acceptance remains tracked separately.

![Kilo v2 CLI showing a Plan session, session tabs, questions and usage sidebar](https://raw.githubusercontent.com/Kilo-Org/kilocode/kilo-v2/migration-tracking/assets/kilo-v2-cli-2026-09-10.png)

## VS Code extension preview

Original Kilo Code interface running against v2, September 10, 2026. Development preview; full original-client acceptance remains incomplete.

**Known startup issue:** this preview is currently started in Restricted Mode as a workaround for a reported conflict with the main VS Code instance’s keys. The underlying conflict still needs investigation and a fix; Restricted Mode is not the intended final setup.

![Kilo Code v2 VS Code extension showing sidebar conversation and Agent Manager panel](https://raw.githubusercontent.com/Kilo-Org/kilocode/kilo-v2/migration-tracking/assets/kilo-v2-vscode-2026-09-10.png)

## What this is not

- Wholesale `main` merge into the v2 branch
- Keeping `packages/opencode` as a legacy host on v2 (that package is gone on `origin/v2`)
- Dual-running V1 and V2 against the same SQLite file or the same live `kilo.jsonc`
- Ambient V1→V2 migration on preview startup
- Implementing the whole product as a stack of plugins (plugins are owner 3. Identity, SQLite path, daemon topology, and IDE backends are host. Protocol/Schema/Server edits are the exception, not the default.)

## Placement

Each Kilo capability maps to **one** owner:

1. **Catalog / provider** — `catalog.transform`, or a native `packages/ai` provider, for model/protocol only.
2. **Host** — product binary and daemon topology. Current path is a from-scratch `packages/kilo-cli` (upstream `packages/cli` does not export a wrap surface for commands, service manager, updater, or ACP). Cost: re-own `kilo serve` / daemon / attach, updater, ACP. Alternative not taken: build the upstream CLI under Kilo identity (`OPENCODE_CLI_NAME` / channel defines) plus a narrow app-name hook. VS Code, JetBrains, and Agent Manager are Protocol clients of the local server — not OpenCode's `sdks/vscode`.
3. **Plugin** — Location-scoped `kilo-*` packages on upstream seams: `catalog.transform` / integration transforms, `Tool.Service` registration (executable tools; later transform wins on name), `session.context` (prompt/tool metadata only — that hook cannot invent executables), `tool.execute.before` / `.after`, `permission.evaluate`. Plugins do not become the host. Kilo-owned RPC registrations use the existing public RPC transport; add or change Protocol endpoints only when that transport and native interfaces are insufficient.

Clients depend on Schema and Protocol only. Core and Server stay behind HTTP. Do not call private Core from Gateway or UI.

Prefer, in order: `kilo-*` plugin seams → host `ServerOptions` / identity → Protocol / Schema / Server only when an upstream endpoint's shape must change → shared-file patch (marked, counted).

## Fork boundary and upstream updates

The dependency graph is the protection; markers are leftover debt.

Prefer, in order:

1. `kilo-*` packages (`kilo-gateway`, `kilo-memory`, `kilo-indexing`, `kilo-sandbox`, VS Code, JetBrains). These are Kilo-owned additions, not upstream patches.
2. Upstream v2 seams: `catalog.transform` or native `packages/ai`; Location-scoped plugin hooks; `ServerOptions` on the host; Kilo-owned Protocol / Schema / Server modules only when the public contract needs a Kilo field.
3. Kilo-prefixed paths inside packages we wrap (`packages/cli`, Protocol / Schema / Server). Do not create a new Kilo subtree inside `packages/core/src/session/runner`.
4. Shared-file patches only when no seam exists. Mark each one with the existing Kilo marker convention and keep an exact count. Any increase needs an explicit explanation of the missing interface and its maintenance cost.

As of September 10, 2026, **24 upstream source files carry `kilocode_change` annotations: 5 Core, 4 theme, 1 plugin and 14 TUI files, plus `AGENTS.md`**. This counts marked source files, excluding Kilo-owned packages/subtrees, tests and README branding translations. The original bootstrap footprint was four files. The measured file list is in `migration-tracking/marker-audit/v2-shared-source-footprint-2026-09-10.md`; hook explanations remain beside the marked changes. Source-to-destination mappings are recorded in `migration-tracking/marker-audit/v1-kilo-marker-port-assessment.md`.

Take `upstream/v2` in controlled steps. Do not merge `main` wholesale into `kilo-v2`. Avoid Core forks for the migrator, runner, and private APIs; those are the highest merge tax.

## Store and config

V1 session DB and live `kilo.jsonc` are not compatible with this port. Sharing them corrupts data.

OpenCode v2's `V1Migration.transformSession` rewrites the SQLite file it opened (Bun only; Node/workerd is a no-op). OpenCode maps mixed v1/v2 config in memory and does not rewrite the file.

**Rules**

- **Preview identity is not a customer SKU.** Internally the preview uses a separate application identity (`kilo2`) so paths cannot collide with stable `kilo` or with OpenCode. Do not ship `kilo2` to customers. The product name stays `kilo`. When v2 becomes the default `kilo` binary, move v1 data/config dirs aside first, then take the `kilo` paths.
- Same project directory is Location, not the DB file. One SQLite per application graph.
- **Boot:** create/open only the `kilo2` file (empty if missing). No `session` table means the migrator does not run. If the resolved path is the live Kilo or OpenCode store, refuse to serve. Assert/test that upstream `V1Migration.layer` is a no-op on empty `kilo2` (no `session` table). The ambient fiber may still start; that is upstream debt to watch, not a Core fork.
- **Import (phase 6):** explicit and opt-in. Copy the live V1 DB, migrate the copy, never the original. Copy selected config keys into a new file; never rewrite live `kilo.jsonc`. The host (`packages/cli` / `kilo-cli`) owns detection, prompt, and copy-import — not a plugin. Do not ship the prompt until the importer exists. Precondition: a read-only schema diff of Kilo `main`'s store against the migrator's expected `session` / `session_message` / `event` tables, tested on a real Kilo `main` fixture. Note: upstream migrator also imports a sibling `opencode-next.db` when present. Also import `auth.json` → v2 credentials and map Kilo-only `kilo.jsonc` keys (upstream in-memory migrate only knows upstream v1 keys).
- **Rollback:** run the V1 `kilo` binary on the original files. There is no reverse migration. Leftover V1 tables on a migrated copy are not a way back.
- Do not fork `V1Migration` to take a destination path. Separate path is host identity (upstream already has `OPENCODE_DB` and channel DBs).

## Phases

Scope and exit criteria are unchanged; each phase now shows current status. Detailed acceptance is in the repository plan and subissues.

### 0 — Isolated identity (internal preview)

**Status:** Isolated preview identity implemented.

Internal preview binary: own XDG, empty DB, branding, fail-closed. Not a customer release.

**Done when:** stable `kilo` and the internal preview run side by side; two stores; boot does not migrate.

### 1 — Kilo API seam

**Status:** Gateway auth, organization selection and catalog integration use the public client and Kilo Gateway with no `@opencode-ai/core` import in `kilo-gateway`. Kilo contracts occupy ten owned Schema modules under `packages/schema/src/kilocode/`.

One real Kilo-owned operation end-to-end through the generated client and a `kilo-*` plugin/host path, without importing Core. Upstream `@opencode-ai/client` already covers generic session/prompt/events — that alone is not this gate. Protocol / Schema / Server edits only when an upstream endpoint's shape must change; record each exception.

**Done when:** e.g. gateway auth or org switch works through the client + plugin path with no Core import; any Protocol change is listed.

### 2 — One native conversation

**Status:** Native conversation foundation implemented; original-client acceptance continues.

Stream, tools, permissions, interrupt, resume, restart through that contract.

**Done when:** one headless path goes prompt → idle and survives reconnect.

### 3 — Runtime + `kilo-*` packages

**Status:** Partial: policy variants, original-client consumers and detailed acceptance remain.

Memory, indexing, sandbox, telemetry, gateway policy, skills/agents. Reuse packages; change registration.

**Done when:** those inventory rows are done or obsolete.

### 4 — CLI / TUI remainder

**Status:** Partial: themes, notifications, session-scope UI, remote/sharing acceptance and packaging remain.

`/review`, privacy, themes, `kilo run --auto`, export, resume-claude/codex, `/remote`, `kilo cloud`.

**Done when:** Phase 4 inventory rows are done or obsolete.

### 5 — Product clients

**Status:** Original VS Code port in progress; JetBrains and additional consumers remain.

VS Code sidebar, editor tabs, Agent Manager, settings webview, JetBrains. Capability handshake. Never mix V1 and V2 routes in one session.

**Done when:** Phase 5 inventory rows are done or obsolete.

### 6 — Import / canary / cutover

**Status:** Supported copy-import paths implemented; canary, distribution and production cutover acceptance remain.

Host prompt + copy-then-migrate-the-copy. Originals untouched. Canary identity (`kilo2` vs `kilo` + channel) is an explicit gate before shipping the importer — not deferred silently.

**Done when:** schema-diff + fixture pass; opt-in import works including credentials and Kilo config keys; V1 still opens the original store; canary is isolated.

## Inventory (Kilo-Org/kilocode)

> **End-to-end acceptance is incomplete.** Implementation describes code coverage, not confirmation that the full capability works end to end. Verification applies only to the tested scope; no row below claims complete E2E acceptance.

Status: **implemented** = stated local slice verified, not release-wide approval; **native reuse** = native generic behavior; **partial** = concrete work or acceptance remains; **needs port** = required behavior missing; **deferred** = awaits a later implementation or an external dependency; **obsolete** = not required. Broader audit findings can reopen an implemented requirement.

Verification: **Local checks passed** means recorded focused tests or isolated integration checks for the stated slice. **Pending** means acceptance remains open. Partial rows may have passing tests for individual paths; their scope notes describe the limits.

| Capability | Owner | Phase | Implementation | Verification | Status detail / remaining work |
|---|---|---|---|---|---|
| Kilo logo / branding | 2 host + shared `home.logo` slot | 0 | implemented | Local checks passed; full E2E pending | Preview branding; full legacy theme catalogue remains under CLI/TUI parity. |
| Isolated `kilo2` identity + config/data dirs | 2 host | 0 | implemented | Local checks passed; full E2E pending | Separate preview stores; production cutover is a separate gate. |
| Gateway device auth / profile | 3 plugin (`integration.transform`) | 0–1 | implemented | Local checks passed; full E2E pending | Local authentication/profile covered; deployed verification remains. |
| Organization / team (`/teams`) | 3 plugin + client UI | 0–1 | implemented | Local checks passed; full E2E pending | Selection and scoped requests covered locally; original-client variants remain. |
| Gateway catalog, BYOK, org routing (`kilo-gateway`) | 3 Gateway plugin + host policy | 1 | implemented | Local checks passed; full E2E pending | Catalog/request policy and eight prompt selectors covered locally. |
| `kilo serve` / daemon / attach | 2 host | 1 | implemented | Local checks passed; full E2E pending | Native daemon and attach paths exist; client lifecycle acceptance is separate. |
| Generated JS SDK | Native Client + 3 Kilo RPC definitions | 1 | native reuse | Kilo integration E2E pending | Public typed client; no legacy SDK runtime required. |
| Session share / unshare / fork-from-share | 3 plugin + sharing backend + clients | 1 | partial | Full E2E pending; see scope notes | Local client paths exist; viewer, ownership, synchronization and deployed acceptance remain. |
| Memory (`/memory`) | 3 plugin + Kilo memory engine | 3 | partial | Full E2E pending; see scope notes | CLI/TUI and adapter slices exist; source-assessment gaps and original-client consumers remain. |
| Codebase indexing | 3 plugin + Kilo indexing engine | 3 | partial | Full E2E pending; see scope notes | Runtime implemented; original-client controls and detailed acceptance remain. |
| Sandbox tool shells (macOS/Linux) | 3 plugin + Kilo sandbox | 3 | partial | Full E2E pending; see scope notes | Shell confinement exists; complete legacy policy variants and platform acceptance. |
| Sandbox PTY / MCP / git spawn policy | 2 host decorators + shared MCP hook | 3 | implemented | Local checks passed; full E2E pending | Local MCP confinement and PTY create refusal; model-requested git uses shell confinement. |
| OpenTelemetry / telemetry | 2 host / 3 plugin | 3 | partial | Full E2E pending; see scope notes | Runtime integration exists; original extension proxy/consumer parity remains. |
| Kilo Swarm | 3 plugin + host permission policy | 3 | implemented | Local checks passed; full E2E pending | Scoped orchestration implemented; Agent Manager is a separate capability. |
| Skills, custom agents, `.kilo/agents` | 3 discovery + native agent/skill services | 3 | partial | Full E2E pending; see scope notes | Discovery works; original management/removal consumers remain. |
| Project config discovery (`.kilo/`, `kilo.jsonc` vs `.opencode`) | 2 host configuration integration | 0–1 | implemented | Local checks passed; full E2E pending | Native folding with Kilo project discovery. |
| Local `/review` | 3 command policy + native review | 4 | implemented | Local checks passed; full E2E pending | Generic review reused; Kilo policy integrated. |
| CLI TUI remainder | 2 host + owned TUI extensions | 4 | partial | Full E2E pending; see scope notes | Many workflows work; audit identifies remaining notification, theme, scope and presentation gaps. |
| `kilo run --auto`, session export/import, resume Claude/Codex | 2 host through native client | 4 | implemented | Local checks passed; full E2E pending | Headless run and supported transfers/import formats locally covered. |
| `/remote` | 2 adapter + Gateway | 4 | partial | Full E2E pending; see scope notes | Local transport/features covered; deployed relay/consumer acceptance remains. |
| `kilo cloud` CLI client | 2 host + Gateway | 4 | implemented | Local checks passed; full E2E pending | Local CLI contract covered; deployed-service acceptance remains. |
| Updater / update channel / packaging | 2 host + release tooling | 4 | partial | Full E2E pending; see scope notes | Real local directory update/rollback works; archives, signing and distribution remain. |
| ACP | 2 host over native ACP | 4 | implemented | Local checks passed; full E2E pending | Product launcher/host surface implemented. |
| Credential import (`auth.json` → v2) | 2 explicit import | 6 | implemented | Local checks passed; full E2E pending | Supported mappings preserve originals; unsupported inputs fail explicitly. |
| `kilo.jsonc` key mapping (Kilo-only keys) | 2 explicit import | 6 | implemented | Local checks passed; full E2E pending | Safe mapping implemented; unsupported feature keys remain documented refusals. |
| V1 schema-diff + fixture import test | 2 import tooling | 6 | implemented | Local checks passed; full E2E pending | Schema/source comparisons and fixture migration recorded. |
| VS Code sidebar chat | 2 original Kilo VS Code client | 5 | partial | Full E2E pending; see scope notes | Original UI builds; backend/lifecycle slices work; complete original-UI acceptance remains. |
| VS Code editor tabs | 2 original Kilo VS Code client | 5 | partial | Full E2E pending; see scope notes | Panel sources and adapters exist; verify original tab/restore workflows end to end. |
| Agent Manager | 2 original Kilo VS Code client | 5 | partial | Full E2E pending; see scope notes | UI builds; control-plane and notebook behavior remain incomplete. |
| VS Code settings webview | 2 original client + Kilo settings RPC | 5 | partial | Full E2E pending; see scope notes | Supported settings/collections/refresh work; complete original controls and acceptance. |
| Inline autocomplete / FIM | 2 editor client + service integration | 5 | needs port | Pending | Original autocomplete/FIM and next-edit consumer/service contracts remain. |
| Code actions, enhance prompt, git commit generation | 2 editor client + Kilo generation RPC | 5 | partial | Full E2E pending; see scope notes | Generation backend covered; original editor/SCM workflow acceptance remains. |
| Task timeline, diff viewer | 2 original client + native projections | 5 | partial | Full E2E pending; see scope notes | Complete original timeline and authoritative diff/restore details. |
| Voice / speech-to-text | 2 client + transcription provider | 5 | deferred | Pending | Client integration and transcription provider acceptance. |
| JetBrains plugin | 2 v2 client integration | 5 | deferred | Pending | Port and validate the original plugin against v2. |
| Kilo Console | — | — | obsolete | Not applicable | Not required by the target plan. |

**Overlap with upstream v2** (do not rebuild): permissions, MCP, snapshots, compaction, session fork, ACP, plugins, subagents, `webfetch` / `websearch`, daemon HTTP+SSE. Port Kilo policy on these, not a second engine.

### Additional consumers to assess

Beyond the original inventory, these consumers need assessment before product-wide compatibility is claimed:

| Consumer | Phase | Status | Required next step |
|---|---|---|---|
| Cloud agent runtime consumers | 5; rollout depends on 6 | Assessment required | Identify actual consumers and map execution, client and deployment contracts. Existing cloud CLI or remote coverage is insufficient. |
| Anaconda Desktop and related integrations | 5 | Assessment required | Identify the exact client and integration mode, then establish required changes or evidence-backed compatibility. |

These rows are new scope under assessment. Add other clients as discovery identifies them.

## Next milestones

1. Complete the original VS Code contracts and typecheck gaps, then verify original chat, panels, settings, terminals, reconnect and interruption end to end.
2. Resolve remaining runtime and CLI/TUI behavior identified by the source assessment.
3. Complete sharing and remote integration contracts and their external acceptance when permitted.
4. Complete outstanding editor services and JetBrains scope, or record a product decision to reduce scope.
5. Finish platform distribution, signing, and opt-in import/canary acceptance before cutover.

## Subissues

- [#14016 — Complete original Kilo VS Code client parity](https://github.com/Kilo-Org/kilocode/issues/14016)
- [#14017 — Complete remaining runtime and CLI/TUI parity](https://github.com/Kilo-Org/kilocode/issues/14017)
- [#14018 — Complete v2 session sharing compatibility and acceptance](https://github.com/Kilo-Org/kilocode/issues/14018)
- [#14019 — Complete remote session consumer acceptance](https://github.com/Kilo-Org/kilocode/issues/14019)
- [#14020 — Complete distribution and safe migration cutover](https://github.com/Kilo-Org/kilocode/issues/14020)
- [#14021 — Complete remaining editor services](https://github.com/Kilo-Org/kilocode/issues/14021)
- [#14022 — Port the JetBrains plugin to v2](https://github.com/Kilo-Org/kilocode/issues/14022)
- [#14023 — Assess and integrate cloud agent consumers with v2](https://github.com/Kilo-Org/kilocode/issues/14023)
- [#14024 — Assess and integrate Anaconda Desktop and related clients with v2](https://github.com/Kilo-Org/kilocode/issues/14024)

## Detailed tracking

- Repository plan: `migration-tracking/plans/kilo-opencode-v2-plan-progress.md`.
- Source-to-destination assessment: `migration-tracking/marker-audit/v1-kilo-marker-port-assessment.md`.

Use dated comments for completed checkpoints and changed decisions. Use subissues for independently owned remaining deliverables, with acceptance criteria and links back to the detailed inventory.
