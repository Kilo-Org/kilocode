> Work In Progress

## Summary

Migrate Kilo onto the OpenCode v2 architecture as a **target-shaped port**, not a merge of `main` into `v2`, and not a second `packages/opencode` host.

- Branch: `kilo-v2`, tracking a **pinned** `upstream/v2` SHA (record in the repo baseline doc). Merge forward once history is shared; perpetual rebase is not the standing policy.
- `main` stays the V1 product line.
- Related (different approach): #12887

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
3. **Plugin** — Location-scoped `kilo-*` packages on upstream seams: `catalog.transform` / integration transforms, `Tool.Service` registration (executable tools; later transform wins on name), `session.context` (prompt/tool metadata only — that hook cannot invent executables), `tool.execute.before` / `.after`, `permission.evaluate`. Plugins do not add Protocol endpoints or become the host.

Clients depend on Schema and Protocol only. Core and Server stay behind HTTP. Do not call private Core from Gateway or UI.

Prefer, in order: `kilo-*` plugin seams → host `ServerOptions` / identity → Protocol / Schema / Server only when an upstream endpoint's shape must change → shared-file patch (marked, counted).

## Fork boundary and upstream updates

The dependency graph is the protection; markers are leftover debt.

Prefer, in order:

1. `kilo-*` packages (`kilo-gateway`, `kilo-memory`, `kilo-indexing`, `kilo-sandbox`, VS Code, JetBrains). These are Kilo-owned additions, not upstream patches.
2. Upstream v2 seams: `catalog.transform` or native `packages/ai`; Location-scoped plugin hooks; `ServerOptions` on the host; Kilo-owned Protocol / Schema / Server modules only when the public contract needs a Kilo field.
3. Kilo-prefixed paths inside packages we wrap (`packages/cli`, Protocol / Schema / Server). Do not create a new Kilo subtree inside `packages/core/src/session/runner`.
4. Shared-file patches only when no seam exists. Mark each one with the existing Kilo marker convention and keep an exact count. The count must not grow without an explicit exception.

**Current shared-patch count on `kilo-v2`: 4** (`AGENTS.md`; `packages/plugin/src/tui/context.ts` `home.logo` slot; `packages/tui/src/app.tsx` pluginDirectories; `packages/tui/src/routes/home.tsx` Slot `home.logo`). Growing past 4 needs an explicit exception.

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

Completeness is the inventory below, not extra phases. Flip Status on a row when a slice lands.

### 0 — Isolated identity (internal preview, current)

Internal preview binary: own XDG, empty DB, branding, fail-closed. Not a customer release.

**Done when:** stable `kilo` and the internal preview run side by side; two stores; boot does not migrate.

### 1 — Kilo API seam

One real Kilo-owned operation end-to-end through the generated client and a `kilo-*` plugin/host path, without importing Core. Upstream `@opencode-ai/client` already covers generic session/prompt/events — that alone is not this gate. Protocol / Schema / Server edits only when an upstream endpoint's shape must change; record each exception.

**Done when:** e.g. gateway auth or org switch works through the client + plugin path with no Core import; any Protocol change is listed.

### 2 — One native conversation

Stream, tools, permissions, interrupt, resume, restart through that contract.

**Done when:** one headless path goes prompt → idle and survives reconnect.

### 3 — Runtime + `kilo-*` packages

Memory, indexing, sandbox, telemetry, gateway policy, skills/agents. Reuse packages; change registration.

**Done when:** those inventory rows are done or obsolete.

### 4 — CLI / TUI remainder

`/review`, privacy, themes, `kilo run --auto`, export, resume-claude/codex, `/remote`, `kilo cloud`.

**Done when:** Phase 4 inventory rows are done or obsolete.

### 5 — Product clients

VS Code sidebar, editor tabs, Agent Manager, settings webview, JetBrains. Capability handshake. Never mix V1 and V2 routes in one session.

**Done when:** Phase 5 inventory rows are done or obsolete.

### 6 — Import / canary / cutover

Host prompt + copy-then-migrate-the-copy. Originals untouched. Canary identity (`kilo2` vs `kilo` + channel) is an explicit gate before shipping the importer — not deferred silently.

