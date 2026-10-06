# Cloud agent consumer contracts — mapping and dispositions

Discovery for Kilo-Org/kilocode#14426 (parent epic #14023), building on #14425.
Discovery only: no source changes in any repository.

## Header

| Item | Value |
|---|---|
| Date | 2026-10-05 |
| Cloud repo | `Kilo-Org/cloud` at `3de933dd85070e9d15c41d8ff3af6c91ca856fd4` (read-only clone `/Users/fpliger/dev/kiloverse/cloud`) |
| This repo, `origin/main` (v1) | `62f674d4a91969ac077e4a7b6ceeb8a99de80e47` |
| This repo, `kilo-v2` (v2) | `782263326df5be50081517ddedd937f1080a89cf` |
| #14425 inventory | `migration-tracking/technical-notes/baseline/cloud-agent-consumers.md` |

#14425 assessed the cloud repo at the same SHA; its this-repo SHAs were older
(`origin/main` `622ed1f5`, `kilo-v2` `a2e6c1f6`, both ancestors of the SHAs
above). Owners, pinning and recommended gates below are reused from #14425 and
not re-derived.

## Citation conventions

- `cloud@3de933dd <path>:<line>` — the cloud repo at the SHA above.
- `origin/main:<path>:<line>` — v1 runtime surface in this repo at the SHA above.
- `kilo-v2:<path>:<line>` — v2 runtime surface in this repo at the SHA above.
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
consumer" is a package/channel and packaging question, not a name question.

## 1. cloud-agent-next

Primary hosted runtime; wrapper spawns `kilo serve`, imports `@kilocode/sdk` and
`@kilocode/sdk/v2`, and pins `KILOCODE_CLI_VERSION=7.8.1`
(`cloud@3de933dd services/cloud-agent-next/Dockerfile:6`;
`src/shared/kilo-cli-version.ts:1`;
`wrapper/package.json:11`).

