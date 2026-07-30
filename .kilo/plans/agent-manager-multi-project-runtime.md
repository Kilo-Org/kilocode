# Agent Manager multi-project runtime

> UI architecture update: the active-body plus background-summary model in this document is superseded by `agent-manager-multi-project-uniform-ui.md`. The runtime findings remain useful, but the final UI renders one permanent real interactive body for every expanded project and requires strict project-qualified routing before background actions are enabled.

**Status:** Runtime foundation implemented (this worktree); accordion UI pending

## Implementation status (2026-07-20)

Landed in this worktree, all covered by unit tests (`tests/unit/agent-project-*.test.ts`):

- `src/agent-manager/project-paths.ts` — canonical root resolution (`realpath` + `normalizePath`), case-aware `samePath`, deterministic `projectIdFor(root)` (sha1, stable across restarts), `resolveGitRoot`.
- `src/agent-manager/project-registry.ts` — versioned global catalog of **additional** projects (storage-injected, corrupt-safe, dedupe by id, trust/label/order). The pinned workspace project is never persisted.
- `src/agent-manager/project-context.ts` — immutable `ProjectContext` (owns WorktreeStateManager/WorktreeManager/SetupScriptService/stale set per canonical root, lazy creation, peek accessors) and `ProjectContexts` coordinator (pinned derivation, active/expanded lifecycle, trust+flag gating, `syncPinned()` for workspace changes, webview `ProjectSnapshot`s).
- `src/agent-manager/project-messages.ts` — vscode-free handlers: `requestProjects`, `addProject` (folder picker → git root resolve → dedupe), `removeProject`, `selectProject`, `setProjectExpanded`, `trustProject`. All fail closed when the flag is off.
- `src/agent-manager/project-wiring.ts` — factory assembling registry/contexts/deps/host listeners (extracted to keep `AgentManagerProvider.ts` under its 2000-line cap).
- `AgentManagerProvider` — fields `state/worktrees/setupScript/staleWorktreeIds` replaced by context-backed getters; every existing handler now operates on the active project with zero per-handler changes. `onMessage` consumes project messages first and drops messages whose `projectId` mismatches the active project (stale-pane protection). `activateProject` re-runs `initializeState` for the new context; pollers/importer/run/terminal follow the active context through the existing getters. `agentManager.state` now carries `projectId`.
- Protocol — `agentManager.projects` out-message (`multiProject` flag + `ProjectSnapshot[]`); new in-messages listed above; `projectId?` on `agentManager.state` and `createWorktree`. Webview type mirrors updated (`webview-ui/src/types/messages/{extension,webview}-messages.ts`).
- Host — `pickFolder`, `multiProject`, `readProjects`/`writeProjects` (globalState key `agentManager.projects`), `onDidChangeWorkspaceFolders`, `onDidChangeMultiProject`.
- Setting — `kilo-code.new.agentManager.multiProject` (boolean, default false, application scope).
- Changeset — `.changeset/agent-manager-multi-project.md`.

Behavior with flag off: only the pinned workspace project exists; snapshots contain exactly one project; all registry data is preserved but hidden; no UI change.

## Remaining for the UI session (accordion)

