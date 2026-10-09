# Cloud agent consumer contracts — mapping and dispositions

Discovery for Kilo-Org/kilocode#14426 (parent epic #14023), building on #14425.
Discovery only: no source changes in any repository.

## Header

| Item | Value |
|---|---|
| Date | 2026-10-07 (amended; first pass 2026-10-05) |
| Cloud repo | `Kilo-Org/cloud` at `3de933dd85070e9d15c41d8ff3af6c91ca856fd4` (read-only clone `/Users/fpliger/dev/kiloverse/cloud`) |
| This repo, `origin/main` (v1) | `62f674d4a91969ac077e4a7b6ceeb8a99de80e47` |
| This repo, `kilo-v2` (v2) | `782263326df5be50081517ddedd937f1080a89cf` |
| Upstream opencode, `origin/v2` | `f20f5b68ee318721c453fb19d20e46d2b9225bc0` (clone `/Users/fpliger/dev/opencode`) |
| #14425 inventory | `migration-tracking/technical-notes/baseline/cloud-agent-consumers.md` |

#14425 assessed the cloud repo at the same SHA; its this-repo SHAs were older
(`origin/main` `622ed1f5`, `kilo-v2` `a2e6c1f6`, both ancestors of the SHAs
above). Owners, pinning and recommended gates below are reused from #14425 and
not re-derived.

## How to read this document

This is the second pass. The first pass (2026-10-05) mapped the cloud consumers
against **kilo2's current surface** and framed most problems as "v2 must build
this." That framing was incomplete: `packages/kilo-cli` on `kilo-v2` is a
**thin, diverged fork** of upstream opencode's v2 `packages/cli`, and upstream
`origin/v2` already contains much of what the consumers need (a headless
`serve` with host/port, a streaming `run --format json`, `session import` from
a file or URL, and a v1→v2 session-history migration). Where kilo2 differs from
upstream, the divergence is called out explicitly and the fix is usually "sync
kilo-v2 forward," not "design something new."

A second correction: the terms are overloaded. The **v1 SDK's `v2` subpath** is
the second-generation SDK API that talks to the **v1** runtime over v1 routes;
it is unrelated to the **v2 runtime** on `kilo-v2`. Citations say
`@kilocode/sdk/v2` when they mean the former and `kilo-v2:<path>` when they mean
the latter.

### Owner decisions recorded (2026-10-07)

1. **Release channel:** v2 ships on a new pre-release channel called **`next`**;
   `@kilocode/cli@latest` stays on the v1 line for the migration. (No `next`
   channel exists yet; see G2.)
2. **Binary contract:** keep the **`kilo2`** binary for the duration of the
   migration, then switch later if warranted. Cloud consumers adapt to `kilo2`.
3. **Credentials:** if v1 and v2 do not share auth, an import tool for users
   (which includes auth) is acceptable. They do not share auth automatically,
   but both upstream and Kilo already ship import paths (§1, §5, G6).
4. **Session migration goal:** migrate existing v1 users' sessions to v2; use
   what upstream opencode has. Confirmed: upstream `origin/v2` has a v1→v2
   session-history migration; kilo-v2 already vendors an older copy (§5, G11).
5. **Restore:** resolve from both kilo-v2 and upstream v2 (§4, G8).
6. **Deployed versions:** no v2 consumers are deployed and versions are pinned,
   so this is not an active concern; the `next` channel removes the residual
   risk from the two floating consumers.

These decisions supersede the corresponding "open questions" from the first
pass; the remaining open questions are at the end.

## Citation conventions

- `cloud@3de933dd <path>:<line>` — the cloud repo at the SHA above.
- `origin/main:<path>:<line>` — v1 runtime surface in this repo at the SHA above.
- `kilo-v2:<path>:<line>` — v2 runtime surface (kilo2 fork) at the SHA above.
- `origin/v2:<path>:<line>` — upstream opencode v2 surface at the SHA above.
- A bare `#14425` reference means the inventory document, not a GitHub issue.

## Scope and boundaries

In scope from #14425: **cloud-agent-next**, **auto-routing-benchmark**, **MCP
catalog generator (CI)**, **session-ingest** (contract-coupled).