| Area | Current behavior + evidence | v2 behavior + evidence | Breaks? | Change needed | Lands in |
|---|---|---|---|---|---|
| Startup | Two paths. Legacy wrapper calls `createKilo()`; the SDK spawns `kilo serve --hostname --port` and waits for stdout `kilo server listening` (`origin/main:packages/sdk/js/src/server.ts:62-90`; `origin/main:packages/opencode/src/cli/cmd/serve.ts:24`). Control-plane wrapper spawns `kilo serve --hostname=127.0.0.1 --port=0` and matches `/^kilo server listening on (http:\/\/127\.0\.0\.1:\d+)/` (`cloud@3de933dd wrapper/src/control-plane/kilo-runtime.ts:21,184`; `wrapper/src/main.ts:5-9,54,349-353`). `createKilo` rebinds the client (`wrapper/src/kilo-runtime-lifecycle.ts:118-133`). | No `kilo` binary: built artifacts are `kilo2` (`kilo-v2:packages/kilo-cli/script/build.ts:35`; `script/build-tui.ts:29-41`). Real serve host prints `URL:` / `Password file:`, not a listening banner (`kilo-v2:packages/kilo-cli/src/tui-preview.ts:179-180`), and `serve` accepts no `--hostname`/`--port` (`kilo-v2:packages/kilo-cli/src/commands.ts:262-282`). The headless `kilo2 serve` entry is admission-only and refuses execution (`kilo-v2:packages/kilo-cli/src/index.ts:11-19,52-57`; `src/server.ts:53-57,75,96-100`). | yes | Give v2 a spawnable headless serve with a stable readiness signal and auth, or adapt the wrapper to the v2 CLI/host. | both (v2 contract first, then cloud) |
| Session admission | Wrapper calls `session.create`, `session.get`, `kilocode.sessionImport.session`, then `session.promptAsync` (async) with `parts`, `model.providerID=kilo`, `tools`, `agent` (`cloud@3de933dd wrapper/src/kilo-api.ts:380-384,389-395,407-449,456-459,343-368`). Session IDs are `ses_<hex><base62>` (`src/utils/kilo-session-id.ts:26-27`). Wrapper HTTP admission routes `/job/prompt`,`/job/command`,`/job/answer-*` (`wrapper/src/server.ts:1235-1251`); control-plane frames `session.prepare/prompt/abort/answer` (`src/shared/control-plane-protocol.ts:611-669`). | v2 admits a prompt durably: `POST /api/session`, `POST /api/session/:sessionID/prompt` returning a `SessionInbox.User` enqueue, with execution scheduled by `SessionExecution.wake` unless `resume:false` (`kilo-v2:packages/protocol/src/groups/session.ts:170,338`; `packages/core/src/session/session.ts:154-187`; `packages/core/src/session/inbox.ts:169-202,277-336`). There is no `prompt_async`; `session.prompt` is the async admission. v2 has `POST /api/session/import` for v2 transcripts, not the v1 `kilocode.sessionImport.session` shape (`packages/protocol/src/groups/session.ts:189`). | yes | Adapt the wrapper to v2 create/prompt/import routes and payloads; implement/expose the capability handshake so the wrapper can select v1 vs v2 (N9). | both |
| Streaming | Subscribes via `v2Client.global.event` → `GET /global/event` (`cloud@3de933dd wrapper/src/kilo-api.ts:373-377`; `origin/main:packages/sdk/js/src/v2/gen/sdk.gen.ts:1586`), including a raw SSE topology (`wrapper/src/global-feed.ts:236-243`). Depends on events `message.updated`, `message.part.updated`, `session.idle`, `session.status`, `session.error`, `permission.asked`, `question.asked`, `session.turn.open/close`, `session.network.asked` (`wrapper/src/connection.ts:219-221,105-106,1173,1193,1232,1269`; `origin/main:packages/opencode/src/kilocode/session/event.ts`). Worker ingests by entity key `message.updated`→`message/{id}`, `message.part.updated`→`part/{msg}/{id}` (`src/session/ingest-handlers/entity-id.ts:12-27`). | v2 stream is `GET /api/event` SSE, volatile by contract (overflow fails the stream), 15 s heartbeats (`kilo-v2:packages/protocol/src/groups/event.ts:38-55`; `packages/server/src/handlers/event.ts:12-33`). Current events are `session.text.delta`, `session.tool.*`, `session.step.*`, `session.inbox.*`, `session.execution.*`, `session.status`; `session.idle` is deprecated; `message.updated`/`message.part.*` are V1-only (`packages/schema/src/session-event.ts:189,196,234,383,455-509`; `packages/schema/src/session-status-event.ts:35-51`; `packages/schema/src/v1/session.ts:597,613`). | yes | Map every consumed event to the v2 vocabulary (or add a compatibility projection); adapt the worker ingest entity keys to v2 events/messages. | both |
| Tools | Passes a permission map and MCP servers through `KILO_CONFIG_CONTENT` (`cloud@3de933dd src/session-service.ts:1334-1357,1404-1424,1467-1470`); MCP types `{type:local|remote}` (`src/mcp-config.ts:7-21`). Reads tool parts (`part.type==='tool'`) and replies via `permission.reply/list`, `question.reply/reject/list` (`wrapper/src/kilo-api.ts:546-591`); auto-approves or rejects permissions (`wrapper/src/connection.ts:1171-1196`). | v2 registers tools through `Tool.Service` (no authorization in the registry) and enforces in `Permission.Service` with a persisted `permission` SQLite table (`kilo-v2:packages/core/src/tool.ts:157-183,220-271`; `packages/core/src/permission.ts:214-310`; `packages/core/src/permission/sql.ts:7`). MCP is config-driven (`packages/core/src/config/plugin/mcp.ts:39-56`). v2 reads `OPENCODE_CONFIG_CONTENT` (`packages/core/src/config.ts:206-210`) but **not** `KILO_CONFIG_CONTENT` as an input (it is only an internal constant, `packages/kilo-cli/src/skill-policy.ts:12`). | yes | Confirm v2 reads the permission/provider/MCP payload the wrapper actually injects (or adapt the injected config key); adapt permission/question reply calls. | both |
| Credentials | Injects `KILOCODE_TOKEN` (opaque capability redeemed at the outbound proxy), `KILO_AUTH_CONTENT` and writes `.local/share/kilo/auth.json` `{kilo:{type:'api',key}}`; sets `provider.kilo.options.apiKey/kilocodeToken/baseURL` (`cloud@3de933dd src/session-service.ts:1277-1311,814-828,1404-1410`; `wrapper/src/session-bootstrap.ts:286-287,680-688`). v1 reads these (`origin/main:packages/opencode/src/auth/index.ts:61-63`; provider `packages/core/src/plugin/provider/kilo.ts:18-19`). Runtime credential proxy on the worker (`src/server.ts:273,341-344,448`). | v2 has no `KILO_AUTH_CONTENT`, `KILOCODE_TOKEN` or `KILO_API_KEY`/`KILO_ORG_ID` env inputs; credentials are rows in the isolated `credential` table, resolved from the gateway account (`kilo-v2:packages/core/src/credential.ts:99-134`; `packages/core/src/credential/sql.ts:5-14`). `KILO_API_URL` selects the gateway only (`packages/kilo-cli/src/tui-preview.ts:141`). `kilo2 import-v1 --auth <file> --apply [--gateway-server]` can seed isolated credentials from an auth file (`packages/kilo-cli/src/commands.ts:216-238`; `packages/kilo-cli/src/import-v1-config.ts`). | yes | Provide a v2 credential-injection path for hosted/floating consumers (env or import-v1 bootstrap), or adapt the cloud to write v2 credentials. | both |
| Persistence | v1 identity is `kilo`: data `~/.local/share/kilo`, config `~/.config/kilo` (`origin/main:packages/core/src/global.ts:10-40`). Wrapper writes `$XDG_DATA_HOME/kilo/storage/session_share/<id>.json` `{id,ingestPath}` and runs `kilo import <snapshot.json>` after downloading `GET /api/session/:id/export` (`cloud@3de933dd wrapper/src/restore-session.ts:169-195,1069,1196-1207`). | v2 identity is `kilo2`: `~/.local/share/kilo2/...`, DB `kilo2.db` (`kilo-v2:packages/kilo-cli/src/paths.ts:6,26`), and it refuses the v1 store (`packages/kilo-cli/src/storage.ts:19-22`). v2 never reads `session_share/<id>.json`; v2 `import` decodes `SessionTransfer.Data {info,messages}` from a v2 JSON transcript and rejects URLs (`packages/kilo-cli/src/commands.ts:353-370`; `packages/schema/src/session-transfer.ts:5-9`). | yes | Migrate restore/import to the v2 transcript shape and v2 storage location, or add a compatibility importer for the v1/session-ingest export. | both |
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
| Startup | Image build runs `npm install -g @kilocode/cli@latest`; worker spawns `kilo` in a temp cwd (`cloud@3de933dd services/auto-routing-benchmark/container/Dockerfile:12`; `container/server.mjs:46,55-79`). | v2 `@kilocode/cli` is private with no `bin` and builds `kilo2` (`kilo-v2:packages/kilo-cli/package.json:2-4`; `script/build.ts:35`). No global `kilo` binary is produced. | yes | Publish v2 CLI with an installable `bin` (or a documented replacement binary); adapt spawn. | both |
| Session admission | One fresh `kilo run` per case; no session ids/continuation; runs serialized because the CLI store is not concurrency-safe (`container/server.mjs:37-41`; `src/run.ts:1258`). | v2 `run` accepts positional prompt, `-s/--session`, `-m/--model`, `--agent`, `--auto`, `--file`, `--directory`, `--format text|json` (`kilo-v2:packages/kilo-cli/src/commands.ts:283-352`). No `--variant` option. | yes | Drop/replace `--variant`, or add it to v2 with a defined meaning. | both |
| Streaming | Parses one JSON event per stdout line: completed `type:text` parts and `step_finish` cost (`cloud@3de933dd src/kilo-events.ts:52-85`; emitted by `origin/main:packages/opencode/src/cli/cmd/run.ts:876-891`). | v2 `run --format json` prints one completed `{sessionID,text}` object, explicitly "not a streaming event log" (`kilo-v2:packages/kilo-cli/src/tui-preview.ts:231`; help `packages/kilo-cli/src/commands.ts:110`). The event parser gets no `type` field and returns empty text. | yes | Either restore a streaming JSON mode in v2, or adapt the parser to the single-object result. | both |
| Tools | None; `--auto` only. | `--auto` exists; no tool/permission flags passed. No break. | no | none | — |
| Credentials | Injects `KILO_AUTH_CONTENT {kilo:{type:api,key,organizationId}}`, `KILO_API_URL`, `KILO_ORG_ID`, `KILO_DISABLE_SESSION_INGEST=1` (`cloud@3de933dd container/server.mjs:66-79`). v1 reads them (`origin/main:packages/core/src/plugin/provider/kilo.ts:18-19`; `packages/opencode/src/auth/index.ts:61`). | v2 reads none of `KILO_AUTH_CONTENT`/`KILO_ORG_ID`/`KILO_DISABLE_SESSION_INGEST`; only `KILO_API_URL` as the gateway (`kilo-v2:packages/kilo-cli/src/tui-preview.ts:141`). Credentials must be seeded (e.g. `import-v1 --auth`). | yes | Provide a v2 credential env/bootstrap for headless containers, or seed credentials before `run`. | both |
| Persistence | Only a temp cwd, removed after each run (`cloud@3de933dd container/server.mjs:46,119`); no CLI home/config read. | v2 uses isolated `kilo2` paths (`kilo-v2:packages/kilo-cli/src/paths.ts:6,26`); a fresh temp cwd still works. | no | none (v2 store is created in-container). | — |
| Cancellation | 180 s timeout, kills the whole process group (`cloud@3de933dd container/server.mjs:59-63,84-95`; `src/cli-runner.ts:15`). | v2 `run` installs abort handling and interrupts its session (`kilo-v2:packages/kilo-cli/src/run.ts:78,269-270`); SIGKILL of the group still applies. | no | none | — |

