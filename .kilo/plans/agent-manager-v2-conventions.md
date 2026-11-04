# Agent Manager v2 port: boundary conventions (all agents follow these)

Worktree: /Users/marius/Documents/git/kilocode/.kilo/worktrees/stupendous-borogovia
PKG = packages/kilo-vscode. V1 (read-only extract) = /var/folders/6c/3j3r25ds6pd1dw3nlrfnvv280000gp/T/kilo/v1/packages/kilo-vscode
v1 is also branch `main` (read with `git show main:<path>`, never check it out).

## Hard rules
- Never run git checkout/reset/stash/commit/branch changes. Several agents edit this worktree at once. Touch ONLY the files of your scope. If you need a change in a file outside your scope, post an ASK on the board to the coordinator (main) with the exact change, and continue.
- AGENTS.md style: no `any`, no `as any`, no `@ts-ignore`, no success shims (never return fake success), no dead code, no TODOs, no comments that mention v1/main/"as before". Prefer const, early returns, no else, no unnecessary destructuring.
- Excluded features leave NO trace (no control, import, field, CSS, message type): codebase indexing, sandbox metadata and the inheritance token, browser automation and the browser panel, telemetry (remove calls, keep the wrapped behavior), speech to text, the documents panel, Memory and Feedback providers, attached-session presence.
- Lint: from the worktree root `node_modules/.bin/oxlint --config .oxlintrc.json <your files>` must show 0 problems (complexity max 20/function, max-lines 3000/file). Refactor only offending functions.
- Never copy the v1 session plumbing: services/cli-backend (connection-service, sdk-sse-adapter, server-manager), KiloProvider, SessionProvider, DataBridge, ProviderShell, ChatView, webview-ui/src/context/session*, the v1 session activity/live-session state, permission/question directory maps, session directory override maps. Replace their use with the seam below.

## Host seam (extension host, Node; no Bun APIs in src/)
- `src/agent-manager/connection.ts` `createAgentManagerConnection` -> `AgentManagerConnection`:
  - `client(): Promise<OpenCodeClient>` (starts the server if needed), `current(): OpenCodeClient | undefined`
  - `state(): "connecting"|"connected"|"disconnected"`, `onState(fn)` -> unsubscribe
  - `onEvent(listener, filter?)` -> unsubscribe; `located(() => dirs)` filter helper
  - `server(): { url, authorization } | undefined` (for WebSocket URLs)
  - `view(sessionIDs)` marks idle transitions of visible sessions viewed (`session.view`), replaces registerVisible.