**Done when:** schema-diff + fixture pass; opt-in import works including credentials and Kilo config keys; V1 still opens the original store; canary is isolated.

## Inventory (Kilo-Org/kilocode)

Status: `not-started` · `in-progress` · `done` · `started` · `unknown` · `obsolete`

| Capability | Owner | Phase | Status |
| --- | --- | --- | --- |
| Kilo logo / branding | 4 shared patch or upstream hook | 0 | started |
| Isolated `kilo2` identity + config/data dirs | 2 host | 0 | started |
| Gateway device auth / profile | 3 plugin (`integration.transform`) | 0–1 | started |
| Organization / team (`/teams`) | 3 plugin (+ TUI); Protocol only if shape must change | 0–1 | started |
| Gateway catalog, BYOK, org routing (`kilo-gateway`) | 3 plugin (`catalog.transform`); note upstream `KiloPlugin` headers | 1 | started |
| `kilo serve` / daemon / attach | 2 host | 1 | started |
| Generated JS SDK | upstream `@opencode-ai/client`; Kilo = plugin/RPC typings only if published | 1 | upstream-equivalent |
| Session share / unshare / fork-from-share | 3 plugin + Kilo backend; Protocol only if fork-from-share needs it | 1 | not-started |
| Memory (`/memory`) | 3 + `kilo-memory` | 3 | not-started |
| Codebase indexing | 3 + `kilo-indexing` | 3 | not-started |
| Sandbox tool shells (macOS/Linux) | 3 + `kilo-sandbox` (`shell.hook` / tool path) | 3 | not-started |
| Sandbox PTY / MCP / git spawn policy | 2 host, or explicitly out of scope | 3 | not-started |
| OpenTelemetry / telemetry | 2 or 3 | 3 | unknown |
| Kilo Swarm | unknown — resolve or `defer` before Phase 3 | 3 | unknown |
| Skills, custom agents, `.kilo/agents` | 3 | 3 | not-started |
| Project config discovery (`.kilo/`, `kilo.jsonc` vs `.opencode`) | 2 host seam or accept upstream names | 0–1 | not-started |
| Local `/review` | 2 host | 4 | not-started |
| CLI TUI remainder | 2 host | 4 | not-started |
| `kilo run --auto`, session export/import, resume Claude/Codex | 2 host | 4 | not-started |
| `/remote` | 2 + Gateway | 4 | not-started |
| `kilo cloud` CLI client | 2 + Gateway | 4 | not-started |
| Updater / update channel / packaging | 2 host (consequence of kilo-cli path) | 4 | not-started |
| ACP | 2 host (upstream in `packages/cli`, not exported) | 4 | not-started |
| Credential import (`auth.json` → v2) | 2 host | 6 | not-started |
| `kilo.jsonc` key mapping (Kilo-only keys) | 2 host | 6 | not-started |
| V1 schema-diff + fixture import test | 2 host | 6 | not-started |
| VS Code sidebar chat | 2 Protocol client | 5 | not-started |
| VS Code editor tabs | 2 client | 5 | not-started |
| Agent Manager | 2 client | 5 | not-started |
| VS Code settings webview | 2 client | 5 | not-started |
| Inline autocomplete / FIM | 2 client | 5 | unknown |
| Code actions, enhance prompt, git commit generation | 2 client | 5 | unknown |
| Task timeline, diff viewer | 2 client | 5 | not-started |
| Voice / speech-to-text | unknown | 5 | unknown |
| JetBrains plugin | 2 client | 5 | not-started |
| Kilo Console | — | — | obsolete |

**Overlap with upstream v2** (do not rebuild): permissions, MCP, snapshots, compaction, session fork, ACP, plugins, subagents, `webfetch` / `websearch`, daemon HTTP+SSE. Port Kilo policy on these, not a second engine.

## First slice

Phase 0 on `kilo-v2` (internal): identity, empty store, branding (shared patch / hook), fail-closed. Not shipped to customers.

Phase 1 in progress: gateway auth + catalog as owner-3 plugins; generated client is upstream-equivalent; prove one Kilo operation (auth/org) as the real seam gate. `kilo serve` partial (interactive + admission-only; no daemon attach).