**Disposition: runtime packaging change + v2 client adaptation (both).** It
floats `@kilocode/cli@latest`, so it is exposed the instant v2 is published to
that channel. v2 must be ready (binary, argv, JSON, credentials) **before** v2
takes `latest`, and the cloud must adapt in the same window.

## 3. MCP catalog generator (CI)

Workflow installs the CLI unpinned (`npm install -g @kilocode/cli`) and shells
out to `kilo run` (`cloud@3de933dd .github/workflows/kilo-mcp-catalog.yml:112-115,368-371`;
`apps/web/src/scripts/mcp-catalog/catalog.ts:721-732`).

| Area | Current behavior + evidence | v2 behavior + evidence | Breaks? | Change needed | Lands in |
|---|---|---|---|---|---|
| Startup | `npm install -g @kilocode/cli` in both jobs (`cloud@3de933dd .github/workflows/kilo-mcp-catalog.yml:115,371`). | v2 package is private/no-`bin`, artifact `kilo2` (`kilo-v2:packages/kilo-cli/package.json:2-4`; `script/build.ts:35`). | yes | Same as benchmark: publish installable v2 CLI. | both |
| Session admission | One independent `spawnSync('kilo',['run','--model',M,'--variant',V,'--format','json'])`, prompt on stdin, cwd `tmpdir()` (`cloud@3de933dd apps/web/src/scripts/mcp-catalog/catalog.ts:721-732`). | v2 `run` has `-m/--model` and `--format` but **no `--variant`** (`kilo-v2:packages/kilo-cli/src/commands.ts:283-352`). | yes | Drop/replace `--variant`, or add it to v2. | both |
| Streaming | Parses completed `type:text` parts from stdout lines (`cloud@3de933dd catalog.ts:684-707,758`). | v2 emits a single `{sessionID,text}` object for `--format json` (`kilo-v2:packages/kilo-cli/src/tui-preview.ts:231`). | yes | Restore streaming JSON in v2, or adapt the parser. | both |
| Tools | None. | None passed; no break. | no | none | — |
| Credentials | Mints a service token, exports `KILO_API_KEY`/`KILO_ORG_ID`; otherwise ambient `kilo auth login` (`cloud@3de933dd .github/workflows/kilo-mcp-catalog.yml:155-173,397-415`). v1 reads `KILO_API_KEY`/`KILO_ORG_ID` (`origin/main:packages/core/src/plugin/provider/kilo.ts:18-19`). | v2 reads neither env (`kilo-v2`: no `KILO_API_KEY`/`KILO_ORG_ID` in `packages/kilo-cli/src`, `packages/kilo-gateway/src`). | yes | v2 credential env/bootstrap, or seed credentials via `import-v1`. | both |
| Persistence | Runs in `tmpdir()` so project config is not loaded (`cloud@3de933dd catalog.ts:713-715,728`); writes only `catalog.json`. | Isolated `kilo2` store in the runner home; temp cwd still avoids project config. | no | none | — |
| Cancellation | 10 min `spawnSync` timeout; 20 min job timeout (`cloud@3de933dd catalog.ts:84,729`; `kilo-mcp-catalog.yml:66,324`). | v2 `run` handles abort/interrupt; process kill still applies. | no | none | — |

