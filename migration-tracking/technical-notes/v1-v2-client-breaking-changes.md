# v1 to v2 client breaking changes

This note lists what a client of the Kilo server must change to move from the v1 server to the v2 server. It is written from the v1 VS Code extension, because that extension calls the most v1 operations, but the wire details apply to every client: JetBrains, cloud agents and other consumers that do not use the TypeScript client.

Sources:

- v1: `origin/main` at `5cc65d1212b`, `packages/kilo-vscode/src` and the generated v1 client `packages/sdk/js/src/v2/gen/sdk.gen.ts`.
- v2: `origin/v2` at `0311551d521` (after the `v2.1.0` sync), the HTTP API in `packages/protocol/src/groups/`, the events in `packages/schema/src/`, the Kilo RPC contracts in `packages/schema/src/kilocode/` (Kilo RPC rows rechecked at `e39551c9b0`).
- Mechanism reference: branch `vscode-v2-boot` (commits `47b491ef2c2`, `5aa92629895`), a v1-shaped adapter over the v2 server. It is a source of facts only. The v2 extension does not use its approach.

Decision: for VS Code, a native rebuild with no v1 wire facade (2026-10-20). The v2 extension is a client of the Kilo host over `@opencode/client` and uses v2 concepts directly. The rule is in [`principles.md`](../principles.md), section 3.

## Wire basics

| Topic | v1 server | v2 server |
|---|---|---|
| Start | `kilo serve --port 0`; stdout line `kilo server listening on http://127.0.0.1:<port>` | `kilo2 serve --port 0 --stdio`; stdout prints one JSON line `{"url":"http://127.0.0.1:<port>"}` (`packages/cli/src/server-process.ts`) |
| Process lifetime | The server watches `KILO_PARENT_PID` and exits when the parent dies | The server exits when its stdin closes (`waitForStdinClose`). The client keeps the stdin pipe open and closes it to stop the server. There is no parent PID watchdog |
| Password | `KILO_SERVER_PASSWORD` | `KILO_SERVER_PASSWORD` still works: the host copies it to `OPENCODE_SERVER_PASSWORD` (`packages/kilo-cli/src/env.ts`). In `--stdio` mode the server removes it from the environment that tools inherit |
| Auth | HTTP Basic, user `kilo` | HTTP Basic, user `opencode` (`packages/server/src/auth.ts`). Browser and WebSocket clients can send the same credential as `?auth_token=<base64 user:password>` |
| Path prefix | none (`/session`, `/provider`) | `/api` (`/api/session`, `/api/provider`). Paths outside `/api` return 404 |
| Directory scope | `?directory=<path>` on almost every route, plus `?workspace=` | Location-scoped routes take `?location[directory]=<path>` (deepObject). `POST /api/session` takes `location: { directory }` in the body. Without the query, the header `x-opencode-directory` (URI-encoded) applies, then the server working directory. Session-scoped routes (`/api/session/:sessionID/...`) resolve the location from the session and take no directory |
| Response body | The resource itself | An envelope: `{ data }`, `{ data, cursor: { previous, next } }` for pages, or `{ location, data }` for location-scoped reads (`Location.response`) |
| Events | `GET /global/event`, SSE of `{ directory, project, workspace, payload }`; `payload.type === "sync"` wraps durable events (`session.updated.1`, `message.part.updated.1`) | `GET /api/event`, SSE of `{ id, created, type, location, data, metadata }`. One stream for all locations. Volatile: no replay, a slow consumer fails the stream, and events during a disconnect are lost. After a reconnect the client reloads state with list calls, or replays the durable events of one session with `GET /api/experimental/session/:sessionID/log?after=<seq>&follow=true` (SSE; durable events carry `durable: { aggregateID, seq, version }`) |
| Health | `GET /global/health` | `GET /api/info` (server name, version, channel) |
| Kilo routes | Hono routes under `/kilo/*`, `/kilocode/*` and others | Plugin RPC: `POST /api/rpc/:rpcID/:method?location[directory]=<path>`, body `{ "input": ... }`, response `{ "output": ... }`. RPC events arrive on `/api/event` with `type: "rpc.<rpcID>.<event>"`. The contracts in `packages/schema/src/kilocode/` are the source of truth for which Kilo RPCs exist |
| Message IDs | Client may set `messageID` | Client may set `id` on `session.prompt`; a retry with the same ID is idempotent |
| Pages | `?before=<messageID>&limit=`, next cursor in the `X-Next-Cursor` header | Opaque `cursor` from `cursor.next` or `cursor.previous` in the response body; `order` only on the first page |