- Project accordion rendering from `agentManager.projects`: header-only rows for collapsed/uninitialized projects (registry metadata only), full existing Local/worktree body for the active project, expanded non-active bodies from per-context state (extension must push per-context state with that context's `projectId` — currently `pushState` only pushes the active context).
- Add-project entry point, trust CTA (sends `agentManager.trustProject` then expand/select), remove/rename in project menu.
- `selectProject` before any repo action in a non-active project; send `projectId` on `createWorktree` (extension drops mismatches).
- New Worktree dialog project selector (defaults to active project).
- Extension follow-ups: hidden-cadence polling for expanded projects; session-owner index so Local sessions of project B open/share correctly even while A is active (currently Local sessions resolve through the active root — acceptable only while the UI activates before opening).
- Implemented: per-context `pushState` for expanded non-active projects; per-project git stats/PR pollers (`ProjectPollers` in `project-pollers.ts`) so every expanded accordion receives live stats/PR data tagged with its projectId; webview `project-live.ts` store routing per-project payloads into per-project summary stores; `activate()` keeps the previously active project expanded.
- Known boundary: `KiloProvider.projectID` and session refresh remain single-project; cross-project SSE filtering by session→directory owner is a follow-up (see "Verified findings" below).

## Objective (original)

Build the project-aware Agent Manager runtime before changing the UI. The eventual UI is a pinned current-project view plus lazily initialized additional project accordions, with one shared tab/detail area. The first backend slice must be mergeable with the flag disabled and must route today's single project through the same project-aware contracts that secondary projects will use.

The implementation must preserve these invariants:

- The first project is always the canonical Git root of the first VS Code workspace folder in the current window. It is derived at runtime, is always first, and cannot be removed or replaced by persisted state.
- Global extension storage contains only the catalog of additional projects and project-list UI metadata. Each repository remains authoritative for its own `.kilo/agent-manager.json`.
- A collapsed, never-opened additional project causes no `.kilo/agent-manager.json` read, Git mutation, setup/run initialization, terminal creation, or poller subscription.
- Every session/worktree/draft operation has a project identity internally. Once secondary-project activation is enabled and more than one project is exposed, missing or mismatched identity is rejected rather than routed to the current workspace.
- The feature flag gates catalog exposure, secondary activation, and multi-project wire/UI behavior. It does not select a separate legacy implementation.

## Verified findings

- `AgentManagerProvider` currently owns the panel and all repository-bound resources in one 1,941-line singleton. Its root is always `Host.workspacePath()` and its state/managers are lazily cached against that root (`packages/kilo-vscode/src/agent-manager/AgentManagerProvider.ts:56-212`, `1654-1695`). The architecture test caps this file at 2,000 lines and explicitly forbids raising the cap (`packages/kilo-vscode/tests/unit/agent-manager-arch.test.ts:793-854`).
- Opening the panel immediately initializes the current repository, performs `ensureGitExclude`, loads `.kilo/agent-manager.json`, discovers/restores worktrees, registers sessions, starts state-dependent behavior, and recovers prompts (`AgentManagerProvider.ts:267-360`). This whole sequence cannot run for a collapsed catalog entry.
- `WorktreeStateManager` is correctly repository-scoped by constructor root and writes only `<root>/.kilo/agent-manager.json` (`WorktreeStateManager.ts:100-124`, `632-656`, `797-847`). Its save queue and `flush()` are suitable for a context shutdown barrier, but it has no cancellation/dispose primitive (`755-795`).
- The embedded Agent Manager `KiloProvider` is one provider attached to the one panel/webview (`agent-manager/vscode-host.ts:67-169`). It already routes many SDK calls through a session-to-directory map, but local sessions are allowed to fall back to `workspaceFolders[0]` (`KiloProvider.ts:4343-4378`; `kilo-provider-utils.ts:319-345`). That fallback becomes a cross-project write risk.
- `KiloProvider` has singleton project state (`projectID`, `currentSession`, project-scoped caches, one active project directory) and current session refresh treats all extra directories as worktrees of one canonical project (`KiloProvider.ts:344-359`, `1984-2029`; `kilo-provider-utils.ts:230-295`). It is not multi-project-correct without refactoring.
- The shared backend and generated SDK support an explicit `directory` on session share and unshare (`packages/sdk/js/src/v2/gen/sdk.gen.ts:4733-4795`). Sharing must therefore use the same project/session route as prompts and transcript reads.
- Backend session IDs are high-entropy process-global IDs (`packages/opencode/src/id/id.ts:1-17`, `23-33`, `42-49`). Raw IDs can remain the SDK/server identifier, but the UI/runtime identity still needs a project-qualified reference, and route registration must reject an observed cross-project collision.
- `session.status` currently discards the SSE directory before invoking branch naming (`AgentManagerProvider.ts:204-220`). The orchestration bridge subscribes globally and rejects requests outside its root (`orchestration-bridge.ts:175-203`). Creating one unchanged bridge per project would let the wrong bridge reject a valid request before the correct project handles it.
- Multiple `SessionTerminalManager` instances would each register the same global VS Code commands and terminal listeners (`SessionTerminalManager.ts:35-81`). It must remain panel/coordinator-owned, with project-qualified keys and explicit CWDs. Also, `TerminalRouter` currently falls back from an unknown worktree ID to the repository root (`terminal-routing.ts:120-130`), which must be removed in strict routing.
- `VscodeHost.workspacePath()` uses `workspaceFolders[0]` (`vscode-host.ts:172-174`; `review-utils.ts:12-15`). It loses URI scheme/authority, and `openFolder` recreates paths with `Uri.file`. A catalog containing only path strings would be unsafe across local, SSH, container, and other remote extension hosts.
- Existing Kilo experimental config is CLI/project config, not an application feature-flag service (`features.ts`; `webview-ui/src/types/messages/config.ts`). A multi-project bootstrap flag cannot be project-scoped because choosing which project config to read is the behavior being gated.

## Architecture decisions

### 1. Project identity and registry semantics

Add a VS Code-free `ProjectRegistry` backed by an injected storage and resolver interface. `vscode-host.ts` implements those interfaces using `ExtensionContext.globalState`, workspace/open-dialog URIs, filesystem canonicalization, and Git.

Use these core types in `src/agent-manager/project.ts`:

```ts
type ProjectId = string

interface ProjectLocation {
  uri: string
  scheme: string
  authority: string
  root: string
  commonGitDir: string
}

interface ProjectDescriptor extends ProjectLocation {
  id: ProjectId
  name: string
  pinned: boolean
  collapsed: boolean
  order: number
  status: "unverified" | "ready" | "missing" | "notGit" | "wrongAuthority"
}
```

`root` is the canonical filesystem Git toplevel. Resolve it only when deriving the pinned project, adding a project, or expanding an unverified project:

1. Start from the selected workspace/folder URI.
2. Reject a URI whose scheme/authority is not the current extension-host scope.
3. Run `git -C <fsPath> rev-parse --show-toplevel` through the existing hidden-window process wrapper.
4. Resolve the result with `fs.promises.realpath`; normalize separators, trailing separators, and Windows case for identity comparison.
5. Resolve and canonicalize `git rev-parse --path-format=absolute --git-common-dir` as `commonGitDir`.
6. Derive `ProjectId` deterministically as a versioned SHA-256/base64url hash of `scheme + NUL + authority + NUL + normalized canonical root`. Do not expose a path-concatenated ID on the wire.

Different linked worktree roots have different project IDs, but the first iteration must reject adding a project whose canonical `commonGitDir` matches any project already exposed in the window. Two Agent Manager contexts mutating the same Git common directory would bypass the current root-keyed worktree lock and could manage the same branches twice. This is a product-valid restriction to distinct Git projects, not a path workaround. Also change `WorktreeManager`'s write-lock key to canonical `commonGitDir` so future relaxation does not reintroduce `index.lock` races.

Persist one unsynced global-state value under `kilo.agentManager.projects.v1`:

```ts
interface StoredProjectCatalogV1 {
  version: 1
  projects: Array<{
    id: ProjectId
    uri: string
    scheme: string
    authority: string
    root: string
    commonGitDir: string
    name?: string
    collapsed: boolean
    order: number
    addedAt: string
  }>
}
```

Do not call `setKeysForSync`; machine/remote paths must not sync to other machines. Serialize mutations in-process. Each mutation re-reads the latest value, validates it, applies add/remove/reorder/metadata changes, and performs one `globalState.update`.

Registry behavior is exact:

- `snapshot(flag)` derives the pinned current project fresh. It never reads a persisted active project.
- The pinned descriptor is first, has `pinned: true`, and defaults to expanded. It is not written into the catalog.
- Persisted entries matching the pinned project ID are suppressed, not deleted. They reappear as additional projects when another window has a different pinned project.
- Additional entries are filtered to the current URI scheme/authority before exposure. Entries for other authorities remain untouched in storage.
- Reading the catalog does not stat, realpath, run Git, or open per-repository state. Persisted additional entries start as `unverified`.
- Adding validates/canonicalizes the chosen folder, rejects the pinned project, duplicate IDs, duplicate common Git directories, and authority mismatches, then persists it. A newly added project may be marked expanded and explicitly activated by the caller; listing alone never initializes it.
- A missing or no-longer-Git root is marked unavailable only when expansion validates it. Keep the entry and its metadata. Do not prune it automatically and do not create a `ProjectContext`.
- Removing is allowed only for non-pinned projects. It removes only the catalog entry after the context is idle/disposed; it never deletes `.kilo`, worktrees, sessions, branches, or shares.
- On every extension/panel restart, the active selection is the pinned project's Local context. Persisted additional projects and collapse/order/name metadata survive, but a stale secondary active session does not override the current VS Code window.

For a multi-root VS Code workspace, preserve current behavior by deriving the pinned project from `workspaceFolders[0]`, then canonicalize that folder to its Git toplevel. Do not silently select another workspace folder if the first is not a Git repository.

### 2. Coordinator and immutable lazy ProjectContext

Turn `AgentManagerProvider` into the panel-level coordinator and extract repository behavior into `project-context.ts`. Do not instantiate one current `AgentManagerProvider` per project.

The coordinator owns:

- the one panel and embedded `KiloProvider`/`SessionProvider`;
- `ProjectRegistry`, active `ProjectId`, exposed descriptors, and `Map<ProjectId, LazyProjectContext>`;
- a shared `Semaphore(3)` for Git/network polling across all projects;
- the one project/session router;
- one project-aware `AgentManagerVisiblePresence`;
- one `SessionTerminalManager` and one project-aware `TerminalRouter`;
- one global orchestration ingress and the global SSE/tool/status subscriptions;
- project and activation generations used to discard stale async results.

Each `ProjectContext` is constructed once with an immutable descriptor/root/common Git directory and owns only repository-bound resources:

- `WorktreeStateManager`, `WorktreeManager`, `SetupScriptService`, and repository `GitOps`;
- local diff functions, `WorktreeDiffController`, `WorktreeImporter`, and `RunController`;
- `GitStatsPoller`, `PRStatusBridge`/poller, and `BranchNamingController`;
- per-project cached state/stats/stale IDs, managed/open session refs, and initialization promise;
- project-specific message handlers currently embedded in `AgentManagerProvider`.

It does not own a webview, `KiloProvider`, VS Code terminal command registrations, global connection subscriptions, or a global orchestration subscription.

Lifecycle:

1. `cold`: descriptor only. No state manager, manager, poller, watcher, or per-repo read exists.
2. `initializing`: one shared promise validates the location, constructs resources, performs the existing `ensureGitExclude -> state.load -> recoverWorktrees -> register routes` sequence, and captures a context generation.
3. `ready/expanded`: posts project-stamped state and permits project actions. Pollers run only when both the panel is visible and this project is expanded. Multiple expanded contexts may be ready concurrently.
4. `suspended/collapsed`: if active, the coordinator first activates pinned Local (or another explicit target). Stop stats/PR/diff polling and watchers, stop accepting new project mutations, wait for the current mutation barrier, flush state, and detach project-specific event side effects such as automatic branch naming. Keep validated session routes/tracking so a running backend session can still surface status and permission/question events without a repository read. Do not abort agents merely because an accordion collapsed.
5. `disposed`: increment generation first, stop/dispose resources, await terminal-router/run/mutation cleanup and state flush, detach routes, then remove the exact context object from the map. Late completions may neither post nor mutate a replacement context.

Expansion of a suspended context resumes its existing in-memory state and pollers; expansion of a cold context initializes. Concurrent expansions share the same promise. Collapse during initialization records the desired collapsed state, allows non-cancellable Git/state work to finish, suppresses stale posts, then immediately suspends.

The coordinator routes global events by canonical event directory before invoking a context. `session.status` must retain its directory. A single orchestration ingress determines the one owning context and delegates there; it rejects an unknown directory once, globally. It must never create one rejecting bridge per project. A collapsed project does not auto-initialize in response to an unsolicited orchestration event; return a typed `project_inactive` result.

Panel close keeps existing semantics for sessions actually opened/created by that panel, but aggregates their project-qualified routes before aborting. Project collapse and flag-off transitions do not abort them. Removing a project is refused while one of its tracked sessions or Agent Manager run/mutation is busy, rather than orphaning an interaction prompt.

### 3. One embedded KiloProvider, made project-aware

Use one embedded `KiloProvider`. Multiple providers are not safe or useful here:

- there is one webview and one message handler;
- each provider would own conflicting current-session/cached UI state and duplicate SSE handling;
- multiple terminal/visibility registrations would be ambiguous;
- it would not solve session identity at the shared webview boundary.

Refactor its Agent Manager adapter around an injected project/session route service while leaving sidebar and standalone providers unchanged. The route service supplies:

```ts
interface ProjectSessionRef {
  projectId: ProjectId
  sessionId: string
}

interface SessionRoute extends ProjectSessionRef {
  directory: string
  generation: number
}
```

Internally key UI maps by `projectId + NUL + sessionId`; never use that concatenation on the wire. Keep the raw `sessionId` for SDK calls and backend presence. Maintain a reverse raw-ID index only to process backend events. If the same raw ID is observed in two projects, mark it ambiguous and reject/drop operations and events that cannot also be disambiguated by event directory.

Required routing changes:

- Register an explicit route for every Agent Manager session, including Local sessions at a project root. Do not omit a map entry merely because it equals the first workspace root.
- New/draft operations resolve from the outer project envelope and an explicit Local/worktree context. Unknown worktree IDs are errors; remove `TerminalRouter`'s fallback to root.
- Existing session operations resolve only from `ProjectSessionRef`. In strict multi-project mode, an unknown session never falls back to `workspaceFolders[0]` or the currently active project.
- Child/subagent sessions inherit the parent's project and directory. A directory-bearing event must also pass the owning-context check before registration.
- Session list refresh runs per project root plus that project's worktree directories. It emits sessions stamped with that project; it does not infer one canonical `projectID` from the first root and merge all projects into it.
- Replace singleton Agent Manager use of `KiloProvider.projectID` with the route table/directory ownership check. Keep existing project filtering for non-Agent-Manager provider instances.
- On active-project/session change, call one `activateProject(projectId, root)` path. It updates `projectDirectory`, invalidates/refetches project-scoped config, providers, agents, commands, skills, MCP, indexing, sandbox, and Git status for that root. Guard every async refresh with activation generation so project A cannot populate caches after switching to B.
- Every session create, continuation, prompt, permission/question response, terminal operation, diff operation, file/context operation, and share/unshare SDK call receives the resolved explicit directory.

This picks up each secondary project's config naturally through the CLI's directory-scoped instance/config resolution. Do not copy provider/config/settings data into global storage.

### 4. Project-qualified protocol and share semantics

Define an internal/wire envelope in `agent-manager/types.ts` and mirror it in `webview-ui/src/types/messages/agent-manager.ts`:

```ts
interface ProjectStamp {
  projectId: ProjectId
  generation: number
}

interface ProjectEnvelope<T> {
  type: "agentManager.projectMessage"
  project: ProjectStamp
  payload: T
}
```

Use project-qualified references for sessions, worktrees, and drafts:

```ts
interface SessionRef { projectId: ProjectId; sessionId: string }
interface WorktreeRef { projectId: ProjectId; worktreeId: string }
interface DraftRef { projectId: ProjectId; draftId: string }
```

Raw IDs remain in each repository's existing state file. The repository/context supplies the project identity when state is loaded. Do not migrate session IDs into global state and do not permit moving an existing session record between projects. A future cross-project continuation must explicitly fork/create in the target project; relabeling a raw session is invalid.

Protocol rules:

- The coordinator is the only component that unwraps inbound envelopes and wraps context output.
- Global catalog/route errors are global messages. Repository state, stats, session metadata, diff, run, PR, terminal, and chat messages are project envelopes.
- Preserve `requestId` inside the payload. Return a typed route error (`project_required`, `project_unknown`, `project_inactive`, `project_mismatch`, `session_unknown`, or `session_ambiguous`) without forwarding the original message.
- Validate the envelope project against the context, persisted session/worktree ownership, session route, and event/request directory. A valid raw ID in the wrong envelope is still rejected.
- Outbound generation lets the webview/coordinator discard messages from a collapsed/disposed/replaced context.
- While the flag is off, or while only the pinned project is exposed, a compatibility adapter wraps today's unqualified webview messages with the pinned project and unwraps pinned output to the existing shape. The core handlers still receive envelopes.
- Once the flag is on and a second project is exposed, unqualified project/session/worktree messages fail closed. The multi-project UI must send/consume envelopes and use composite refs as tab/store keys.

Sharing is an operation on `SessionRef`, not on a bare session ID:

- Manual share calls `client.session.share({ sessionID, directory })`; unshare uses the exact same resolved route.
- Automatic sharing remains a project config behavior because session creation is sent with the target project's directory.
- Store no share URL or share state in the project catalog. Session list/get/update data remains authoritative and is enriched with `projectId` on output.
- Removing/collapsing a project never unshares its sessions. A share URL is externally usable, but reopening or mutating the local session still requires its local project route.
- A mismatched or missing project cannot share/unshare, even if the raw session ID happens to resolve elsewhere.

### 5. Feature flag, restart, and migration behavior

Contribute an application-scoped VS Code setting, default false, for example `kilo-code.new.agentManager.multiProject`, with `scope: "application"`. Read it in the host/coordinator; do not put it in CLI `experimental` config.

- Flag off: derive and initialize only pinned current project, use the compatibility wire adapter, and preserve the exact current view. Read but do not expose, validate, initialize, rewrite, or delete additional catalog entries.
- Flag on: publish lightweight descriptors. Only explicit expansion initializes an additional project. Selecting Local/worktree also expands and initializes its owner before activation.
- Runtime on -> off: increment activation generation, activate pinned Local, suspend all secondary contexts, switch to compatibility protocol, and preserve catalog/per-repo state. Do not abort backend sessions.
- Runtime off -> on: expose stored descriptors as cold/unverified. Do not eagerly restore a persisted secondary active project.

No `.kilo/agent-manager.json` schema migration is needed. Existing state is loaded unchanged by the pinned context, and additional contexts load their own existing files only when expanded. An absent catalog means no additional projects. Invalid catalog entries are ignored in the snapshot and logged, but a successful write must preserve valid entries from other authorities. Never scan the filesystem to discover projects as migration.

On restored legacy panel/webview state, unqualified tabs are accepted only in compatibility single-project mode. When multi-project mode exposes a second project, send a protocol reset and rebuild tabs/session lists from project envelopes instead of guessing which project owns a restored raw session ID.

Remote behavior:

- Scope catalog exposure and identity by full URI scheme + authority, not `vscode.env.remoteName` alone.
- Run Git and filesystem operations in the current extension host against `fsPath`; preserve the original URI for `openFolder` and picker operations.
- Reject selection from another authority. Keep such stored entries for their matching window/host.
- Unsupported virtual filesystems, missing roots, permission failures, and non-Git directories become unavailable descriptors after explicit validation. They do not fall back to the pinned root.

## Ordered implementation plan

### Slice A: mergeable routing foundation before multi-project UI

This is the narrow first PR. It produces no secondary-project UI, but the current pinned project runs through the durable identity/routing contracts and the registry is fully tested.

1. Add `src/agent-manager/project.ts` with IDs, locations, descriptors, stamps, envelopes, and ref types. Add `src/agent-manager/project-registry.ts` with injected storage/resolver, v1 schema validation, pinned merge, authority filtering, dedupe, and serialized mutations.
2. Extend `Host` in `src/agent-manager/host.ts`; implement global-state storage, canonical Git/URI resolution, pinned project resolution, and the application flag in `src/agent-manager/vscode-host.ts`. Preserve URIs in `openFolder`. Add the setting contribution in `packages/kilo-vscode/package.json`.
3. Add `src/agent-manager/project-session-router.ts`. It must register Local and worktree routes, resolve refs/directories, inherit child routes, validate directory ownership, detect raw-ID ambiguity, and implement compatibility versus strict mode.
4. Add envelope/route errors to `src/agent-manager/types.ts` and the mirrored webview type file. Add a coordinator adapter in `AgentManagerProvider` that derives the pinned project at panel attach, wraps all legacy inbound messages, stamps context output, and switches strictness based on exposed-project count. In this slice only the pinned context is activated, so rendered behavior remains unchanged.
5. Extend the `SessionProvider` adapter (`host.ts`, `vscode-host.ts`) with project-aware `setSessionRoute`, `trackSession`, `getSessionInfo`, `loadMessages`, `share`, and `unshare` methods. Retain temporary legacy methods only as single-project adapters, not as a second implementation.
6. Modify `KiloProvider`, `kilo-provider/options.ts`, and the extracted helpers in `kilo-provider-utils.ts` so Agent Manager Local sessions also have explicit routes, unknown strict routes fail closed, child routes inherit project identity, and project activation invalidates project-scoped cache work by generation. Keep non-Agent-Manager provider behavior unchanged.
7. Update `extension.ts` auto-approve/session-directory lookup to ask the router/coordinator for the active or unique `SessionRef`; do not merge raw ID maps and choose the first match.
8. Remove unknown-worktree-to-root fallback in `terminal-routing.ts`, and inject the pinned project root into `createTerminalHost` instead of reading `workspaceFolders[0]` internally.

Slice A is complete when the flag-disabled Agent Manager is visually and behaviorally unchanged, every current project session has an explicit project route, and unit tests prove a second registered route cannot be accidentally handled through pinned-root fallback. Do not expose Add Project until Slice B is complete.

### Slice B: lazy multi-context runtime, still before UI rendering

1. Add `src/agent-manager/project-context.ts` and move root-bound state/managers/handlers out of `AgentManagerProvider`. Keep context code VS Code-free. Reduce the provider cap to the new rounded-up line count instead of raising it.
2. Make `AgentManagerProvider` the coordinator described above. Add cold/initializing/ready/suspended/disposed state, generation guards, expansion/activation APIs, shared semaphore, and per-project message dispatch.
3. Refactor status/tool/orchestration subscriptions so the coordinator routes once by project/directory. Do not retain per-context global subscriptions that can reject each other's requests.
4. Make terminal management panel-global and key mappings by composite session/worktree refs. A context supplies only an already-validated CWD. Ensure context collapse cannot switch to another project's terminal by raw ID.
5. Refactor session refresh to accept one project at a time and emit project-stamped results. Register routes for discovered Local sessions before they can be opened. Preserve failed-directory session IDs only within the affected project.
6. Change `WorktreeManager`'s mutation lock key to canonical common Git directory and reject adding another exposed context with the same common directory.
7. Add backend catalog commands (`requestProjects`, `addProject`, `removeProject`, `expandProject`, `collapseProject`, `activateProject`) behind the flag. These are testable protocol endpoints but need not yet have visible controls.

### Slice C: first usable flagged UI

After A and B are green, implement project accordions and the project selector in the New Worktree modal. Keep the current markup/layout when only the pinned project exists. Use composite refs in webview stores/tabs, one shared tab bar/detail pane, and clearly show the project name on cross-project session tabs and share actions. This UI slice is intentionally outside the backend-first scope.

## Exact tests

Add or update these focused tests under `packages/kilo-vscode/tests/unit/`:

- `agent-manager-project-registry.test.ts`: pinned project is always first/fresh; persisted active cannot replace it; additional roots survive restart; pinned duplicate is suppressed; add canonicalizes subdirectories/symlinks; duplicate root/common Git dir and wrong authority are rejected; flag-off snapshot exposes only pinned without mutating catalog; catalog listing performs no resolver/filesystem calls; missing entries remain stored.
- `agent-manager-project-router.test.ts`: every Local/worktree session has a route; matching refs resolve; wrong project, unknown session, unknown worktree, missing project, and raw-ID collision fail closed; child inherits parent project/directory; compatibility inference works only for one exposed project; share and unshare use the same explicit directory.
- `agent-manager-project-context.test.ts`: collapsed cold projects construct/read nothing; concurrent expand initializes once; two expanded contexts use separate state roots and share the concurrency gate; collapse stops pollers and flushes; collapse during init suppresses posts; disposed-generation results cannot update a replacement context; remove is blocked while busy.
- Extend `kilo-provider-session-refresh.test.ts`: lists per project instead of merging project roots; outputs project stamps; failed worktree listing preserves only that project's sessions; activation generation drops stale config/session results.
- Extend `kilo-provider-worktree-context.test.ts`: strict unknown session/worktree has no workspace fallback; Local routes explicitly resolve to their own project root; a secondary Local session cannot resolve to pinned root.
- Extend `AgentManagerProvider.spec.ts`: single-project legacy messages are wrapped pinned; two-project unqualified messages return `project_required`; mismatched session/project returns `project_mismatch`; status/tool events dispatch by directory; restart selects pinned Local.
- Add terminal routing coverage: unknown project/worktree produces an error and no PTY/VS Code terminal; identical raw session IDs in different projects cannot select the wrong terminal.
- Extend `agent-manager-arch.test.ts`: new domain modules do not import `vscode`; lower `AgentManagerProvider.ts` maxLines after extraction.

Run from `packages/kilo-vscode/` after each slice:

```sh
bun test tests/unit/agent-manager-project-registry.test.ts tests/unit/agent-manager-project-router.test.ts tests/unit/kilo-provider-session-refresh.test.ts tests/unit/kilo-provider-worktree-context.test.ts
bun run typecheck
bun run lint
bun run test:unit
bun run knip
bun run check-kilocode-change
```

For Slice B, add the context/provider/terminal tests to the focused first command. No CLI/SDK regeneration is required because this architecture uses existing explicit-directory SDK parameters and adds only extension/webview protocol types.

## Manual validation after the UI slice

1. With the flag off and a non-empty stored catalog, restart VS Code. Agent Manager must look and behave exactly as today and use only the current window's Git root.
2. Turn the flag on, add a second repository, restart, and verify its header persists while the pinned current project remains first and active. Confirm the collapsed second project creates no output/state access/poll traffic until expanded.
3. Expand both projects, open Local and worktree sessions from each, switch rapidly, send prompts, answer permission/question requests, open terminals/diffs, and share then unshare. Verify every operation affects the displayed project's repository and config.
4. Disable the flag while a secondary project is active. Verify pinned Local becomes active, secondary state remains on disk/catalog, and re-enabling restores the descriptor without eager initialization.
5. Rename/remove a cataloged directory and restart. Verify the project remains as unavailable, cannot route actions to pinned root, and can be removed without touching its repository state.
6. Repeat in a remote window. Verify local/other-authority catalog entries are hidden but preserved and folder opening retains the remote URI authority.

## Risks and rollback

- The largest correctness risk is a hidden workspace-root fallback in `KiloProvider` or a helper. Treat every Agent Manager method that accepts `sessionID`, `worktreeId`, `draftID`, `requestID`, or directory as part of the routing audit. Tests should fail if strict mode calls `workspaceFolders[0]` for an identified operation.
- Project-scoped KiloProvider caches can show stale settings after a rapid project switch. Activation generation checks are required before posting and before replacing caches; merely cancelling transcript load is insufficient.
- Global event consumers can race. There must be exactly one ownership decision for orchestration/tool events, and directory must be retained for status/permission/question handling.
- Multiple contexts increase polling/process pressure. Share the concurrency semaphore, gate all pollers by panel visibility and expansion, and suspend on collapse/flag-off.
- Global-state updates from separate VS Code windows do not provide a transactional CAS. The first iteration should re-read before each serialized mutation and tolerate another window appearing after reload; do not build a filesystem lock or custom database for this feature.
- Rollback is safe: turn off the application flag. The pinned path and existing `.kilo/agent-manager.json` format remain intact, while the unused global catalog is preserved for a later re-enable.
