# 8: I2A: Automatically show Cloud sessions with full interaction in JetBrains Agent Manager

**Private issue**: https://github.com/Kilo-Org/kilo-taskboard/issues/8
**Target repository**: `Kilo-Org/kilocode` | **Branch**: `feat/jetbrains-hosted-cloud-sessions`

## Goal

Make the current repository's authorized Cloud workspaces and hosted root sessions appear automatically beside local worktrees in JetBrains Agent Manager, and let the ordinary `SessionUi` open, read, and drive a hosted session through the local `kilo serve` Session Host attachment proxy — with no Cloud credentials, second transport, fake local Workspace records, or local filesystem/Git actions.

## Existing seams

- `packages/opencode/src/kilocode/session-hosting/types.ts`: provider-neutral `HostedWorkspace`, `HostedWorkspaceStatus`, `HostedSessionID`, and paginated inputs already delivered by #51.
- `packages/opencode/src/kilocode/server/httpapi/handlers/session-host.ts`: local `/kilocode/session-host/*` control routes, opaque `wrk_att_*` attachment minting, and attachment disposal.
- `packages/opencode/src/kilocode/server/httpapi/middleware/hosted-routing.ts` plus `session-hosting/native-routes.ts`: attaches a session to the proven native allowlist and forwards `x-kilo-workspace`/`?workspace=` traffic to Cloud without exposing credentials.
- `packages/kilo-jetbrains/backend/build/generated/openapi/.../DefaultApi.kt`: generated Kotlin client already exposes `sessionHostListWorkspaces`, `sessionHostGetWorkspace`, `sessionHostGetWorkspaceStatus`, `sessionHostAttach`, `sessionHostDetach`, and native methods accept a `workspace` selector (`sessionPromptAsync`, `sessionAbort`, `sessionMessages`, `permissionReply`, `questionReply`, `sessionDiff`, `cloudAgentSystemEvents`).
- `packages/kilo-jetbrains/backend/.../app/KiloBackendConnectionService.kt`: per-CLI SSE lifecycle and reconnect conventions; `.../app/KiloBackendChatManager.kt`: `ChatEventNormalizer` reuse and global chat event fan-out; `.../app/KiloBackendActivityManager.kt`: activity derived from those events.
- `packages/kilo-jetbrains/shared/.../rpc/KiloSessionRpcApi.kt`: existing session-facing RPC the frontend controller already consumes.
- `packages/kilo-jetbrains/frontend/.../session/SessionRef.kt`, `SessionHost.kt`, `SessionUiFactory.kt`, `session/controller/SessionController.kt`: ordinary transcript UI, per-session controllers, and the worktree/session editor pattern to reuse.
- `packages/kilo-jetbrains/frontend/.../agentManager/AgentManagerPanel.kt` and `agentManager/worktree/WorktreeSessionEditorKind.kt`: list rows, editor identity, and the worktree session list/selection pattern.

## Steps

1. **Shared contract.** Add `shared/.../rpc/dto/HostedDto.kt` with serializable provider availability, hosted workspace/workspace-session, passive status, capability, and decoded system-event DTOs. Add `shared/.../rpc/KiloHostedRpcApi.kt` for provider/workspace discovery, detail, status, and system-event streaming.
2. **Backend hosted gateway.** Add `backend/.../app/KiloBackendHostedManager.kt`: parse composite hosted identities, call the generated `sessionHost.*` client, cache and renew opaque attachments, route the native allowlist with `workspace=wrk_att_*`, parse native SSE into `ChatEventDto`, parse `cloudAgent.systemEvents` into preparation/sandbox status, remap native ids to composite ids, and reconnect with bounded backoff + a resnapshot signal. Strip no provider credential ever leaves the CLI.
3. **Backend session routing.** Make `KiloSessionRpcApiImpl` transparently route composite hosted session ids (and hosted workspace directory markers for pending permission/question recovery) to the gateway, keep unsupported local-only operations failing closed, and merge hosted statuses into the existing status/activity streams. Wire the gateway into `KiloBackendAppService`.
4. **Frontend identity + service.** Add `SessionRef.Hosted(providerID, workspaceID, sessionID)` keyed `hosted:<provider>:<workspace>:<session>`; add `KiloHostedService` for repository-scoped workspace discovery, multi-level pagination/dedupe, passive status, system events, and refresh on open/sign-in/scope/reconnect; make `SessionController` load hosted history and subscribe using the composite id, with resnapshot recovery.
5. **Agent Manager rows + ordinary SessionUi.** Add Cloud workspace rows beside local worktrees (remote icon, section, compute/session badges, no path/PR/diff metrics) and a hosted workspace editor that lists its root sessions using the existing list/selection pattern. Selecting a session opens the ordinary `SessionUi` through `SessionHost`; a status strip shows preparation/cloud/sandbox state from the backend feed.
6. **Capability boundary.** Add host capabilities so hosted sessions keep prompt/command/native streaming/Stop/questions/permissions/diff/todo, while local Git/PR/share/fork/compact/revert/file/terminal/run/setup/worktree actions are hidden and backend-rejected. Gate discovery behind a JetBrains experimental registry key.
7. **Tests, guards, and release pin.** Add backend gateway/RPC tests with `MockCliServer` and frontend service/controller/UI tests. Run JetBrains typecheck/tests plus repository guards, add the changeset, and bump the JetBrains CLI pin to the latest release that contains #51 (never guess a version).