Out of scope and not re-assessed: Gastown/KiloClaw (EOL by owner disposition),
code-review/auto-fix/auto-triage/security orchestration callers (no runtime),
app-builder, cloud-agent-sdk/web/mobile and the `/remote` relay (#14019), VS
Code Agent Manager (#14016), the `kilo cloud` CLI client. None of the four
in-scope consumers depend on the `/remote` relay; session-ingest is a distinct
HTTP/WS contract.

The cloud repo pins the v1 CLI/SDK at **7.8.1**. v2 publishes the CLI package as
`@kilocode/cli` too (`kilo-v2:packages/kilo-cli/package.json:2`), but it is
`private` with **no `bin`** and version `0.0.0-internal`, so "v2 reaches a
consumer" is a packaging + channel question, not a name question. Because v2
goes to `next` (not `latest`), the two floating consumers keep resolving the v1
CLI until they opt in.

## 1. cloud-agent-next

Primary hosted runtime; wrapper spawns `kilo serve`, imports `@kilocode/sdk` and
`@kilocode/sdk/v2`, and pins `KILOCODE_CLI_VERSION=7.8.1`
(`cloud@3de933dd services/cloud-agent-next/Dockerfile:6`;
`src/shared/kilo-cli-version.ts:1`;
`wrapper/package.json:11`).

| Area | Current behavior + evidence | v2 behavior + evidence | Breaks? | Change needed | Lands in |
|---|---|---|---|---|---|
| Startup | Two paths. Legacy wrapper calls `createKilo()`; the SDK spawns `kilo serve --hostname --port` and waits for stdout `kilo server listening` (`origin/main:packages/sdk/js/src/server.ts:62-90`; `origin/main:packages/opencode/src/cli/cmd/serve.ts:24`). Control-plane wrapper spawns `kilo serve --hostname=127.0.0.1 --port=0` and matches `/^kilo server listening on (http:\/\/127\.0\.0\.1:\d+)/` (`cloud@3de933dd wrapper/src/control-plane/kilo-runtime.ts:21,184`; `wrapper/src/main.ts:5-9,54,349-353`). | Built artifact is `kilo2` (Kilo decision; `kilo-v2:packages/kilo-cli/script/build.ts:35`; `script/build-tui.ts:29-41`), so the wrapper spawns `kilo2` and readiness must change: the interactive host prints `URL:` / `Password file:`, not a listening banner (`kilo-v2:packages/kilo-cli/src/tui-preview.ts:179-180`). kilo2's `serve` currently takes no `--hostname`/`--port` (`packages/kilo-cli/src/commands.ts:262-282`) and the headless `src/index.ts serve` is admission-only (`packages/kilo-cli/src/index.ts:11-19,52-57`). **Upstream already has the missing shape:** `serve --hostname --port --cors --service --stdio` (`origin/v2:packages/cli/src/commands/commands.ts`), so the fix is to align kilo2's serve with upstream, not invent one. | yes | Align kilo2's serve with upstream v2 (host/port, startup banner/readiness, auth) or define an explicit headless-spawn contract; cloud switches spawn to `kilo2` and the new banner/auth. | both (v2 contract first, then cloud) |
| Session admission | Wrapper calls `session.create`, `session.get`, `kilocode.sessionImport.session`, then `session.promptAsync` (async) with `parts`, `model.providerID=kilo`, `tools`, `agent` (`cloud@3de933dd wrapper/src/kilo-api.ts:380-384,389-395,407-449,456-459,343-368`). Session IDs are `ses_<hex><base62>` (`src/utils/kilo-session-id.ts:26-27`). Wrapper HTTP admission routes `/job/prompt`,`/job/command`,`/job/answer-*` (`wrapper/src/server.ts:1235-1251`); control-plane frames `session.prepare/prompt/abort/answer` (`src/shared/control-plane-protocol.ts:611-669`). | v2 admits a prompt durably: `POST /api/session`, `POST /api/session/:sessionID/prompt` returning a `SessionInbox.User` enqueue, with execution scheduled by `SessionExecution.wake` unless `resume:false` (`kilo-v2:packages/protocol/src/groups/session.ts:170,338`; `packages/core/src/session/session.ts:154-187`; `packages/core/src/session/inbox.ts:169-202,277-336`). There is no `prompt_async`; `session.prompt` is the async admission. v2 has `POST /api/session/import` for v2 transcripts, not the v1 `kilocode.sessionImport.session` shape (`packages/protocol/src/groups/session.ts:189`). | yes | Adapt the wrapper to v2 create/prompt/import routes and payloads; expose the capability handshake so the wrapper can select v1 vs v2 (N9). | both |
| Streaming | Subscribes via `v2Client.global.event` → `GET /global/event` (`cloud@3de933dd wrapper/src/kilo-api.ts:373-377`; `origin/main:packages/sdk/js/src/v2/gen/sdk.gen.ts:1586`), including a raw SSE topology (`wrapper/src/global-feed.ts:236-243`). Depends on events `message.updated`, `message.part.updated`, `session.idle`, `session.status`, `session.error`, `permission.asked`, `question.asked`, `session.turn.open/close`, `session.network.asked` (`wrapper/src/connection.ts:219-221,105-106,1173,1193,1232,1269`; `origin/main:packages/opencode/src/kilocode/session/event.ts`). Worker ingests by entity key `message.updated`→`message/{id}`, `message.part.updated`→`part/{msg}/{id}` (`src/session/ingest-handlers/entity-id.ts:12-27`). | v2 stream is `GET /api/event` SSE, volatile by contract (overflow fails the stream), 15 s heartbeats (`kilo-v2:packages/protocol/src/groups/event.ts:38-55`; `packages/server/src/handlers/event.ts:12-33`). Current events are `session.text.delta`, `session.tool.*`, `session.step.*`, `session.inbox.*`, `session.execution.*`, `session.status`; `session.idle` is deprecated; `message.updated`/`message.part.*` are V1-only (`packages/schema/src/session-event.ts:189,196,234,383,455-509`; `packages/schema/src/session-status-event.ts:35-51`; `packages/schema/src/v1/session.ts:597,613`). | yes | Map every consumed event to the v2 vocabulary (or add a compatibility projection); adapt the worker ingest entity keys to v2 events/messages. | both |
| Tools | Passes a permission map and MCP servers through `KILO_CONFIG_CONTENT` (`cloud@3de933dd src/session-service.ts:1334-1357,1404-1424,1467-1470`); MCP types `{type:local|remote}` (`src/mcp-config.ts:7-21`). Reads tool parts (`part.type==='tool'`) and replies via `permission.reply/list`, `question.reply/reject/list` (`wrapper/src/kilo-api.ts:546-591`); auto-approves or rejects permissions (`wrapper/src/connection.ts:1171-1196`). | v2 registers tools through `Tool.Service` (no authorization in the registry) and enforces in `Permission.Service` with a persisted `permission` SQLite table (`kilo-v2:packages/core/src/tool.ts:157-183,220-271`; `packages/core/src/permission.ts:214-310`; `packages/core/src/permission/sql.ts:7`). MCP is config-driven (`packages/core/src/config/plugin/mcp.ts:39-56`). v2 reads `OPENCODE_CONFIG_CONTENT` (`packages/core/src/config.ts:206-210`) but **not** `KILO_CONFIG_CONTENT` as an input (it is only an internal constant, `packages/kilo-cli/src/skill-policy.ts:12`). | yes | Confirm v2 reads the permission/provider/MCP payload the wrapper actually injects (or adapt the injected config key); adapt permission/question reply calls. | both |
| Credentials | Injects `KILOCODE_TOKEN` (opaque capability redeemed at the outbound proxy), `KILO_AUTH_CONTENT` and writes `.local/share/kilo/auth.json` `{kilo:{type:'api',key}}`; sets `provider.kilo.options.apiKey/kilocodeToken/baseURL` (`cloud@3de933dd src/session-service.ts:1277-1311,814-828,1404-1410`; `wrapper/src/session-bootstrap.ts:286-287,680-688`). v1 reads these (`origin/main:packages/opencode/src/auth/index.ts:61-63`; provider `packages/core/src/plugin/provider/kilo.ts:18-19`). Runtime credential proxy on the worker (`src/server.ts:273,341-344,448`). | v2 does **not** read `KILO_AUTH_CONTENT`, `KILOCODE_TOKEN`, or `KILO_API_KEY`/`KILO_ORG_ID`; credentials are rows in the isolated `credential` table, resolved from the gateway account (`kilo-v2:packages/core/src/credential.ts:99-134`; `packages/core/src/credential/sql.ts:5-14`). `KILO_API_URL` selects the gateway only (`packages/kilo-cli/src/tui-preview.ts:141`). Two import paths exist: upstream's DB migration imports `<global.data>/auth.json` into `credential` (`origin/v2:packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts`), and Kilo's `kilo2 import-v1 --auth <file> --apply [--gateway-server]` seeds the isolated profile (`packages/kilo-cli/src/commands.ts:216-238`; `packages/kilo-cli/src/import-v1-config.ts`). Note the public HTTP API intentionally has no credential-import RPC (`packaging-next-slice.md:168-169`), so a hosted consumer must seed via file/CLI or a new RPC. | yes (env path only) | For hosted consumers that inject env, add a v2 credential-injection path (a new env/RPC), or have the cloud write an `auth.json` into the v2 data dir / run `import-v1 --auth` before `run`. | both |
| Persistence | v1 identity is `kilo`: data `~/.local/share/kilo`, config `~/.config/kilo` (`origin/main:packages/core/src/global.ts:10-40`). Wrapper writes `$XDG_DATA_HOME/kilo/storage/session_share/<id>.json` `{id,ingestPath}` and runs `kilo import <snapshot.json>` after downloading `GET /api/session/:id/export` (`cloud@3de933dd wrapper/src/restore-session.ts:169-195,1069,1196-1207`). | v2 identity is `kilo2`: `~/.local/share/kilo2/...`, DB `kilo2.db` (`kilo-v2:packages/kilo-cli/src/paths.ts:6,26`), and it refuses the v1 store (`packages/kilo-cli/src/storage.ts:19-22`). v2 never reads `session_share/<id>.json`. v2 `import` decodes `SessionTransfer.Data {info,messages}` and rejects URLs (`packages/kilo-cli/src/commands.ts:353-370`; `packages/schema/src/session-transfer.ts:5-9`), but upstream v2 `session import` accepts a file **or URL** (`origin/v2:packages/cli/src/commands/handlers/session/import.ts`), and a v1→v2 history migration exists (§5). | yes | Move restore to the v2 transcript/import path (upstream `session import` accepts URLs); add a v1-export→`SessionTransfer.Data` converter reusing the migration's transform (§5, G8). | both |
| Cancellation | `v2Client.session.abort` → `POST /session/:id/abort` (`cloud@3de933dd wrapper/src/kilo-api.ts:468-472`; `origin/main:packages/sdk/js/src/v2/gen/sdk.gen.ts:4872`); wrapper `/job/abort` sends an `interrupted` ingest event (`wrapper/src/server.ts:1247,831-845`); control-plane `session.abort` (`wrapper/src/control-plane/turn.ts:859-866`); worker `markAsInterrupted`/`interruptExecution` (`src/router/handlers/session-management.ts:267-272`). | v2 route is `POST /api/session/:sessionID/interrupt`, returning `{interrupted:boolean}`; interruption targets the process-local ownership chain, idle is a no-op, unknown sessions are rejected (`kilo-v2:packages/protocol/src/groups/session.ts:665-685`; `packages/core/src/session/execution.ts:27-33,148-165`; `packages/core/src/session/run-coordinator.ts:142-162`). | yes | Adapt to the v2 interrupt route/semantics; keep the `interrupted` ingest signal. | both |

**Disposition: v2 client adaptation + runtime packaging change (both).**
cloud-agent-next is pinned at 7.8.1, so it keeps working until its own pin bump;
its cutover is independent with its own go/no-go (#14425). Nothing here is
"no change": binary, serve contract, routes, events, credentials, persistence and
cancellation all differ.

## 2. auto-routing-benchmark

Container installs `@kilocode/cli@latest` unpinned (`cloud@3de933dd
services/auto-routing-benchmark/container/Dockerfile:9-16`) and spawns `kilo run
--format json --auto -m kilo/<model> [--variant <v>] <prompt>` (`container/server.mjs:55-79`).

| Area | Current behavior + evidence | v2 behavior + evidence | Breaks? | Change needed | Lands in |
|---|---|---|---|---|---|
| Startup | Image build runs `npm install -g @kilocode/cli@latest`; worker spawns `kilo` in a temp cwd (`cloud@3de933dd services/auto-routing-benchmark/container/Dockerfile:12`; `container/server.mjs:46,55-79`). | v2 `@kilocode/cli` is private with no `bin` and builds `kilo2` (`kilo-v2:packages/kilo-cli/package.json:2-4`; `script/build.ts:35`). Because v2 ships to `next`, `@latest` keeps resolving v1 until this consumer opts in. | yes (on opt-in) | Publish v2 CLI with an installable `bin`; adapt spawn to `kilo2`; pin to `next` explicitly when adopting. | both |
| Session admission | One fresh `kilo run` per case; no session ids/continuation; runs serialized because the CLI store is not concurrency-safe (`container/server.mjs:37-41`; `src/run.ts:1258`). | v2 `run` accepts positional prompt, `-s/--session`, `-m/--model`, `--agent`, `--auto`, `--file`, `--directory`, `--format text|json` (`kilo-v2:packages/kilo-cli/src/commands.ts:283-352`). There is no standalone `--variant` flag, but upstream v2 encodes the variant in the model ref as `provider/model#variant` (`origin/v2:packages/cli/src/commands/commands.ts`, `run` model help). | yes | Pass the variant as `-m kilo/<model>#<variant>`, or add a `--variant` compatibility flag. | both |
| Streaming | Parses one JSON event per stdout line: completed `type:text` parts and `step_finish` cost (`cloud@3de933dd src/kilo-events.ts:52-85`; emitted by `origin/main:packages/opencode/src/cli/cmd/run.ts:876-891`). | kilo2's `run --format json` prints one completed `{sessionID,text}` object (`kilo-v2:packages/kilo-cli/src/tui-preview.ts:231`), but **upstream v2 preserves the streaming event log**: `noninteractive.ts` emits `{type,timestamp,sessionID,part}` for `text`/`step_start`/`step_finish`/`tool_use`/`reasoning` and `{type,error}` for errors (`origin/v2:packages/cli/src/run/noninteractive.ts`). The parser works against upstream v2; it fails only against kilo2 today. | yes (kilo2 only) | Align kilo2's `run` with upstream v2's non-interactive path (preferred), or adapt the parser to the single-object result. | this repo |
| Tools | None; `--auto` only. | `--auto` exists; no tool/permission flags passed. No break. | no | none | — |
| Credentials | Injects `KILO_AUTH_CONTENT {kilo:{type:api,key,organizationId}}`, `KILO_API_URL`, `KILO_ORG_ID`, `KILO_DISABLE_SESSION_INGEST=1` (`cloud@3de933dd container/server.mjs:66-79`). v1 reads them (`origin/main:packages/core/src/plugin/provider/kilo.ts:18-19`; `packages/opencode/src/auth/index.ts:61`). | v2 reads none of `KILO_AUTH_CONTENT`/`KILO_ORG_ID`/`KILO_DISABLE_SESSION_INGEST`; only `KILO_API_URL` as the gateway (`kilo-v2:packages/kilo-cli/src/tui-preview.ts:141`). Credentials can be seeded with `import-v1 --auth` or by writing an `auth.json` the DB migration imports (§5, G6). | yes | Seed v2 credentials via `import-v1 --auth`/`auth.json` before `run`, or add a v2 env path. | both |
| Persistence | Only a temp cwd, removed after each run (`cloud@3de933dd container/server.mjs:46,119`); no CLI home/config read. | v2 uses isolated `kilo2` paths (`kilo-v2:packages/kilo-cli/src/paths.ts:6,26`); a fresh temp cwd still works. | no | none (v2 store is created in-container). | — |
| Cancellation | 180 s timeout, kills the whole process group (`cloud@3de933dd container/server.mjs:59-63,84-95`; `src/cli-runner.ts:15`). | v2 `run` installs abort handling and interrupts its session (`kilo-v2:packages/kilo-cli/src/run.ts:78,269-270`); SIGKILL of the group still applies. | no | none | — |

**Disposition: runtime packaging change + v2 client adaptation (both).** It
floats `@kilocode/cli@latest`, but the `next` channel keeps `latest` on v1, so
there is no forced break: this consumer adapts only when it opts into `next`
(or when v2 is eventually promoted to `latest`). Adaptation (binary, variant
syntax, streaming output, credentials) must land before that opt-in.

## 3. MCP catalog generator (CI)

Workflow installs the CLI unpinned (`npm install -g @kilocode/cli`) and shells
out to `kilo run` (`cloud@3de933dd .github/workflows/kilo-mcp-catalog.yml:112-115,368-371`;
`apps/web/src/scripts/mcp-catalog/catalog.ts:721-732`).

| Area | Current behavior + evidence | v2 behavior + evidence | Breaks? | Change needed | Lands in |
|---|---|---|---|---|---|
| Startup | `npm install -g @kilocode/cli` in both jobs (`cloud@3de933dd .github/workflows/kilo-mcp-catalog.yml:115,371`). | v2 package is private/no-`bin`, artifact `kilo2` (`kilo-v2:packages/kilo-cli/package.json:2-4`; `script/build.ts:35`); `next` channel keeps the unpinned install on v1 until the workflow pins `next`. | yes (on opt-in) | Publish installable v2 CLI; adapt install/spawn; pin `next` when adopting. | both |
| Session admission | One independent `spawnSync('kilo',['run','--model',M,'--variant',V,'--format','json'])`, prompt on stdin, cwd `tmpdir()` (`cloud@3de933dd apps/web/src/scripts/mcp-catalog/catalog.ts:721-732`). | v2 `run` has `-m/--model` and `--format` but no `--variant`; upstream v2 encodes variant as `provider/model#variant` (`kilo-v2:packages/kilo-cli/src/commands.ts:283-352`; `origin/v2:packages/cli/src/commands/commands.ts`). | yes | Move the variant into the model ref, or add a `--variant` flag. | both |
| Streaming | Parses completed `type:text` parts from stdout lines (`cloud@3de933dd catalog.ts:684-707,758`). | Upstream v2 keeps the streaming `type:text`/`step_finish` log (`origin/v2:packages/cli/src/run/noninteractive.ts`); kilo2 currently emits a single `{sessionID,text}` object (`kilo-v2:packages/kilo-cli/src/tui-preview.ts:231`). | yes (kilo2 only) | Align kilo2's `run` with upstream, or adapt the parser. | this repo |
| Tools | None. | None passed; no break. | no | none | — |
| Credentials | Mints a service token, exports `KILO_API_KEY`/`KILO_ORG_ID`; otherwise ambient `kilo auth login` (`cloud@3de933dd .github/workflows/kilo-mcp-catalog.yml:155-173,397-415`). v1 reads `KILO_API_KEY`/`KILO_ORG_ID` (`origin/main:packages/core/src/plugin/provider/kilo.ts:18-19`). | v2 reads neither env. Seed via `import-v1 --auth`, or write an `auth.json` for the upstream DB migration (`origin/v2:.../20260805200742_import_legacy_credentials.ts`). | yes | Seed v2 credentials, or add a v2 env path. | both |
| Persistence | Runs in `tmpdir()` so project config is not loaded (`cloud@3de933dd catalog.ts:713-715,728`); writes only `catalog.json`. | Isolated `kilo2` store in the runner home; temp cwd still avoids project config. | no | none | — |
| Cancellation | 10 min `spawnSync` timeout; 20 min job timeout (`cloud@3de933dd catalog.ts:84,729`; `kilo-mcp-catalog.yml:66,324`). | v2 `run` handles abort/interrupt; process kill still applies. | no | none | — |

**Disposition: runtime packaging change + v2 client adaptation (both), G1.**
Same floating exposure as the benchmark, neutralized by the `next` channel; the
required `catalog (PR)` check only breaks if/when the workflow opts into v2.

## 4. session-ingest

No runtime executor; contract-coupled to the CLI's session shipping and to
`kilo import` (#14425, owner-confirmed). The wire contract is
`@kilocode/session-ingest-contracts` and the server's `SessionItemSchema` union
(`cloud@3de933dd services/session-ingest/src/types/session-sync.ts:12-99`;
`packages/session-ingest-contracts/src/rpc-contract.ts:4`).

| Area | Current behavior + evidence | v2 behavior + evidence | Breaks? | Change needed | Lands in |
|---|---|---|---|---|---|
| Startup | CLI-side producer is `KiloSessions`; server base is `KILO_SESSION_INGEST_URL` default `https://ingest.kilosessions.ai` (`origin/main:packages/opencode/src/kilo-sessions/kilo-sessions.ts:253,987`). Registration `POST /api/session` returns `{id,ingestPath}` (`cloud@3de933dd services/session-ingest/src/routes/api.ts:215,279-285`). | v2 producer is `@kilocode/gateway` `registerSessions` (`kilo-v2:packages/kilo-gateway/src/session.ts:104-115`), default base `KILO_SESSION_INGEST_URL ?? https://ingest.kilosessions.ai` (`:402`), registration `POST /api/session` (`:267-276`). | partial | Keep the same base/registration; map the reduced v2 producer. | this repo |
| Session admission | Continuous ingest: register once, then stream `message`/`part`/`session_diff`/`model`/`session_open`/`session_close`/`session_status`/`agent_notification`/`session_pr_link` items (`cloud@3de933dd session-sync.ts:12-99`; emitted by v1 `kilo-sessions.ts:718,812,929,1745`). | v2 only uploads on an explicit `share` RPC, as a reduced batch `kilo_meta` + `session` + self-contained `message` items (`kilo-v2:packages/kilo-gateway/src/session.ts:64-97,279-300`). No `part`/`session_diff`/`session_open`/`session_close`/`session_status`/`agent_notification`/`session_pr_link`; no continuous stream. | yes | Decide whether session-ingest must consume v2 self-contained messages, and add a continuous producer (or an explicit-sync equivalent) for hosted sessions. | both (v2 producer first; cloud validates) |
| Streaming | WS frame `{type:'ingest',sessionId,data:[…]}` and HTTP `POST /api/session/:id/ingest?v=N` with root `{data:[…]}` (`cloud@3de933dd services/session-ingest/src/types/ws-protocol.ts:5-9`; `src/routes/api.ts:431`; limits `util/ingest-limits.ts:11-12`). | v2 posts `{data: batch}` to `<base><ingestPath>?v=2` over HTTP only (`kilo-v2:packages/kilo-gateway/src/session.ts:279-300,409-411`); no WS producer. | partial | Confirm reduced HTTP batch is accepted; WS continuity not provided. | this repo/cloud |
| Tools | n/a (no tools in the payload). | n/a. | no | none | — |
| Credentials | Bearer Kilo JWT via `KILOCODE_TOKEN`/auth.json (`cloud@3de933dd services/session-ingest/src/middleware/kilo-jwt-auth.ts:52-101`; wrapper writes `.local/share/kilo/auth.json`). | v2 resolves the active Kilo credential from the isolated store (`kilo-v2:packages/kilo-gateway/src/session.ts:386-397`); bearer still used on the wire. | partial | Confirm v2 credential resolution yields the same JWT audience; seed credentials for headless. | this repo/cloud |
| Persistence | Wrapper bridges by writing `$XDG_DATA_HOME/kilo/storage/session_share/<id>.json` `{id,ingestPath}`; v1 CLI reads it (`cloud@3de933dd wrapper/src/restore-session.ts:169-195`; `origin/main:.../kilo-sessions.ts:1562,1603`). Restore downloads `GET /api/session/:id/export` then `kilo import <snapshot.json>` (`wrapper/src/restore-session.ts:1069,1196-1207`). | v2 stores bootstrap under host storage key `session:<id>`, not the `session_share` file (`kilo-v2:packages/kilo-gateway/src/session.ts:210-225,466-468`); v2 `import` accepts only a local v2 `SessionTransfer.Data` transcript and rejects URLs (`packages/kilo-cli/src/commands.ts:353-370`). Upstream v2 `session import` accepts a URL and the export shape is convertible via the migration's transform (§5). | yes | Add a v1-export→`SessionTransfer.Data` converter (reuse §5), or have session-ingest export v2 transfer data. | both |
| Cancellation | n/a; `session_close` reason `completed|error|interrupted` is data, not a cancel call (`cloud@3de933dd session-sync.ts:53-55`). | n/a; v2 has no `session_close` item. | partial | Carry terminal outcome another way if consumers rely on `session_close`. | this repo |

**Disposition: v2 contract change (producer) with cloud coordination.** The v2
producer exists but is reduced and explicit-share-only; continuous session
shipping and the `session_share`/import bridge are absent. session-ingest's
server code likely needs no schema change (the union is permissive), but its
message projection and the `session_close`/diff/part semantics must be validated
with v2 self-contained messages.

## 5. v1 → v2 session history migration

This is the load-bearing piece for the "migrate existing v1 users' sessions"
goal. The owner asked whether upstream already solves it — it does, and kilo-v2
already vendors an older copy of the same file.

| Item | Evidence |
|---|---|
| Upstream migration engine | `origin/v2:packages/core/src/database/v1-migration.bun.ts` — migrates the legacy local SQLite store in place: `session`→`session_v2`, and `message`+`part`→`session_message` via `transformSession`, plus importing a previous-channel `opencode-next.db`. |
| Upstream history | Introduced by `0fbe489e35 feat(core): migrate v1 data to v2 (#40723)`; refined by `3facbe1dd3` (older previous-channel DBs, #43142), `facd7ff452` (simplify effects, #45685), `2c369a21c9` (renamed legacy tools notice, #50188). |
| Platform variants | `origin/v2:packages/core/src/database/v1-migration.ts` selects a platform build; `v1-migration.noop.ts` is a no-op (`status: "completed"`) for hosts without Bun SQLite. Cloud-agent-next runs the Bun binary, so the Bun path applies. |
| Wiring | Auto-runs in the server graph via `V1Migration.layer` (`origin/v2:packages/server/src/routes.ts`; kilo-v2 `packages/server/src/routes.ts:185`); exposed as `GET /api/experimental/migration/v1` (`kilo-v2:packages/protocol/src/groups/migration.ts:18`). |
| Kilo's copy | `kilo-v2:packages/core/src/database/v1-migration.bun.ts` is an older revision (missing the renamed-tool notice; its project insert lacks upstream's `time_active`) and still uses the pre-rename scope `@opencode-ai/*`, while upstream v2 uses `@opencode/*`. |
| Local-store copy | `kilo-v2:packages/kilo-cli/src/import-v1-session.ts` copies the v1 store into the isolated `kilo2` layout (read-only source, WAL-consistent, no-clobber), but explicitly leaves running `V1Migration` against the copy to "the CLI command slice," which is not wired — kilo2 has no `migrate`/import-v1-sessions command (`packages/kilo-cli/src/commands.ts`). |
| Config/credential migration | `origin/v2:packages/cli/src/config/migrate.ts` (`ConfigMigrateV1`); `kilo-v2:packages/kilo-cli/src/import-v1-config.ts`; upstream credential import `origin/v2:.../migration/20260805200742_import_legacy_credentials.ts`. |

**Consequence:** the migration algorithm exists and is proven (upstream, with
tests and follow-up fixes); there is no need to design one. The work is (a)
sync kilo-v2's copy up to upstream `origin/v2`, (b) account for the npm-scope
rename when syncing, and (c) wire the user-facing flow (discover v1 store →
copy into `kilo2` via `import-v1-session` → run `V1Migration`). None of this
covers the cloud session-ingest wire, which is a separate contract (§4).

## Disposition summary

| Consumer | Disposition | Lands in | Pinning (#14425) | Recommended gate (#14425) | Evidence |
|---|---|---|---|---|---|
| cloud-agent-next | v2 client adaptation + runtime packaging change | both (v2 contract/packaging first) | pinned 7.8.1; independent cutover | G1 for adaptation; independent go/no-go | §1; `wrapper/src/control-plane/kilo-runtime.ts:21,184`; `packages/protocol/src/groups/session.ts:170,338,666` |
| auto-routing-benchmark | runtime packaging change + v2 client adaptation | both; adapt on `next` opt-in | floats `@kilocode/cli@latest` (safe while v2 is on `next`) | G1 | §2; `container/server.mjs:55-79`; `src/kilo-events.ts:52-85`; `origin/v2:packages/cli/src/run/noninteractive.ts` |
| MCP catalog generator (CI) | runtime packaging change + v2 client adaptation | both; adapt on `next` opt-in | unpinned `npm install -g @kilocode/cli` (safe while v2 is on `next`) | G1 | §3; `catalog.ts:721-732`; `kilo-mcp-catalog.yml:115,371` |
| session-ingest | v2 contract change (producer) + cloud coordination | both (v2 producer first) | contract-coupled, no runtime | G1 (producer-side) | §4; `packages/kilo-gateway/src/session.ts:64-97,279-300`; `session-sync.ts:12-99` |

No in-scope consumer is "no change". Every disposition includes a v2
contract/packaging change in this repo; cloud-agent-next additionally owns a
client adaptation. Because v2 ships on `next`, the two floating consumers are
not forced to adapt until they opt in.

## Gaps for #14427

Ordering rule: v2 contract/packaging items land in this repo first; cloud client
adaptations follow. The floating consumers adapt only when they move to `next`.

### G1 — Spawnable kilo2 serve contract
- Repo: this repo.
- Problem: the cloud wrapper spawns `kilo serve --hostname/--port` and waits for
  `kilo server listening`; kilo2 is named `kilo2`, prints `URL:`/`Password file:`,
  and its `serve` lacks `--hostname`/`--port`.
- Solution: align kilo2's `serve` with upstream v2's (`--hostname`, `--port`,
  `--cors`, `--service`, `--stdio`) and publish a documented readiness/auth
  contract, or define an explicit headless-spawn contract.
- Touches: `packages/kilo-cli/src/{index.ts,commands.ts,tui-preview.ts,interactive-server.ts}`, `packages/server/src/{routes.ts,fetch.ts,handlers/health.ts}`, `packages/protocol/src/groups/{health.ts,server.ts}`.
- Dependencies: G2 (binary), G3 (handshake).
- Cloud coordination: yes — cloud-agent-next wrapper is the reference consumer.

### G2 — Packaging + release channel
- Repo: this repo.
- Problem: `@kilocode/cli` on v2 is private, has no `bin`, and there is no
  pre-release channel, so no consumer can install v2 and the floating
  consumers would break if v2 took `latest`.
- Solution: add `bin` (keep the `kilo2` name per owner decision), drop `private`
  for the pre-release channel, publish to a new **`next`** dist-tag, and keep
  `latest` on v1 for the migration. Add a release guard/test that asserts
  `latest` still resolves the v1 CLI.
- Touches: `packages/kilo-cli/package.json`, `packages/kilo-cli/script/{build.ts,build-tui.ts}`, release tooling (`.github/workflows/publish.yml`, `packages/script/src/index.ts`).
- Dependencies: none; blocks every consumer.
- Cloud coordination: yes — release-channel naming/ownership.

### G3 — Version/capability handshake (N9)
- Repo: this repo.
- Problem: v2 health returns only `{healthy,version,pid}`, so a client cannot
  safely select v1 vs v2 routes in one session.
- Solution: add a capability/version handshake. Record what each consumer needs:
  cloud-agent-next needs backend generation + feature flags; benchmark/MCP
  catalog need an argv/output contract marker.
- Touches: `packages/protocol/src/groups/health.ts`, `packages/server/src/handlers/health.ts`, `packages/client/src/service-version.ts`, `packages/kilo-client/src`.
- Dependencies: G1.
- Cloud coordination: yes.

### G4 — Consumer-facing v2 SDK surface
- Repo: this repo.
- Problem: the cloud imports `@kilocode/sdk` and `@kilocode/sdk/v2`; v2 publishes
  no `@kilocode/sdk` (only `@opencode-ai/sdk`).
- Solution: publish a v2 `@kilocode/sdk` (or document `@kilocode/client` as the
  replacement) and provide a migration path for the two SDK import sites.
- Touches: `packages/sdk`, `packages/kilo-client` (`@kilocode/client`), `packages/client`.
- Dependencies: G3.
- Cloud coordination: yes.

### G5 — cloud-agent-next client adaptation
- Repo: cloud.
- Problem: routes, event vocabulary and payloads all differ (§1).
- Solution: adapt wrapper to `/api/session`, `/api/session/:id/prompt`,
  `/api/event`, `/api/session/:id/interrupt`; map events
  (`session.text.delta`, `session.tool.*`, `session.inbox.*`,
  `session.execution.*`); seed credentials.
- Touches: `services/cloud-agent-next/wrapper/src/{main.ts,kilo-api.ts,connection.ts,global-feed.ts}`, `wrapper/src/control-plane/{kilo-runtime.ts,turn.ts}`, `src/session/ingest-handlers/entity-id.ts`, `src/router/handlers/session-management.ts`.
- Dependencies: G1, G3, G4.
- Cloud coordination: yes — cloud team owns the change.

### G6 — v2 credential seeding for hosted/floating consumers
- Repo: this repo (runtime), cloud (usage).
- Problem: cloud-agent-next injects `KILOCODE_TOKEN`/`KILO_AUTH_CONTENT`/auth.json
  and the benchmark/MCP CI inject `KILO_AUTH_CONTENT` or
  `KILO_API_KEY`/`KILO_ORG_ID`; v2 reads none of these. v2 credentials are rows
  in the isolated store, and the HTTP API intentionally has no credential-import
  RPC.
- Solution: an explicit v2 seeding path. Short term, seed via `kilo2 import-v1
  --auth --apply` or by writing an `auth.json` the upstream DB migration imports;
  long term, a small env/RPC for hosted consumers. Owner confirmed an import
  tool (including auth) is acceptable.
- Touches: `packages/kilo-cli/src/{credential-import.ts,import-v1-config.ts,commands.ts,tui-preview.ts}`, `packages/core/src/credential.ts`, `packages/kilo-gateway/src/account.ts`, `packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts`.
- Dependencies: G2.
- Cloud coordination: yes.

### G7 — `run` argv/output compatibility for headless consumers
- Repo: this repo (align with upstream), cloud (`#variant`).
- Problem: consumers pass `--variant` and parse a streaming JSON event log.
  kilo2 has no `--variant` and prints one `{sessionID,text}` object, **but
  upstream v2 already preserves the streaming log** and encodes the variant as
  `provider/model#variant`.
- Solution: port upstream's `run/noninteractive.ts` path into kilo2 (preferred);
  change consumers to `-m provider/model#variant` or keep a `--variant` shim.
- Touches: `packages/kilo-cli/src/{commands.ts,run.ts,tui-preview.ts}` plus the upstream `run/` port; cloud `services/auto-routing-benchmark/{container/server.mjs,src/kilo-events.ts}`, `apps/web/src/scripts/mcp-catalog/catalog.ts`.
- Dependencies: G2; needed before the consumers move to `next`.
- Cloud coordination: yes.

### G8 — Restore/import compatibility
- Repo: this repo, cloud.
- Problem: cloud-agent-next runs `kilo import <snapshot.json>` on the
  session-ingest **v1** export (`{info, messages:[{info, parts}], sessionDiff}`),
  while v2 `import` expects `SessionTransfer.Data` (self-contained v2 messages).
- Solution: add a v1-export → `SessionTransfer.Data` converter that reuses
  `V1Migration.transformSession`'s part→content mapping (preferred), or have
  session-ingest export v2 transfer data. Upstream `session import` already
  accepts a file or URL to target.
- Touches: `packages/kilo-cli/src/{commands.ts,import-v1-session.ts}`, `packages/schema/src/session-transfer.ts`, `packages/core/src/database/v1-migration.bun.ts`, `packages/kilo-gateway/src/session.ts`, cloud `services/cloud-agent-next/wrapper/src/restore-session.ts`.
- Dependencies: G11 (reuse its transform); cross-repo order: v2 converter first, cloud restore second.
- Cloud coordination: yes.

### G9 — session-ingest producer continuity
- Repo: this repo (producer), cloud (validation).
- Problem: v2 emits only `kilo_meta`/`session`/`message` on explicit share, with
  no continuous stream and no `part`/`session_diff`/`session_open`/`session_close`/
  `session_status`/`agent_notification`/`session_pr_link`; bootstrap is stored
  under `session:<id>`, not the `session_share` bridge file.
- Solution: decide whether session-ingest consumes v2 self-contained messages
  and add a continuous (or explicit-sync) producer; map terminal outcome in
  place of `session_close`.
- Touches: `packages/kilo-gateway/src/session.ts`, `packages/schema/src/session-event.ts`, `packages/core/src/session/*`.
- Dependencies: G3; cloud validates its projection against v2 self-contained messages.
- Cloud coordination: yes.

### G10 — Event/entity projection mapping for cloud ingest
- Repo: this repo, cloud.
- Problem: the worker keys entities on `message.updated`/`message.part.updated`;
  v2 uses `session.message.content.updated`/`session.step.*`/`session.tool.*` and
  self-contained messages.
- Solution: map v2 events/messages to the worker's entity model, or add a
  projection.
- Touches: cloud `services/cloud-agent-next/src/session/ingest-handlers/*`, `src/websocket/ingest.ts`; v2 `packages/schema/src/session-event.ts`.
- Dependencies: G5.
- Cloud coordination: yes.

### G11 — Sync + wire the v1→v2 session migration
- Repo: this repo.
- Problem: upstream `origin/v2` has a proven migration
  (`v1-migration.bun.ts`, #40723 + follow-ups); kilo-v2 vendors an older copy and
  never wires the user-facing flow; `import-v1-session.ts` exists but has no
  command.
- Solution: sync kilo-v2's copy up to upstream `origin/v2` (including the
  renamed-tool notice and `time_active`), reconcile the `@opencode-ai`→`@opencode`
  scope rename, and wire the CLI flow (discover v1 store → `import-v1-session`
  copy → run `V1Migration`), surfacing progress via
  `/api/experimental/migration/v1`.
- Touches: `packages/core/src/database/{v1-migration.bun.ts,v1-migration.noop.ts,v1-migration.ts}`, `packages/kilo-cli/src/{import-v1-session.ts,import-v1-config.ts,commands.ts}`, `packages/server/src/routes.ts`.
- Dependencies: none for the engine; G2 for a user-installable binary.
- Cloud coordination: limited — this is local-user migration; confirm no cloud path assumes the v1 store.

## Proposed progress-plan row changes (for N7; do not apply here)

File: `migration-tracking/plans/kilo-opencode-v2-plan-progress.md`, section
"Remote, sharing and distribution".

1. Add a row:
   `| Cloud agent consumer contracts | Kilo CLI / Gateway | 4, 6 | Partial | Contract mapping and dispositions complete; implementation gaps open in #14427 | Four in-scope consumers mapped across startup, admission, streaming, tools, credentials, persistence, cancellation. v2 ships on a new next channel so floating consumers are not forced to break. Upstream v2 already provides serve, streaming run, session import and the v1→v2 migration; kilo-v2 needs to converge. See technical-notes/baseline/cloud-agent-contracts.md. |`
2. Amend the #14425-added "Cloud agent runtime consumers (hosted)" row's
   remaining scope to say contract mapping is complete and point at
   `technical-notes/baseline/cloud-agent-contracts.md`.
3. Amend the `Cloud CLI client` row to note that local `kilo cloud` fixtures and
   the `/remote` relay do not establish cloud-hosted consumer compatibility
   (already asserted by #14425; keep the two baselines linked).
4. Add a row for the v1→v2 session history migration (upstream-sourced, sync +
   CLI wiring) so it is tracked independently of the cloud consumers.

Evidence links for the epic: #14425 (inventory), #14426 (contracts, this file),
#14427 (adaptation), #14428 (validation).

## Open questions for the cloud owners

1. `next` channel mechanics: confirm where the `@kilocode/cli` dist-tag is set
   (the in-repo `publish.yml` is the upstream `anomalyco/opencode` skeleton) and
   that `latest` will hold the v1 line for the whole migration (G2).
2. Hosted credential injection: is writing an `auth.json` / running
   `import-v1 --auth` acceptable in the sandbox image, or does v2 need a
   first-class env/RPC for `KILOCODE_TOKEN`/`KILO_API_KEY` (G6)?
3. Session-ingest semantics: can session-ingest consume v2 self-contained
   `message` items without `part` rows, and how should `session_close`/diff/
   status/notifications be carried (G9)?
4. Restore: is a v1-export→`SessionTransfer.Data` converter (reusing the
   migration transform) acceptable, or should session-ingest export v2 transfer
   data (G8)?
5. Migration scope: should the kilo2 CLI expose the migration as an explicit
   command, or (like upstream) run it automatically on first open of a copied v1
   store (G11)?