## Operations

The v1 extension calls 129 distinct client operations on 172 lines that match `client.<group>.<method>(` (99 distinct names) and on 30 more that use other call shapes (multi-line chains, aliases such as `api = client.memory`, four-level chains such as `client.kilo.cloud.session.get`). It also calls 7 raw HTTP and WebSocket routes outside the client.

Values in the v2 column:

- A v2 operation: the `@opencode/client` method name and the wire route. This is what the v2 extension calls.
- `kilocode.<rpc>.<method>`: a method of a Kilo RPC that exists on `v2` (contracts in `packages/schema/src/kilocode/`).
- `needs Kilo RPC`: v2 has no public operation yet. The feature epic that adds it is named.
- `dropped`: the v2 client does not need the operation. The reason is named.

### Sessions and messages

| v1 operation | v1 wire | v2 | v2 wire and notes |
|---|---|---|---|
| session.create | `POST /session` | session.create | `POST /api/session` body `{ id?, parentID?, title?, agent?, model?, location?, metadata?, permissions? }`. v1 `platform`, `workspaceID`, `sandboxInheritanceToken` have no v2 field |
| session.get | `GET /session/{id}` | session.get | `GET /api/session/:sessionID`. The session carries `agent`, `model`, `cost`, `tokens`, `location.directory` and `time.archived` |
| session.list | `GET /session` | session.list | `GET /api/session?directory=&project=&subpath=&parentID=null&search=&order=&limit=&cursor=`. `parentID=null` replaces `roots=true` |
| experimental.session.list | `GET /experimental/session` | session.list | Same route, with `archived=true\|false`. v1 `worktrees` and `current` filters have no v2 query |
| session.update | `PATCH /session/{id}` | session.update | `PATCH /api/session/:sessionID` body `{ title?, metadata?, permissions?, archived? }`. Returns 204; the change arrives as `session.renamed` or `session.metadata.updated` |
| session.delete | `DELETE /session/{id}` | session.remove | `DELETE /api/session/:sessionID` |
| session.fork | `POST /session/{id}/fork` `{ messageID }` | session.fork | `POST /api/session/:sessionID/fork` body `{ before? }` |
| session.promptAsync | `POST /session/{id}/prompt_async` | session.prompt | `POST /api/session/:sessionID/prompt` body `{ id?, text, files?, agents?, skills?, metadata?, delivery?, resume? }`. Agent and model are session state, see mismatch 1. v1 `noReply` maps to `resume: false`. v1 `tools`, `format`, `system`, `snapshotInitialization` and `editorContext` have no v2 field; editor context goes into `text` or `metadata` until a feature adds it |
| session.command | `POST /session/{id}/command` | session.command | `POST /api/session/:sessionID/command` body `{ name, text, files?, agents?, skills?, delivery? }`. Model and agent as for prompts |
| session.abort | `POST /session/{id}/abort` | session.interrupt | `POST /api/session/:sessionID/interrupt?resume=`. Returns `{ interrupted }` |
| session.status | `GET /session/status` | session.active | `GET /api/session/active` returns the running sessions only. Status after that comes from execution events, see "Session status" |
| session.messages | `GET /session/{id}/message?limit=&before=` | session.messages | `GET /api/session/:sessionID/message?limit=&order=&cursor=&type=`. Mismatch 6 |
| session.message | `GET /session/{id}/message/{messageID}` | session.message | `GET /api/session/:sessionID/message/:messageID` |
| session.deleteMessage | `DELETE /session/{id}/message/{messageID}?queued=` | session.inbox.cancel for a queued prompt; needs Kilo RPC for a delivered message | Queued: `DELETE /api/session/:sessionID/inbox/:inboxID` (`PATCH` changes steer or queue). Delivered message deletion: session policy, [#15300] |
| session.revert | `POST /session/{id}/revert` `{ messageID, partID }` | session.revert.stage | `POST /api/session/:sessionID/revert/stage` body `{ messageID, files? }`, then `POST .../revert/commit` to keep it. Revert to a part inside a message is not available; Kilo revert semantics: [#15300] |
| session.unrevert | `POST /session/{id}/unrevert` | session.revert.clear | `DELETE /api/session/:sessionID/revert` |
| session.summarize | `POST /session/{id}/summarize` | session.compact | `POST /api/session/:sessionID/compact` body `{ id?, delivery? }`. The session model is used; v1 `providerID`, `modelID`, `auto` have no v2 field |
| session.diff | `GET /session/{id}/diff?messageID=&file=&full=` | session.diff | `GET /api/session/:sessionID/diff?from=&to=`. Per-file and full-content options: VS Code client, [#15315] |
| session.viewed | `POST /session/viewed` | needs Kilo RPC | v2 `POST /api/session/:sessionID/view` body `{ idle }` records a read marker only. Viewer presence for Remote: [#15312], client [#15315] |
| experimental.controlPlane.moveSession | `POST /experimental/control-plane/move-session` | session.move | `POST /api/session/:sessionID/move` body `{ directory, delivery? }`. v1 `moveChanges` (carry the worktree diff) is part of the Agent Manager UI, [#15315] |
| kilocode.resumeSession | `POST /kilocode/session/{id}/resume` | dropped | The v2 server keeps a write-ahead execution claim and resumes claimed sessions at startup. A client sends a new prompt to continue |
| kilocode.sessionModelUsage | `GET /session/{id}/model-usage` | needs Kilo RPC | Model usage per session: [#15303], client [#15315]. v2 sends `session.usage.updated` with session totals only |
| backgroundProcess.stopSession | `POST /background-process/session/{id}/stop` | needs Kilo RPC | Background processes: [#15310]. v2 `DELETE /api/shell/:id` stops one shell of a location |

### Permissions and questions

| v1 operation | v1 wire | v2 | v2 wire and notes |
|---|---|---|---|
| permission.list | `GET /permission` | permission.request.list | `GET /api/permission/request?location[directory]=`, or per session `GET /api/session/:sessionID/permission` |
| permission.reply | `POST /permission/{requestID}/reply` `{ reply, message, interactive }` | session.permission.reply | `POST /api/session/:sessionID/permission/:requestID/reply` body `{ decision: "once" \| "always" \| "reject", message? }`. Mismatch 2. `always` saves the rule; saved rules are at `/api/permission/saved` |
| question.list | `GET /question` | form.list | `GET /api/form?location[directory]=`, or per session `GET /api/session/:sessionID/form` |
| question.reply | `POST /question/{requestID}/reply` `{ answers: string[][] }` | session.form.reply | `POST /api/session/:sessionID/form/:formID/reply` body `{ answer: { <field key>: string \| number \| boolean \| string[] } }`. Mismatch 3 |
| question.reject | `POST /question/{requestID}/reject` | session.form.cancel | `DELETE /api/session/:sessionID/form/:formID?message=` |
| network.list | `GET /network` | needs Kilo RPC | Offline network wait: [#15300] (runtime), [#15315] (controls) |
| network.reject | `POST /network/{requestID}/reject` | needs Kilo RPC | As `network.list` |
| suggestion.list | `GET /suggestion` | needs Kilo RPC | Suggestions: [#15302] (tool), [#15315] (client) |
| suggestion.accept | `POST /suggestion/{requestID}/accept` | needs Kilo RPC | As `suggestion.list` |
| suggestion.dismiss | `POST /suggestion/{requestID}/dismiss` | needs Kilo RPC | As `suggestion.list` |

### Catalog, agents, commands and files

| v1 operation | v1 wire | v2 | v2 wire and notes |
|---|---|---|---|
| provider.list | `GET /provider` | provider.list, model.list, model.default | `GET /api/provider`, `GET /api/model`, `GET /api/model/default`, all with `?location[directory]=`. Mismatch 7 |
| provider.auth | `GET /provider/auth` | integration.list | `GET /api/integration`: each integration lists its auth methods |
| provider.oauth.authorize | `POST /provider/{id}/oauth/authorize` | integration.oauth.connect | `POST /api/integration/:integrationID/connect/oauth` starts an attempt; `GET .../connect/oauth/:attemptID` polls it; `DELETE` cancels it |
| provider.oauth.callback | `POST /provider/{id}/oauth/callback` | integration.oauth.status | The server completes the attempt; the client polls the attempt status instead of posting the code |
| auth.set | `PUT /auth/{providerID}` | integration.connect.key | `POST /api/integration/:integrationID/connect/key` body `{ key, answer?, label? }`, or `POST /api/credential` |
| auth.remove | `DELETE /auth/{providerID}` | credential.remove | `DELETE /api/credential/:credentialID`. Credentials have IDs; find them with `GET /api/credential` |
| app.agents | `GET /agent` | agent.list | `GET /api/agent?location[directory]=` |
| app.skills | `GET /skill` | skill.list | `GET /api/skill?location[directory]=` |
| command.list | `GET /command` | command.list | `GET /api/command?location[directory]=` |
| find.files | `GET /find/file?query=&dirs=&type=&limit=` | fs.find | `GET /api/fs/find?location[directory]=&query=&type=&limit=` |
| project.current | `GET /project/current` | location.get, vcs.get | `GET /api/location?location[directory]=` returns the project ID and directory; `GET /api/vcs` returns the VCS state |
| mcp.status | `GET /mcp` | mcp.list | `GET /api/mcp?location[directory]=` |
| mcp.connect | `POST /mcp/{name}/connect` | mcp.connect | `POST /api/experimental/mcp/:server/connect` |
| mcp.disconnect | `POST /mcp/{name}/disconnect` | mcp.disconnect | `POST /api/experimental/mcp/:server/disconnect` |
| mcp.add | `POST /mcp` | mcp.add | `PUT /api/experimental/mcp/:server`. The v1 caller (browser automation) is default-off and post-cutover ([#15321]) |
| mcp.auth.authenticate | `POST /mcp/{name}/auth/authenticate` | integration.oauth.connect | A remote MCP server with OAuth is an integration on v2 (`packages/core/src/mcp/index.ts`). Callback handoff deltas: [#15307] |
| mcp.auth.cancel | `POST /mcp/{name}/auth/cancel` | integration.oauth.cancel | `DELETE /api/integration/:integrationID/connect/oauth/:attemptID` |
| mcp.auth.remove | `DELETE /mcp/{name}/auth` | credential.remove | `DELETE /api/credential/:credentialID` |
| pty.create | `POST /pty` | pty.create | `POST /api/pty?location[directory]=` |
| pty.update | `PUT /pty/{id}` | pty.update | `PUT /api/pty/:ptyID`. v1 `sessionID` field has no v2 field |
| pty.remove | `DELETE /pty/{id}` | pty.remove | `DELETE /api/pty/:ptyID` |
| v2.pty.create | `POST /api/pty` | pty.create | The v1 server already served this v2 route. Unchanged |
| v2.pty.get | `GET /api/pty/{id}` | pty.get | Unchanged |
| v2.pty.update | `PUT /api/pty/{id}` | pty.update | Unchanged |
| v2.pty.remove | `DELETE /api/pty/{id}` | pty.remove | Unchanged |

### Configuration and instance

Settings are read-only on v2 until a Kilo settings RPC exists. It replaces the v1 `/config/*` group. The config layer comes first; both are in config and settings, [#15299], and the VS Code settings ([#15315]) consume the RPC. The upstream `PATCH /api/experimental/config` is not the Kilo settings contract and the v2 extension does not use it.

| v1 operation | v1 wire | v2 | v2 wire and notes |
|---|---|---|---|
| config.get | `GET /config` | config.get | `GET /api/config?location[directory]=` (read only) |
| global.config.get | `GET /global/config` | config.get | v2 has no separate global read; scoped reads come with the settings RPC |
| config.overlay | `GET /config/overlay?scope=` | needs Kilo RPC | Settings RPC, [#15299] |
| config.overlayUpdate | `PATCH /config/overlay` | needs Kilo RPC | Settings RPC, [#15299] |
| config.update | `PATCH /config` | needs Kilo RPC | Settings RPC, [#15299] |
| global.config.update | `PATCH /global/config` | needs Kilo RPC | Settings RPC, [#15299] |
| config.warnings | `GET /config/warnings` | needs Kilo RPC | Settings RPC, [#15299] |
| global.dispose | `POST /global/dispose` | location.reload | `POST /api/location/reload`. After an org switch or a credential change the catalog updates itself and sends events, see mismatch 7 |
| instance.dispose | `POST /instance/dispose` | location.reload | As above |
| instance.reload | `POST /instance/reload` | location.reload | As above |
| global.event | `GET /global/event` | event.subscribe | `GET /api/event`, see "Wire basics" |
| experimental.capabilities.get | `GET /experimental/capabilities` | kilocode.handshake.get for identity; needs Kilo RPC for capabilities | `POST /api/rpc/kilocode.handshake/get` body `{ "input": {} }` returns `{ product: "kilo", version, channel }`. An upstream server answers `rpc.unavailable`, a v1 server 404. Feature capabilities: [#15299] (server), [#15315] (client) |

### Kilo Gateway, account and generation

| v1 operation | v1 wire | v2 | v2 wire and notes |
|---|---|---|---|
| kilo.authStatus | `GET /kilo/auth-status` | kilocode.gateway.authStatus | `POST /api/rpc/kilocode.gateway/authStatus` body `{ "input": {} }` |
| kilo.profile | `GET /kilo/profile` | kilocode.gateway.profile, balance, kiloPass | Three RPC calls; v1 returned one combined object |
| kilo.organization.set | `POST /kilo/organization` `{ organizationId }` | kilocode.gateway.organization.set | Body `{ "input": { "organizationID": ... } }`. The RPC event `rpc.kilocode.gateway.organization` follows |
| kilo.fim | `POST /kilo/fim` (SSE response) | needs Kilo RPC | FIM producer: [#15314]. `kilocode.gateway.autocomplete.fimTarget` exists and returns the target only |
| kilo.edit | `POST /kilo/edit` | needs Kilo RPC | Next-edit producer: [#15314]. `kilocode.gateway.autocomplete.editTarget` returns the target only |
| kilo.cloudSessions | `GET /kilo/cloud-sessions` | needs Kilo RPC | Cloud session import: [#15306] |
| kilo.cloud.session.get | `GET /kilo/cloud/session/{id}` | needs Kilo RPC | [#15306] |
| kilo.cloud.session.import | `POST /kilo/cloud/session/import` | needs Kilo RPC | [#15306] |
| kilocode.providerUsage.get | `GET /kilocode/provider-usage` | kilocode.provider-usage.get | `POST /api/rpc/kilocode.provider-usage/get` body `{ "input": {} }` returns `{ items, generatedAt }`. Cached for 60 seconds after a good answer and 10 seconds after a failure. Kilo coding plans come from `kilocode.gateway.codingPlans` and `codingPlanUsage` |
| kilocode.providerUsage.refresh | `POST /kilocode/provider-usage/refresh` | kilocode.provider-usage.refresh | `POST /api/rpc/kilocode.provider-usage/refresh` body `{ "input": {} }`: fetches every source again |
| enhancePrompt.enhance | `POST /enhance-prompt` | needs Kilo RPC | Generation endpoints: [#15314]. That epic decides the equivalence with upstream `POST /api/session/:sessionID/generate` |
| commitMessage.generate | `POST /commit-message` | needs Kilo RPC | [#15314] |
| branchName.generate | `POST /session/{id}/branch-name` | needs Kilo RPC | [#15314] |

### Agent Manager and worktrees

| v1 operation | v1 wire | v2 | v2 wire and notes |
|---|---|---|---|
| kilocode.agentManager.list | `GET /kilocode/agent-manager` | needs Kilo RPC | Agent Manager control plane: [#15310] |
| kilocode.agentManager.reply | `POST /kilocode/agent-manager/{requestID}/reply` | needs Kilo RPC | [#15310] |
| kilocode.agentManager.reject | `POST /kilocode/agent-manager/{requestID}/reject` | needs Kilo RPC | [#15310] |
| kilocode.teardownWorktree | `POST /kilocode/worktree/teardown` | needs Kilo RPC | Worktree runtime: [#15310]. v2 `DELETE /api/worktree` removes the worktree, but does not stop its PTYs and instance first |
| kilocode.snapshot.prepare | `POST /kilocode/snapshot/prepare` | needs Kilo RPC | Snapshot seed: [#15300]. The Agent Manager UI ([#15315]) decides whether it still needs a warm-up |
| kilocode.removeSnapshot | `POST /kilocode/snapshot/remove` | needs Kilo RPC | Snapshot cleanup: [#15300] |

### Kilo features outside chat

| v1 operation | v1 wire | v2 | v2 wire and notes |
|---|---|---|---|
| kilocode.backgroundJobs | `GET /kilocode/background-jobs` | needs Kilo RPC | Background subagents: [#15310], client [#15315] |
| kilocode.backgroundJob.cancel | `POST /kilocode/background-jobs/{id}/cancel` | needs Kilo RPC | [#15310] |
| kilocode.backgroundJob.promote | `POST /kilocode/background-jobs/{id}/promote` | needs Kilo RPC | [#15310]. v2 `POST /api/session/:sessionID/background` moves a running session to the background, a different operation |
| kilocode.sessionBoard | `GET /kilocode/session/{id}/board` | needs Kilo RPC | Shared agent board: [#15310], client [#15315] |
| kilocode.resetSessionBoard | `POST /kilocode/session/{id}/board/reset` | needs Kilo RPC | [#15310] |
| kilocode.wakeups | `GET /kilocode/wakeups` | needs Kilo RPC | Wakeups and cron: [#15310], client [#15315] |
| kilocode.retention.status | `GET /kilocode/retention` | needs Kilo RPC | Session retention: [#15299], client [#15315] |
| kilocode.retention.run | `POST /kilocode/retention/run` | needs Kilo RPC | [#15299] |
| kilocode.retention.cancel | `POST /kilocode/retention/cancel` | needs Kilo RPC | [#15299] |
| kilocode.marketplace.list | `GET /kilocode/marketplace` | kilocode.marketplace.list | `POST /api/rpc/kilocode.marketplace/list` body `{ "input": { kind, refresh?, query? } }`. `kilocode.marketplace.installed` lists installed items and `preview` renders an install without writing it. Client: [#15315] |
| kilocode.marketplace.install | `POST /kilocode/marketplace/install` | kilocode.marketplace.install | `POST /api/rpc/kilocode.marketplace/install` body `{ "input": { registry, kind, id, scope, option?, params? } }` |
| kilocode.marketplace.remove | `POST /kilocode/marketplace/remove` | kilocode.marketplace.uninstall | `POST /api/rpc/kilocode.marketplace/uninstall` body `{ "input": { registry, kind, id, scope } }` |
| kilocode.removeAgent | `POST /kilocode/agent/remove` | needs Kilo RPC | Agent removal: [#15301], client [#15315] |
| kilocode.removeSkill | `POST /kilocode/skill/remove` | needs Kilo RPC | Skill removal: [#15302], client [#15315] |
| memory.status | `GET /memory/status` | needs Kilo RPC | Memory RPC: [#15308], client [#15315] |
| memory.show | `GET /memory/show` | needs Kilo RPC | [#15308] |
| memory.enable | `POST /memory/enable` | needs Kilo RPC | [#15308] |
| memory.disable | `POST /memory/disable` | needs Kilo RPC | [#15308] |
| memory.rebuild | `POST /memory/rebuild` | needs Kilo RPC | [#15308] |
| memory.remember | `POST /memory/remember` | needs Kilo RPC | [#15308] |
| memory.correct | `POST /memory/correct` | needs Kilo RPC | [#15308] |
| memory.forget | `POST /memory/forget` | needs Kilo RPC | [#15308] |
| memory.purge | `POST /memory/purge` | needs Kilo RPC | [#15308] |
| memory.configure | `POST /memory/configure` | needs Kilo RPC | [#15308] |
| sandbox.support | `GET /sandbox/support` | needs Kilo RPC | Sandbox: [#15309], client [#15315] |
| sandbox.status | `GET /session/{id}/sandbox` | needs Kilo RPC | [#15309] |
| sandbox.toggle | `POST /session/{id}/sandbox/toggle` | needs Kilo RPC | [#15309] |
| remote.status | `GET /remote/status` | needs Kilo RPC | Remote: [#15312], client [#15315] |
| remote.enable | `POST /remote/enable` | needs Kilo RPC | [#15312] |
| remote.disable | `POST /remote/disable` | needs Kilo RPC | [#15312] |
| kilocode.sessionImport.project | `POST /kilocode/session-import/project` | needs Kilo RPC | Kilo-classic session migration: [#15315], on top of the v1 import ([#15306]) |
| kilocode.sessionImport.session | `POST /kilocode/session-import/session` | needs Kilo RPC | [#15315] |
| kilocode.sessionImport.message | `POST /kilocode/session-import/message` | needs Kilo RPC | [#15315] |
| kilocode.sessionImport.part | `POST /kilocode/session-import/part` | needs Kilo RPC | [#15315] |
| kilocode.notebook.list | `GET /kilocode/notebook` | dropped for G2 | Notebook tools are default-off on v1 and post-cutover (out of scope in [`plan.md`](../plan.md), [#15321]) |
| kilocode.notebook.reply | `POST /kilocode/notebook/{requestID}/reply` | dropped for G2 | As `kilocode.notebook.list` |
| kilocode.notebook.reject | `POST /kilocode/notebook/{requestID}/reject` | dropped for G2 | As `kilocode.notebook.list` |
| anacondaDesktop.status | `GET /kilocode/anaconda-desktop/status` | needs Kilo RPC | Anaconda Desktop: [#15319] (integration mode open) |
| anacondaDesktop.open | `POST /kilocode/anaconda-desktop/open` | needs Kilo RPC | [#15319] |
| anacondaDesktop.sync | `POST /kilocode/anaconda-desktop/sync` | needs Kilo RPC | [#15319] |

### Raw routes outside the client

| v1 route | v2 | Notes |
|---|---|---|
| `GET /global/health` | server.info | `GET /api/info`. A health poll is optional: the stdio pipe and the event stream show a dead server |
| WebSocket `/pty/{id}/connect?directory=&cursor=&auth_token=` | pty.connectToken | `POST /api/pty/:ptyID/connect-token` returns `{ ticket, expires_in }`; then WebSocket `/api/pty/:ptyID/connect?ticket=<ticket>&cursor=` |
| WebSocket `/api/pty/{id}/connect` | pty.connectToken | Same route; v2 accepts a one-time `ticket` instead of the password |
| `GET /kilo/models/images` | kilocode.gateway.models.images | RPC |
| `POST /indexing/consent` | needs Kilo RPC | Codebase indexing: [#15308], client [#15315] |
| `POST /telemetry/capture`, `POST /telemetry/setEnabled` | needs Kilo RPC | Telemetry proxy: [#15303], client [#15315] |
| `/kilocode/heap/snapshot` | dropped | A v1 debug command. v2 has `/api/debug/location` for location diagnostics; a heap snapshot command is not carried |

### Count

| Result | Operations |
|---|---|
| v2 operation | 55 (for `session.deleteMessage` only the queued case) |
| Kilo RPC | 8 (10 RPC methods) |
| needs Kilo RPC | 62 |
| dropped | 4 |
| Total | 129 |

The rows that need a Kilo RPC, here and in the raw routes, name the feature epic that adds each one. The v2 extension shows no control for them until the feature lands; it does not stub them. The reference adapter on `vscode-v2-boot` turned these features off with 17 flags (`src/features.ts`: marketplace, notebook, agentManager, sessionBoard, sessionImport, retention, providerUsage, autocomplete, cloudSessions, suggestions, remote, sandboxNetwork, anacondaDesktop, commitMessage, configRemoval, memory, indexing) and logged every unmapped call once (`unmapped` set in `v2/client.ts`). The native extension has neither: a feature is absent until it is built on its v2 operation.

## Mismatches and how a v2-native client handles them

### 1. Model and agent are session state

v1 sends `model`, `agent` and `variant` with every prompt and command. v2 stores them on the session: `POST /api/session/:sessionID/model` body `{ model: { id, providerID, variant? } }` and `POST /api/session/:sessionID/agent` body `{ agent }`, both before the prompt. Changes arrive as `session.model.selected` and `session.agent.selected`. A step records the model it used in `session.step.started`. A native client keeps the selection on the session view, calls the switch operation when the user changes it, and sends prompts without a model. `session.create` accepts `agent` and `model` for the first selection.

### 2. Replies are routed under the session

v1 replies with only the request ID: `POST /permission/{requestID}/reply`. v2 needs the owning session: `POST /api/session/:sessionID/permission/:requestID/reply`. The `permission.asked` event and `GET /api/permission/request` both carry `sessionID`, so a native client keeps the request with its session and has no lookup table.

### 3. Questions are forms

v1 questions are a list of prompts, each with options, and the answer is `string[][]` by position. v2 has forms (`packages/schema/src/form.ts`): `form.created` carries `{ form: { id, sessionID, title, fields } }` and each field has a `key` and a `type` of `string`, `number`, `integer`, `boolean`, `multiselect` or `external` (a URL to open, for example MCP OAuth). Fields can be `required`, `hidden` and conditional (`when`). The answer is a record by key: `{ answer: { <key>: value } }`. `form.replied` and `form.cancelled` end the form. A form can belong to the sentinel owner `"global"` (MCP elicitation) instead of a session. A native client renders the field types directly and validates with the field constraints. The `question` tool on v2 creates a form with `metadata.kind = "question"` and one field per question, keyed `q0` to `qN` (`multiselect`, or `string` with `options`), so the answer is for example `{ q0: "label", q1: ["a", "b"] }`.

### 4. No `session.status` event

v1 sends `session.status` (`idle`, `busy`, `retry`), `session.idle` and `session.turn.open` and `session.turn.close`. v2 defines `session.status` in the schema but no code publishes it. Status is derived from `session.execution.*` events, see the next section. The retry state comes from `session.retry.scheduled` `{ attempt, error, at }`.

### 5. Part order

v1 messages have parts with their own IDs, and the v1 webview sorts parts by ID. v2 assistant messages have an ordered `content` array: text and reasoning blocks are addressed by `ordinal`, tool calls by call `id`. The stream events (`session.text.delta`, `session.reasoning.delta`, `session.tool.*`) name the assistant message and the ordinal or call ID. A native client keeps the content array in arrival order and never sorts by ID. The reference adapter had to make up IDs that sort in content order (`<messageID>:0001`); a native client does not.

### 6. Message cursors

v1 pages with `?before=<messageID>&limit=` and returns the next cursor in the `X-Next-Cursor` header. v2 returns `{ data, cursor: { previous, next } }`. The cursor is opaque, carries its own order and must not be sent together with `order`. The first page sends `order=desc` (newest first) and `limit`. Older pages follow `cursor.next`. The `type` filter must repeat on every page.

### 7. The model catalog fills in after startup

On v1 the provider list is complete when the server answers. On v2 the catalog loads in the background and changes with credentials. A first `GET /api/provider` or `GET /api/model` can return a partial list, and `provider.updated`, `model.updated`, `agent.updated`, `config.updated`, `integration.updated`, `credential.updated` and `credential.switched` follow. A native client reloads the affected list on each event and does not cache the first answer.

### 8. Tool names and inputs differ

| v1 tool | v1 input | v2 tool | v2 input |
|---|---|---|---|
| bash | `command, timeout, workdir, description` | shell | `command, workdir, timeout, background` |
| read | `filePath, offset, limit` | read | `path, offset, limit` |
| edit | `filePath, oldString, newString, replaceAll` | edit | `path, oldString, newString, replaceAll` |
| write | `filePath, content` | write | `path, content` |
| apply_patch | `patchText` | patch | `patchText` |
| glob | `pattern, path` | glob | `pattern, path, hidden, limit` |
| grep | `pattern, path, include` | grep | `pattern, path, include, literal, caseSensitive, limit` |
| task | `description, prompt, subagent_type, task_id` | subagent | `agent, description, prompt, model, sessionID, background` |
| skill | `name` | skill | `id` |
| todowrite | `todos` | todowrite | `todos` |
| question | `questions` | question | `questions` (the answer is a form, see mismatch 3) |
| webfetch | `url, format, timeout` | webfetch | `url, format, timeout` |
| websearch | `query` | websearch | `query` |

Tool states also differ: v2 tool content goes through `streaming` (raw input text), `running` (parsed input), `completed` and `error`, from `session.tool.input.delta`, `session.tool.input.ended`, `session.tool.called`, `session.tool.progress`, `session.tool.success` and `session.tool.failed`. MCP tools are named `<server>_<tool>`. For model IDs that contain `gpt-` (except `oss` and `gpt-4`), `patch` replaces `edit` and `write`; other models get `edit` and `write` without `patch`. `todowrite` is registered only when the config sets `experimental.todo`. A native client renders tools by v2 name and input fields and does not map them to v1 names.

## Session status

These rules are the status model of the v2 extension. They match `@opencode/client/solid` (`packages/client/src/solid/data.ts`), which the TUI uses.

| Event | Status | Turn |
|---|---|---|
| `GET /api/session/active` at connect | `running` for each listed session, `idle` for others | none |
| `session.execution.started` | `running` | opens a turn |
| `session.execution.succeeded` | `idle` | closes the turn as completed |
| `session.execution.failed` | `idle` | closes the turn as failed; shows `error` |
| `session.execution.interrupted`, reason `user`, `superseded` or `inactivity` | `idle` | closes the turn as interrupted |
| `session.execution.interrupted`, reason `shutdown` | `idle` | closes no turn: a server shutdown is not a turn end the user caused, and the claim makes the server resume the session at its next start |
| `session.retry.scheduled` | `running`, with attempt, error message and next time | none |

An interrupt ends every open step: open steps get no `session.step.ended` after it, so the client marks open steps and tool calls of that session as ended when the interrupt arrives. A reconnect loses events (the stream has no replay), so after a reconnect the client calls `GET /api/session/active` and reloads the open session, or replays its durable events from the session log.

[#15299]: https://github.com/Kilo-Org/kilocode/issues/15299
[#15300]: https://github.com/Kilo-Org/kilocode/issues/15300
[#15301]: https://github.com/Kilo-Org/kilocode/issues/15301
[#15302]: https://github.com/Kilo-Org/kilocode/issues/15302
[#15303]: https://github.com/Kilo-Org/kilocode/issues/15303
[#15306]: https://github.com/Kilo-Org/kilocode/issues/15306
[#15307]: https://github.com/Kilo-Org/kilocode/issues/15307
[#15308]: https://github.com/Kilo-Org/kilocode/issues/15308
[#15309]: https://github.com/Kilo-Org/kilocode/issues/15309
[#15310]: https://github.com/Kilo-Org/kilocode/issues/15310
[#15312]: https://github.com/Kilo-Org/kilocode/issues/15312
[#15314]: https://github.com/Kilo-Org/kilocode/issues/15314
[#15315]: https://github.com/Kilo-Org/kilocode/issues/15315
[#15319]: https://github.com/Kilo-Org/kilocode/issues/15319
[#15321]: https://github.com/Kilo-Org/kilocode/issues/15321