## Contract and data changes

- New composite hosted identity string: `hosted:<providerID>:<workspaceID>:<nativeSessionID>`; the workspace-scoped marker is `hosted:<providerID>:<workspaceID>`. Neither is a local directory, a `WorktreeDto` field, a Cloud session id, nor a generic Workspace record.
- New shared RPC surface is additive; existing local-session RPC signatures and legacy `cloud:<id>` snapshot import are unchanged.
- No Cloud, PostgreSQL, core server, generated SDK, or database migration changes: the backend consumes the already-generated `sessionHost.*`/native client.
- New `ChatEventDto.Resnapshot` is backend-synthesized only after hosted event reconnection.
- JetBrains CLI pin moves to the latest release containing #51; `kilo.cli.pinned` remains untouched for the user's local dev state.

## Text-only contract revision

The user deferred editor context and attachments to independent M1 producer/consumer follow-ups. The private planning revision must merge and the active claim must acknowledge its updated acceptance contract before the following product edits:

1. Skip editor context gathering and automatic selection attachments for hosted prompts. Keep the ordinary local path unchanged.
2. Disable hosted file/image paste and drag/drop, reject restored file drafts explicitly, and disable local file/Git mention completion and materialization. Typed mention-like text receives a clear unsupported notice rather than a silent attachment omission.
3. Restrict hosted model choices to Kilo, clear/hide reasoning variants, and ensure hosted prompt DTOs contain no editorContext, variant, or noReply. Fail closed in the backend before attachment/network traffic if unsupported fields or parts arrive.
4. Decode canonical object-valued preparation, cloudStatus, and sandbox payloads without JsonPrimitive coercion; keep composite session identity and expose decoded preparation/cloud/sandbox state in the hosted editor.
5. Add realistic backend prompt wire-body/rejection tests, object-valued status parser tests, EDT hosted selection/completion/attachment tests, and local-regression coverage. Run JetBrains typecheck and both full test suites. Preserve local unpin and omit this scratch plan from commits.

## Failure and security cases

### Hosted stream recovery revision

The user requested implementing the investigated JetBrains-only recovery and live status gaps. Cloud terminal projection and authoritative snapshot corrections remain separate Cloud work; no Cloud code changes are included here.

1. Retain healthy opaque local attachment leases instead of replacing them on provider descriptor expiry. Core renews the short provider descriptor on routed traffic. Recreate unknown/disposed/expired local leases from a surviving manager-owned session scope, swap before retiring old streams, and propagate cancellation correctly.
2. Handle native snapshot/fence and explicit resnapshot controls before the generic chat parser. Cloud reconnect uses full snapshots, not Last-Event-ID replay. Refresh native session status after continuity loss and reconcile history with a serialized/coalesced live-event barrier; preserve composite identity and no duplicate text/terminal telemetry.
3. Own durable system-feed observation and workspace-keyed live compute/preparation state in the frontend service. Apply only newer observations, preserve billing/wake metadata, display preparation in retained editor chrome, and refresh Agent Manager workspace badges and hosted session activity live. Turn idle is not compute sleep.
4. Add real hosted SSE renewal/disconnect/control-frame tests, frontend snapshot/live ordering and hidden tab recovery tests, status transition/isolation tests, and UI containment/activity tests. Run full JetBrains typecheck/tests without overwriting the user's running sandbox. Do not claim Cloud fallback semantics are fixed locally.

### Preparation presentation revision