**Disposition: runtime packaging change + v2 client adaptation (both), G1.**
Same floating exposure as the benchmark; a required `catalog (PR)` check will
fail on a v2 `latest` until both land.

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
| Persistence | Wrapper bridges by writing `$XDG_DATA_HOME/kilo/storage/session_share/<id>.json` `{id,ingestPath}`; v1 CLI reads it (`cloud@3de933dd wrapper/src/restore-session.ts:169-195`; `origin/main:.../kilo-sessions.ts:1562,1603`). Restore downloads `GET /api/session/:id/export` then `kilo import <snapshot.json>` (`wrapper/src/restore-session.ts:1069,1196-1207`). | v2 stores bootstrap under host storage key `session:<id>`, not the `session_share` file (`kilo-v2:packages/kilo-gateway/src/session.ts:210-225,466-468`); v2 `import` accepts only a local v2 `SessionTransfer.Data` transcript and rejects URLs (`packages/kilo-cli/src/commands.ts:353-370`; `packages/schema/src/session-transfer.ts:5-9`). | yes | Provide a v1/session-ingest-export importer (or a v2 export/import bridge) so restore keeps working. | both |
| Cancellation | n/a; `session_close` reason `completed|error|interrupted` is data, not a cancel call (`cloud@3de933dd session-sync.ts:53-55`). | n/a; v2 has no `session_close` item. | partial | Carry terminal outcome another way if consumers rely on `session_close`. | this repo |