- One client for all directories: pass the directory in EACH call. Read the exact input shapes in packages/client/src/promise/generated/types.ts (search `export type <Name>Input`). Examples: `session.list({ directory, parentID: null })`, `session.create({ location: { directory }, agent, model, metadata })`, `agent.list({ location: { directory } })`, `pty.create({ location: { directory }, cwd, title, env })`.
- Removed with no replacement (delete their callers): registerDirectoryProvider, registerAttached, getKnownDirectories (use AM's own worktree list), setSessionDirectory/session directory overrides.
- Errors: `getErrorMessage` from src/agent-manager/errors.ts; `sameDirectory` from src/agent-manager/project/paths.ts.
- Platform: `metadata: { kilocode: { platform: "agent-manager" } }` on session.create (see packages/schema/src/kilocode/gateway.ts:306 for the field).

## API mapping (v1 -> v2)
| v1 | v2 |
|---|---|
| session.create | session.create({ location:{directory}, agent, model:{id, providerID, variant?}, metadata }) |
| session.list | session.list({ directory, parentID: null }) |
| session.get | session.get({ sessionID }) |
| promptAsync / sendMessage | session.prompt({ sessionID, text, files, metadata }) (returns after admission; do NOT pass resume:false, that never runs it) |
| synthetic text | session.synthetic({ sessionID, text, metadata }) |
| command | session.command({ sessionID, name, text, files }) |
| abort | session.interrupt({ sessionID }) |
| delete | session.remove({ sessionID }) |
| update title | session.update({ sessionID, title }) |
| fork | session.fork({ sessionID, before? }) -> SessionInfo |
| controlPlane.moveSession | session.move({ sessionID, directory }); handoff = fork then move |
| agent / model switch | session.switchAgent({sessionID, agent}), session.switchModel({sessionID, model}) |
| PTY | client.pty.create/update/remove/list; WebSocket URL = `ws(s)://<server host>/api/pty/${ptyID}/connect?ticket=<ticket>` where `ticket` = (await client.pty.connect.token({ ptyID, location:{directory}, "x-opencode-ticket": "1" })).data.ticket (PtyTicketConnectToken {ticket, expires_in}; single use, short-lived: request a fresh one for every socket open, see packages/client/src/solid/pty.ts) |
| permission.list | permission.request.list |
| question.* | form.list, session.form.reply |
| app.agents, mcp.status | agent.list, mcp.list |
| bulk status | session.active() once (map of sessionID -> {type:"running"}), then events |
| branchName.generate | client.rpc(KiloBranchNameRpc.Definition).generate({ sessionID, prompt, providerID?, modelID? }, { location:{directory} }) -> { branch: string \| null }; import from "@opencode/schema/kilocode/branch-name" |
| /kilocode/agent-manager routes + kilocode.agent_manager.* events | client.rpc(KiloAgentManagerRpc.Definition) methods list/reply/reject and events start/requested/cancelled ("@opencode/schema/kilocode/agent-manager") |

## Event mapping (envelope v1 `{type, properties}` -> v2 `{id, type, data, location}`; `location.directory` is the directory)
| v1 | v2 |
|---|---|
| session.created / updated | session.created, session.metadata.updated, session.renamed, session.moved, session.archived |
| session.deleted | session.deleted |
| session.status (busy/idle/retry) | session.status, session.execution.started/succeeded/failed/interrupted, session.idle, session.retry.scheduled |
| session.error | session.execution.failed |
| question.* | form.created, form.replied, form.cancelled |
| permission.* | permission.asked, permission.replied |
| message.part.* | session.text.*, session.tool.*, session.step.* |
| server.instance.disposed | global.disposed |
| pty.* | pty.created/updated/exited/deleted |

## Webview seam (webview-ui/agent-manager)
- `v2/panel-data.ts` `createPanelData({ post })` -> `PanelData`: one client + one event stream for the panel; `store(directory)` returns the lazily created per-directory `V2` scope (`.api`, `.data` = createData store, `.connection`, `.report`, ...); `release(dir)`, `retain(dirs)`, `receive(message)`.
- `v2/sessions.ts` `createSessions({ panel, directories, directoryOf })`: `sessions()`, `get(id)`, `scope(id)`, `currentSessionID()`, `selectSession(id)`, `clearCurrentSession()`, `activityFor(id)`, `isSubmitting(id)`, `messages(id)`, `loading(id)`, `sync(id)`, `release(id)`, `interrupt(id)`.
- `v2/activity.ts`: `Activity`, `strongest`, `score`, `running`, `label`, `description`, `sessionActivity`.
- `v2/vscode.ts`: `useVSCode()` typed with the AM message contract. Use it instead of the shared context in AM files.
- Session UI: `webview-ui/src/v2/session-view.tsx` `SessionView` (transcript + docks + prompt) inside `<V2Scope value={panel.store(dir)}>` from `webview-ui/src/v2/client.tsx`.
- Message contract: host `src/agent-manager/types.ts` (AgentManagerInMessage/OutMessage) and webview `webview-ui/src/types/messages/agent-manager.ts` (AgentManagerExtensionMessage/WebviewMessage). Keep both in sync when you add/remove a message.

## Verify
- From PKG: `../../node_modules/.bin/tsc --noEmit` (host+tests) and `bun test test/<your tests>`. The webview program has no entry yet; for webview files create a temporary tsconfig extending webview-ui/tsconfig.json with your files and delete it after.
- Port the v1 tests of your modules (V1/tests/unit/*.test.ts and V1/src/agent-manager/__tests__) to PKG/test/<same basename>, bun:test, important assertions unchanged.