Preserve the actual preparation timestamp, attempt/revision and progress detail from Cloud's system feed, independently from sandbox observation clocks. Render active preparation through the existing retained transcript progress footer, not only editor chrome. Prefer progress detail such as clone percentages over generic step labels; clear it on terminal preparation/lifecycle state. Update Cloud workspace rows to one right-aligned title-line status badge without cost or repeated status in the description: sleeping uses the shared neutral style and running presents as Active with the shared green activity style. Add payload, stale-replay, inline retained-progress, and row-layout/style tests; do not rewrite the running sandbox plugin.

### Failure and interaction closure revision

Retain a sanitized preparation failure code as distinct DTO data, render a persistent localized error independently of native turn state, and clear it only on newer attempt/lifecycle evidence. Explicitly fold pre-fence pending interaction asks/resolutions and authoritative status into snapshot replacement; queries are supplemental and revision-guarded. Parse concrete public Cloud message terminal events into message-correlated, idempotent state without promoting message completion to session idle or requesting execution. Preserve safe-error privacy, tenant/composite identity, live-tail order and local behavior. Add real parser, snapshot empty-interaction/correction, duplicate terminal/newer turn and retained error UI regressions. No Cloud contract invented, no Cloud code changed; deployment validation remains separate.

- Attachments expire (60 s provider window, 10 min local lease): renew on traffic and re-attach on 404/410; never fall back to a local session.
- Auth/scope: provider signed-out/unavailable is surfaced as a discovery state, not an empty success; optional organization id is passed only from the app's current scope; no token, origin, or provider URL crosses to the frontend.
- Stale routes: deleted session/workspace or revoked membership disables rows/actions and emits a resnapshot/availability state; attachments are disposed with the workspace or on provider `not_found`.
- Event isolation: composite ids are retained in event envelopes, activity/status maps, pending questions/permissions, and controller filters; bare native ids are never used as global keys on the frontend.
- Capability containment: hosted sessions reject local Git/gh/path/terminal/run/setup/file/fork/compact/revert routes at the backend and hide them in `SessionUi`.
- No compute wake: discovery/status/history use catalog/status/detail and stored transcript reads only; only an explicit prompt/command/abort/answer reaches native live routes.
- Closing/detaching an editor only disposes local state and attachment; it never aborts or deletes Cloud work.

## Verification

- `cd packages/kilo-jetbrains && ./gradlew typecheck`: compiles shared DTOs/RPC, backend gateway, and frontend integration.
- `cd packages/kilo-jetbrains && ./gradlew test`: backend gateway/RPC plus frontend service/controller/UI tests.
- `bun test test/kilocode/server/session-host-httpapi.test.ts test/kilocode/server/hosted-routing.test.ts` in `packages/opencode/`: proves the consumed local Session Host contract still behaves.
- `bun run script/check-opencode-annotations.ts --worktree` and `bun run script/check-kilocode-change` (from `packages/kilo-vscode/`): repository guards; expected to pass because no shared upstream file changes.
- Behavioral: open Agent Manager with the gate enabled → authorized workspaces appear without Add; open a sleeping session → history renders; prompt streams native text/tools/status; Stop aborts only that turn; answer question/permission; two workspaces with colliding native ids remain isolated; close the editor and reopen → Cloud work continues and transcript resumes; sign out/delete another client → stale rows/actions disable.
- `runIdeSplitMode` smoke: staged discovery + existing-session interaction against the local CLI.

## Risks

- The native allowlist does not expose Cloud provider/agent catalogs, so the model/agent pickers continue to use the local project workspace state; hosted capabilities and unsupported routes must be explicit rather than pretending parity.
- JetBrains Agent Manager currently renders sessions inside a worktree editor tab, not as a tree; the hosted workspace editor reuses that selection pattern rather than inventing a new renderer.
- Attachment identity is process-local and dies with the CLI server; reconnect re-attaches and re-snapshots.
- The registry gate is registered and defaults on as requested by the user. Core > Refresh Cloud reloads hosted workspace/session lists and legacy Cloud History without restarting Core; Git remote resolution runs off the EDT.
- The pin bump must target a published release containing #51; do not hand-edit a guessed version.

## Out of scope

- I2B: add/create/remove/re-add workspace, new-session creation, persisted Close/Reopen, destructive workspace deletion, workspace picker.
- Session delete, manual workspace Stop/Resume, remote files/terminal, workspace rename, profile editing, fork/compact/revert/shell, subagent hosted write actions.
- VS Code implementation, M2 movement/checkpoint/environment work, direct Cloud transport or credentials.