**Disposition: v2 contract change (producer) with cloud coordination.** The v2
producer exists but is reduced and explicit-share-only; continuous session
shipping and the `session_share`/import bridge are absent. session-ingest's
server code likely needs no schema change (the union is permissive), but its
message projection and the `session_close`/diff/part semantics must be validated
with v2 self-contained messages.

## Disposition summary

| Consumer | Disposition | Lands in | Pinning (#14425) | Recommended gate (#14425) | Evidence |
|---|---|---|---|---|---|
| cloud-agent-next | v2 client adaptation + runtime packaging change | both (v2 contract/packaging first) | pinned 7.8.1; independent cutover | G1 for adaptation; independent go/no-go | §1; `wrapper/src/control-plane/kilo-runtime.ts:21,184`; `packages/protocol/src/groups/session.ts:170,338,666` |
| auto-routing-benchmark | runtime packaging change + v2 client adaptation | both (v2 packaging before v2 `latest`) | floats `@kilocode/cli@latest` | G1 | §2; `container/server.mjs:55-79`; `src/kilo-events.ts:52-85`; `packages/kilo-cli/package.json:2-4` |
| MCP catalog generator (CI) | runtime packaging change + v2 client adaptation | both | unpinned `npm install -g @kilocode/cli` | G1 | §3; `catalog.ts:721-732`; `kilo-mcp-catalog.yml:115,371` |
| session-ingest | v2 contract change (producer) + cloud coordination | both (v2 producer first) | contract-coupled, no runtime | G1 (producer-side) | §4; `packages/kilo-gateway/src/session.ts:64-97,279-300`; `session-sync.ts:12-99` |

No in-scope consumer is "no change". Every disposition includes a v2
contract/packaging change in this repo; cloud-agent-next additionally owns a
client adaptation, and the two floating consumers (benchmark, MCP catalog) must
be adapted or protected before v2 is published to the channels they track.

## Gaps for #14427

Ordering rule: v2 contract/packaging items land in this repo first; cloud client
adaptations follow, except the floating consumers, whose cloud adaptations must
land before v2 replaces `@kilocode/cli@latest`.

### G1 — Spawnable v2 headless serve contract
- Repo: this repo.
- Touches: `packages/kilo-cli/src/index.ts`, `packages/kilo-cli/src/commands.ts`, `packages/kilo-cli/src/tui-preview.ts`, `packages/kilo-cli/src/interactive-server.ts`, `packages/server/src/{process.ts,routes.ts,fetch.ts,handlers/health.ts}`, `packages/protocol/src/groups/{health.ts,server.ts}`.
- Why: cloud-agent-next and the v1 SDK both need a documented argv, readiness signal and auth for a headless server; v2 prints `URL:`/`Password file:` and defaults to Basic auth username `opencode` (`kilo-v2:packages/kilo-cli/src/tui-preview.ts:179-180`; `interactive-server.ts:250-253`).
- Dependencies: G2 (binary), G3 (handshake).
- Cloud coordination: yes — cloud-agent-next wrapper serves as the reference consumer.

### G2 — Publishable v2 CLI binary and package metadata
- Repo: this repo.
- Touches: `packages/kilo-cli/package.json` (add `bin`, drop `private` for the preview/customer channel), `packages/kilo-cli/script/{build.ts,build-tui.ts}`.
- Why: v2 builds `kilo2` and declares no `bin`; `npm install -g @kilocode/cli` yields no `kilo` command (`kilo-v2:packages/kilo-cli/package.json:2-4`; `script/build.ts:35`).
- Dependencies: none; blocks every consumer.
- Cloud coordination: yes — release-channel decision (v2 under the same `latest` tag or a new channel, per #14425 unknowns).

### G3 — Version/capability handshake (N9)
- Repo: this repo.
- Touches: `packages/protocol/src/groups/health.ts`, `packages/server/src/handlers/health.ts`, `packages/client/src/service-version.ts`, `packages/kilo-client/src`.
- Why: v2 health returns only `{healthy,version,pid}`; no capability/handshake surface exists, so a client cannot safely select v1 vs v2 routes in one session (`kilo-v2:packages/protocol/src/groups/health.ts:5-10`; `packages/client/src/service-version.ts:3-8`). Record what each consumer needs: cloud-agent-next needs backend generation + feature flags; benchmark/MCP catalog need an argv/output contract marker.
- Dependencies: G1.
- Cloud coordination: yes.

### G4 — Consumer-facing v2 SDK surface
- Repo: this repo.
- Touches: `packages/sdk` (currently `@opencode-ai/sdk`), `packages/kilo-client` (`@kilocode/client`), `packages/client`.
- Why: the cloud imports `@kilocode/sdk` and `@kilocode/sdk/v2` (`cloud@3de933dd wrapper/src/main.ts:18`; `kilo-api.ts:9-16`); v2 publishes no `@kilocode/sdk` (only `@opencode-ai/sdk` at `kilo-v2:packages/sdk/package.json:3`). Decide whether to publish a v2 `@kilocode/sdk` shim or migrate the cloud to `@kilocode/client`.
- Dependencies: G3 for handshake; G5 consumes it.
- Cloud coordination: yes.

### G5 — cloud-agent-next client adaptation to v2 routes/events
- Repo: cloud.
- Touches: `services/cloud-agent-next/wrapper/src/{main.ts,kilo-api.ts,connection.ts,global-feed.ts}`, `wrapper/src/control-plane/{kilo-runtime.ts,turn.ts}`, `src/session/ingest-handlers/entity-id.ts`, `src/router/handlers/session-management.ts`.
- Why: routes (`/api/session`, `/api/session/:id/prompt`, `/api/event`, `/api/session/:id/interrupt`), event vocabulary (`session.text.delta`, `session.tool.*`, `session.inbox.*`, `session.execution.*`) and payloads all differ (§1).
- Dependencies: G1, G3, G4.
- Cloud coordination: yes — cloud team owns the change.

### G6 — v2 credential injection for hosted and floating consumers
- Repo: this repo (runtime), cloud (usage).
- Touches: `packages/kilo-cli/src/{credential-import.ts,import-v1-config.ts,commands.ts,tui-preview.ts}`, `packages/core/src/credential.ts`, `packages/kilo-gateway/src/account.ts`.
- Why: cloud-agent-next injects `KILOCODE_TOKEN`/`KILO_AUTH_CONTENT`/auth.json and the benchmark/MCP CI inject `KILO_AUTH_CONTENT` or `KILO_API_KEY`/`KILO_ORG_ID`; v2 reads none of these (`cloud@3de933dd src/session-service.ts:1277-1289`; `container/server.mjs:66-79`; `kilo-mcp-catalog.yml:155-173`). Options: an explicit v2 env, or seed isolated credentials via `import-v1 --auth` (`kilo-v2:packages/kilo-cli/src/commands.ts:216-238`).
- Dependencies: G2.
- Cloud coordination: yes.

### G7 — v2 `run` argv/output compatibility for headless consumers
- Repo: this repo, cloud.
- Touches: `packages/kilo-cli/src/{commands.ts,run.ts,tui-preview.ts}`, cloud `services/auto-routing-benchmark/{container/server.mjs,src/kilo-events.ts}`, `apps/web/src/scripts/mcp-catalog/catalog.ts`.
- Why: consumers pass `--variant` and parse a streaming JSON event log; v2 has no `--variant` and prints one `{sessionID,text}` object (`kilo-v2:packages/kilo-cli/src/commands.ts:283-352`; `tui-preview.ts:231`). Decide whether v2 preserves `--variant` and a streaming mode or the cloud adapts.
- Dependencies: G2; must precede v2 reaching `latest`.
- Cloud coordination: yes.

### G8 — v2 restore/import compatibility
- Repo: this repo, cloud.
- Touches: `packages/kilo-cli/src/{commands.ts,import-v1-session.ts}`, `packages/schema/src/session-transfer.ts`, `packages/kilo-gateway/src/session.ts`, cloud `services/cloud-agent-next/wrapper/src/restore-session.ts`.
- Why: cloud-agent-next writes `session_share/<id>.json` and runs `kilo import <snapshot.json>` from the session-ingest export; v2 ignores that file and `import` accepts only a local v2 transcript (`cloud@3de933dd wrapper/src/restore-session.ts:169-195,1069,1196-1207`; `kilo-v2:packages/kilo-cli/src/commands.ts:353-370`).
- Dependencies: G9; cross-repo order: v2 importer first, cloud restore second.
- Cloud coordination: yes.

### G9 — session-ingest producer continuity
- Repo: this repo (producer), cloud (validation).
- Touches: `packages/kilo-gateway/src/session.ts`, `packages/schema/src/session-event.ts`, `packages/core/src/session/*`.
- Why: v2 emits only `kilo_meta`/`session`/`message` on explicit share, with no continuous stream, no `part`/`session_diff`/`session_open`/`session_close`/`session_status`/`agent_notification`/`session_pr_link`, and stores bootstrap under `session:<id>` (`kilo-v2:packages/kilo-gateway/src/session.ts:64-97,279-300`; session-ingest union `cloud@3de933dd services/session-ingest/src/types/session-sync.ts:12-99`).
- Dependencies: G3; cloud validates its message projection against v2 self-contained messages.
- Cloud coordination: yes.

### G10 — Event/entity projection mapping for cloud ingest
- Repo: this repo, cloud.
- Touches: cloud `services/cloud-agent-next/src/session/ingest-handlers/*`, `src/websocket/ingest.ts`; v2 `packages/schema/src/session-event.ts`.
- Why: the worker keys entities on `message.updated`/`message.part.updated` (`cloud@3de933dd src/session/ingest-handlers/entity-id.ts:12-27`); v2 uses `session.message.content.updated`/`session.step.*`/`session.tool.*` and self-contained messages.
- Dependencies: G5.
- Cloud coordination: yes.

## Proposed progress-plan row changes (for N7; do not apply here)

File: `migration-tracking/plans/kilo-opencode-v2-plan-progress.md`, section
"Remote, sharing and distribution".

1. Add a row:
   `| Cloud agent consumer contracts | Kilo CLI / Gateway | 4, 6 | Partial | Contract mapping and dispositions complete; implementation gaps open in #14427 | Four in-scope consumers mapped across startup, admission, streaming, tools, credentials, persistence, cancellation. cloud-agent-next needs a v2 client adaptation plus packaging; auto-routing-benchmark and MCP catalog CI float and break on v2 latest; session-ingest has a reduced explicit-share-only v2 producer. See technical-notes/baseline/cloud-agent-contracts.md. |`
2. Amend the #14425-added "Cloud agent runtime consumers (hosted)" row's
   remaining scope to say contract mapping is complete and point at
   `technical-notes/baseline/cloud-agent-contracts.md`.
3. Amend the `Cloud CLI client` row to note that local `kilo cloud` fixtures and
   the `/remote` relay do not establish cloud-hosted consumer compatibility
   (already asserted by #14425; keep the two baselines linked).

Evidence links for the epic: #14425 (inventory), #14426 (contracts, this file),
#14427 (adaptation), #14428 (validation).

## Open questions for the cloud owners

1. Release channel: does v2 replace `@kilocode/cli@latest` (breaking the two
   floating consumers concurrently) or ship under a new tag/name? This decides
   whether the cloud adaptations in G6/G7 must land before v2 is published.
2. Binary contract: will the v2 CLI keep a `kilo` command and a
   `kilo server listening` style readiness line, or is adoption of the `kilo2`
   binary and `URL:`/`Password file:` output acceptable (G1/G2)?
3. Credentials: is `kilo2 import-v1 --auth <file> --apply` an acceptable
   migration for hosted/floating consumers, or does v2 need a first-class env
   injection path for `KILOCODE_TOKEN`/`KILO_API_KEY` (G6)?
4. Session-ingest semantics: can session-ingest consume v2 self-contained
   `message` items without `part` rows, and how should `session_close`/diff/
   status/notifications be carried (G9)?
5. Restore: is there a session-ingest export format both v1 and v2 can import,
   or does the restore path need a v1→v2 transcript converter (G8)?
6. Deployed versions: #14425 recorded that exact dev/prod versions are
   unverified; confirm the currently deployed `KILOCODE_CLI_VERSION` and whether
   any floating image already resolves a v2 `latest`.
