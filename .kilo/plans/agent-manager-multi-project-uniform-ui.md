# Agent Manager multi-project uniform UI architecture

**Status:** Ready, corrected architecture; implementation pending

**Date:** 2026-07-22

This plan supersedes the active-body plus background-summary UI described in `agent-manager-multi-project-runtime.md`. The existing project registry, immutable project-root concept, per-project state payloads, and project-tagged stats work are useful foundations. The current read-only `ProjectSummary` and active-project dynamic getter routing are not the target architecture.

Configuration reads, writes, scopes, drafts, trust, revisions, and release-blocking tests are specified canonically in [`agent-manager-multi-project-configuration.md`](./agent-manager-multi-project-configuration.md). If this plan and that document differ on configuration behavior, the configuration document wins.

The step-by-step implementation sequence from the current branch is [`agent-manager-multi-project-implementation-handoff.md`](./agent-manager-multi-project-implementation-handoff.md). Implementers should follow that handoff slice by slice rather than treating this architecture document as an unordered task list.

## Product requirement

Every expanded project permanently renders the real existing Agent Manager sidebar UI:

- the real Local card;
- the real worktree cards, including their current menus and actions;
- the real session list, which may initially use a simplified layout but must contain real live session data;
- live git stats, PR state, run/setup state, stale state, and session state owned by that project.

Selecting or interacting with a project may change the shared detail pane and top toolbar. It must not remove, replace, downgrade, or remount any expanded project body. There is no active-body versus background-summary rendering mode.

The shared detail pane remains singular. The sidebar displays all expanded projects concurrently; the detail pane displays one selected project/local/worktree/session target at a time.

## Architecture verdict on the current worktree

The current implementation is a valid partial runtime foundation, but it is not safe to extend directly into fully interactive background cards.

Keep and evolve:

- `ProjectRegistry` and the pinned-workspace project concept;
- immutable root ownership in `ProjectContext`;
- `initContextState` extraction;
- project-stamped state/stats/PR messages;
- per-project webview stores;
- reusable `WorktreeItem`, `SectionHeader`, `WorktreeSectionActions`, and `UnassignedSessionsSection` components;
- the application-scoped feature flag.

Replace or refactor before exposing interactive multi-project UI:

- delete `ProjectSummary`; do not add more behavior to it;
- remove the rule that only `project.active` renders `renderBody()`;
- stop routing normal actions through `contexts.active()` and optional `projectId`;
- replace raw session/worktree/local UI keys with project-qualified references;
- replace the active singleton poller plus background poller split with uniform context-owned polling;
- make context initialization, mutation, suspension, and disposal explicit and generation-guarded;
- make the one embedded `KiloProvider` project/session-route aware.
- separate activation-bound runtime config from the Settings editor's immutable read/write binding.

## Core model

### Project identity

A project is one canonical Git repository root in the current extension host.

```ts
type ProjectId = string

interface ProjectRef {
  projectId: ProjectId
}

interface WorktreeRef extends ProjectRef {
  worktreeId: string
}

interface SessionRef extends ProjectRef {
  sessionId: string
}

type SidebarTarget =
  | { projectId: ProjectId; kind: "local" }
  | { projectId: ProjectId; kind: "worktree"; worktreeId: string }
  | { projectId: ProjectId; kind: "session"; sessionId: string }
```

Raw backend and repository-local IDs remain unchanged. Composite references are required at every panel/runtime boundary so identical local sentinels, worktree IDs, section IDs, or session IDs cannot cross projects.

Project identity must include the extension-host URI scheme and authority in addition to the canonical root. Adding a project must also resolve canonical `git-common-dir` and reject another exposed project sharing that common Git directory. Linked worktrees of one repository cannot be registered as independent projects in the first release.

### Active project means detail selection only

`activeProjectId` is not a rendering mode and not an implicit mutation target.

It means:

- which project owns the current shared detail/chat/diff/terminal pane;
- which project the global top toolbar and global New Session/Run buttons target;
- which project/worktree directory supplies runtime-effective Kilo configuration in the one embedded `KiloProvider`.

It never selects a Settings write target. Settings bindings are explicit and remain unchanged when detail selection changes.

Project expansion controls rendering. Every `project.expanded` project renders one stable `ProjectSidebarBody` keyed by `projectId`, regardless of active status.

### Atomic selection

Do not send `selectProject` followed by an unqualified worktree/session action. VS Code message handlers are asynchronous and are not a transaction queue.

Use one atomic selection intent:

```ts
interface ActivateSelectionMessage {
  type: "agentManager.activateSelection"
  target: SidebarTarget
}
```

The coordinator validates the project and target, ensures the context is ready, activates the project-specific Kilo route, then emits one project-qualified activation result. The sidebar body stays mounted; only shared detail state changes.

Mutations that do not need the detail pane, such as rename, delete, section edits, run, setup, open window, PR actions, or worktree creation, execute directly against their explicit `ProjectRef` or `WorktreeRef`. They do not activate another project as a side effect.

## Configuration architecture

See [`agent-manager-multi-project-configuration.md`](./agent-manager-multi-project-configuration.md) for the complete contract.

### Verified blocking failure

The current config protocol is unsafe for multi-project use:

- `KiloProvider.fetchAndSendConfig()` resolves a mutable current directory and emits one unqualified `configLoaded` value (`packages/kilo-vscode/src/KiloProvider.ts:2513`).
- `ConfigProvider` owns one global/project/effective draft and sends an unqualified `updateConfig` (`packages/kilo-vscode/webview-ui/src/context/config.tsx:54`, `:243`).
- `KiloProvider.handleUpdateConfig()` resolves `getWorkspaceDirectory()` again at save time (`packages/kilo-vscode/src/KiloProvider.ts:2982`). A draft loaded for project A can therefore be written to project B after detail activation changes.
- The backend derives the project target from request directory and has no target or revision precondition (`packages/opencode/src/config/config.ts:944`, `packages/opencode/src/kilocode/config/config.ts:67`). Concurrent editors can overwrite one another, and a newly created higher-priority config file can redirect a pending write.
- Hidden scope splitting currently writes `commit_message` and `indexing.enabled` to the project while most fields go global (`packages/kilo-vscode/webview-ui/src/utils/config-scope.ts:3`). The UI does not make this target choice explicit.
- Project config writes also exist outside the save bar. In particular, provider disconnect can call `saveProject()` using the mutable provider workspace directory (`packages/kilo-vscode/src/provider-actions.ts:252`). Disabling only `handleUpdateConfig()` is insufficient.

This is a release blocker, not a follow-up cleanup.

### Product decision and staged order

Preserve useful project-local editing such as `commit_message.prompt` and repository indexing rules. Indexing enablement is machine-local project consent, default off, and cannot be granted by repository config. Replace hidden active-directory targeting with explicit `User | Project` scope, a required Settings project selector for Project scope, an opaque immutable binding, and optimistic concurrency by target revision.

Do not maintain one write model for flag-off mode and another for multi-project mode. Single-project mode uses the same explicit protocol, with a narrow adapter that injects the pinned `ProjectRef` for reads and open-file actions.

### Separate runtime config from Settings editor config

The current `ConfigProvider` conflates two different state machines. Split them:

- **Runtime config** is read-only UI state for the selected detail/session route. It is keyed by `{ projectId, directory, activationGeneration }`, follows atomic detail activation, and drives chat, providers, agents, features, display, MCP, indexing, and sandbox behavior.
- **Settings editor config** is a scoped layer editor keyed by an immutable binding. It never follows detail activation and its draft is never applied optimistically to runtime config.

Use distinct messages. Names may follow repository conventions, but the fields and invariants are mandatory:

```ts
interface RuntimeConfigLoaded {
  type: "runtimeConfigLoaded"
  route: {
    projectId: ProjectId
    directory: string
    activationGeneration: number
  }
  config: Config
  features: FeatureFlags
}

type ConfigScope = "global" | "project"

interface ConfigTarget {
  scope: ConfigScope
  path: string
  revision: string
  exists: boolean
  writable: boolean
}

interface SettingsBinding {
  id: string
  connectionGeneration: number
  scope: ConfigScope
  project?: {
    projectId: ProjectId
    root: string
    generation: number
  }
  directory: string
  target: ConfigTarget
}

interface ReadSettingsConfig {
  type: "settingsConfig.read"
  requestId: string
  scope: ConfigScope
  projectId?: ProjectId
}

interface SettingsConfigSnapshot {
  type: "settingsConfig.snapshot"
  requestId: string
  binding: SettingsBinding
  preview?: {
    projectId: ProjectId
    root: string
    generation: number
    directory: string
  }
  targetConfig: Config
  effective: Config
  global: Config
  project: Config
  fields: Record<string, ResolvedConfigField>
  collections: Record<string, ResolvedConfigField[]>
}

interface WriteSettingsConfig {
  type: "settingsConfig.write"
  requestId: string
  bindingId: string
  set: Partial<Config>
  unset: string[][]
}
```

For a global read, `projectId` is optional preview context used only to explain project shadowing. It never changes the global target. A project read requires `projectId` and always resolves the immutable `ProjectContext.root`, not the active worktree or session.

For User scope, preview identity is presentation state, not part of the editable target identity. The controller keeps the global target binding and draft separate from the latest project preview. A clean preview change may replace both from one fresh snapshot. A dirty preview change updates only `preview`, effective/source metadata, and project raw data. It retains the original global target revision; if the fresh read reports a different global path or revision, mark the draft stale instead of silently rebasing it.

`targetConfig` is the parsed raw content of the one file the API will patch. It is not the aggregate `global` or `project` layer. The form edits this raw target value so it never copies values inherited from another file into the target. The aggregate values remain in the snapshot solely for source, inheritance, and effective-preview UI. Existing JSONC comments remain server-side raw text and are preserved by patching; the webview does not round-trip serialized file contents.

Parse `targetConfig` from raw JSONC without expanding `{env:}` or `{file:}` variables, so the Settings protocol never turns placeholders into secret values. If the exact target is syntactically or structurally invalid, return diagnostics and `writable: false` for form editing rather than treating it as `{}` and overwriting it. The recovery action is **Open file**. Source metadata must cover every path rendered by Settings, not only the current hand-maintained overlay field list.

The extension owns an in-memory binding registry. Binding IDs are opaque, unpredictable, and scoped to one provider/webview lifecycle. The webview returns only `bindingId`, not a client-authoritative path or project envelope. On write the extension must:

1. look up `bindingId` and reject unknown or expired bindings;
2. verify that the project still exists, has the same context generation, and remains trusted;
3. capture the stored binding before the first `await`;
4. send the stored directory and expected target to the backend without calling `getWorkspaceDirectory()`, `contexts.active()`, or any fallback;
5. route success or failure by `{ requestId, binding.id }` only.

A binding expires after a successful save, backend reconnect, trust revocation, project removal, or context generation change. Success returns a new snapshot and binding. Cached snapshots are keyed by binding/scope/project identity; there is no singleton `cachedConfigMessage` for Settings.

### Backend read/write and optimistic concurrency contract

Evolve the Kilo-owned `/config/overlay` API rather than adding project identity to generic `Config.update`. The backend does not know Agent Manager `projectId`; it enforces the routed directory and filesystem target while the extension enforces project identity.

`GET /config/overlay` continues to take explicit `directory` and `scope`, but returns:

```ts
interface ConfigOverlaySnapshot {
  context: { directory: string; worktree?: string }
  scope: ConfigScope
  targetConfig: Config
  effective: Config
  global: Config
  project: Config
  sources: ConfigSource[]
  targets: {
    global: ConfigTarget
    project: ConfigTarget
    active: ConfigTarget
  }
  fields: Record<string, ResolvedConfigField>
  collections: Record<string, ResolvedConfigField[]>
}
```

The revision is a SHA-256 fingerprint of scope, canonical target path, existence marker, and exact file bytes. It is not an mtime. Exact bytes are required so comment-only JSONC edits and delete/recreate cycles with different content cause conflicts. The missing-file revision includes the intended canonical path. An ABA delete/recreate with identical bytes may retain the same revision; that state is content-equivalent and does not lose a user edit.

`PATCH /config/overlay?directory=...` accepts exactly one scope per request:

```ts
interface ConfigOverlayWrite {
  scope: ConfigScope
  set?: Record<string, unknown>
  unset?: string[][]
  expected: {
    path: string
    revision: string
  }
}

interface ConfigOverlayWriteResult {
  outcome: "applied" | "applied_but_overridden"
  changed: boolean
  overriddenPaths: string[][]
  snapshot: ConfigOverlaySnapshot
}
```

The server performs the following transaction:

1. Resolve the authoritative target from the routed instance directory and requested scope. Never accept `expected.path` as an arbitrary destination.
2. Canonicalize and compare the resolved and expected paths. Reject a changed target, including a newly created higher-priority config file.
3. Acquire a cross-process lock keyed by canonical target path. Project writes must use the same locking discipline already used for global config.
4. Inside the lock, re-resolve the target, read exact bytes, recompute the revision, and reject a mismatch.
5. Apply `set`/`unset` to the raw target layer, preserve JSONC comments where supported, validate the result, and atomically replace the target using a temporary file in the same directory. Do not expose a partially written config.
6. Invalidate the affected config instances, reload the overlay, and return the authoritative post-write snapshot. Do not fabricate optimistic config if refresh fails.
7. Emit a config event containing `scope`, routed `directory`, canonical `target`, and new `revision`. Global changes invalidate all runtime config caches; project changes invalidate only matching directory/project caches.

`applied_but_overridden` is success. For each `set` leaf, the refreshed overlay identifies whether a higher layer still wins, such as project config shadowing a user value or managed/runtime config shadowing a project value. The UI keeps the saved value and explains why effective behavior did not change.

Do not send global and project patches in one webview message or pretend that two files save atomically. User and Project scope maintain independent drafts and save independently. VS Code extension preferences such as autocomplete settings are a third, visibly separate store with their own request acknowledgements.

Domain actions outside Settings must not perform client-side read-modify-write against a mutable effective config. Provider/custom-provider/work-style actions are User-global operations and should call either the same revision-aware User endpoint or a narrow backend mutation that merges named fields under the target lock. Permission Dock "always" rules remain a narrow global rule mutation tied to the exact pending request/session route; that session directory validates the request but does not select a project config target. All such mutations emit the revisioned config event, so a dirty Settings editor becomes stale rather than being overwritten.

Expected typed failures are:

- `unknown_project` or `stale_project_generation` from the extension;
- `untrusted_project` or `workspace_untrusted` from the extension;
- `binding_mismatch` or `binding_expired` from the extension;
- HTTP 409 `config_target_changed` with the current target descriptor;
- HTTP 409 `config_revision_conflict` with the current target descriptor and fresh snapshot when available;
- HTTP 403 `config_target_not_writable` or project target escaping its trusted root;
- HTTP 422 `config_invalid` with schema/parse details;
- an I/O failure with no success acknowledgement.

Every failure preserves the draft and names the scope/project/path. A config event is never treated as confirmation of the user's save; only a matching write response may clear that draft.

### Draft and project-switch behavior

- Detail activation from project A to B does not change the Settings selector, binding, values, draft, save state, or target.
- A User Settings draft is global and survives all detail-project switches.
- Project scope uses an explicit trusted project selector that never follows detail activation automatically.
- On first open, the selector may initialize once from the pinned/selected project for convenience, but that choice is immediately captured as Settings state.
- Choosing another Settings project with a dirty draft prompts `Save`, `Discard`, or `Stay`. Drafts are never carried to a different project.
- Clean selector changes issue a new request and ignore out-of-order responses by `requestId`.
- A save captures one binding. Switching visible settings while it is in flight does not redirect it; the result updates only the original binding store and identifies that target in its notification.
- External config events refresh a clean binding. For a dirty or saving binding they mark it stale and show a changed-on-disk banner without replacing local edits.
- A 409 preserves the draft and disables blind retry. The first version offers `Reload`, `Open file`, and `Discard`; it does not auto-merge or force overwrite. A future three-way merge may use the original snapshot, fresh snapshot, and draft.

### Scope UX

The first release presents explicit `User | Project` scope, a required selector in Project scope, source badges, and separate binding-keyed drafts. The selected scope applies to the entire operation. Remove hidden `splitConfigByScope`; no setting silently chooses a different file. Inherited user values remain visible in Project scope with `Override`/`Reset to inherited` affordances backed by `set`/`unset`.

### Project root, worktree, and trust semantics

- A Project Settings binding targets the registered checkout root held by `ProjectContext.root`. It never targets the last selected Local/worktree/session card.
- Runtime config remains directory-correct: Local uses the project root, and a worktree session uses its exact routed worktree directory. Branch-specific config in a managed worktree can therefore differ at runtime.
- Editing a project's root config does not claim to update already-created worktree checkouts. Editing a worktree config from Settings is out of scope for the first Project Settings release. A future worktree editor must use an explicit `WorktreeRef` and its own immutable binding.
- The backend resolver may choose an existing root or `.kilo`/`.kilocode` config according to current precedence, but the expected target must remain within the trusted project checkout after canonical/symlink resolution. A symlink escape is read-only and must not be patched through the API.
- For an existing target, canonicalize the file with `realpath`. For a missing target, canonicalize its nearest existing ancestor and append the remaining path components before checking containment. Global writes must similarly remain under the canonical `Global.Path.config` root. Do not rely on a lexical prefix check.
- Additional Agent Manager projects must be registry-trusted before project overlay evaluation, opening/creating project config, or project writes. Global User Settings remain editable without trusting a project.
- The pinned project is trusted for config evaluation only when the VS Code workspace is trusted. Do not treat `pinned` as an unconditional trust grant.
- Trust is stored outside the repository in the extension registry/global state. A project config file cannot grant its own trust. Revoking trust invalidates all bindings and project runtime caches.

### Concrete implementation sequence for config safety

1. In `packages/opencode/src/kilocode/config/overlay.ts`, replace path-only targets with revisioned target descriptors and add generic changed-path source resolution.
2. Add a Kilo-owned compare-and-swap writer under `packages/opencode/src/kilocode/config/` that resolves, confines, locks, fingerprints, patches, validates, and atomically replaces one target. Keep shared `packages/opencode/src/config/config.ts` changes to minimal marked delegation/invalidation hooks.
3. Update `packages/opencode/src/kilocode/server/httpapi/groups/config-console.ts` and `handlers/config-console.ts` with the write precondition, result, and typed error contracts. Regenerate `packages/sdk/js/`.
4. Extract a config binding controller under `packages/kilo-vscode/src/kilo-provider/` and have `KiloProvider.ts` delegate reads/writes to it. The controller receives explicit project-route resolution; it never reads mutable active workspace state during a bound operation.
5. Replace `configLoaded`, `configUpdated`, and unqualified `updateConfig` in `webview-ui/src/types/messages/` with runtime and Settings message families. Keep a temporary single-project adapter only at the protocol edge.
6. Split `webview-ui/src/context/config.tsx` into activation-bound runtime state and binding-keyed Settings editor state. Settings components consume the editor context; non-settings consumers continue to use runtime-effective config.
7. Remove `webview-ui/src/utils/config-scope.ts` after migrating every control to explicit scope. Preserve explicit project editing for commit messages and repository indexing rules; move indexing enablement to machine-local project consent.
8. Audit all extension config mutators and route user-config imports, resets, custom providers, work-style writes, project writes, and save-bar writes through a revision-aware endpoint or backend atomic field-level mutation. A project-sourced item must never fall back to an active directory write.
9. Make open-file actions take `ProjectRef`, resolve `ProjectContext.root`, verify trust, and show the exact path. For a missing target, open an unsaved document at that explicit path or require an explicit create action; never create it merely by visiting Settings.
10. Update config events and cache invalidation so scope/directory/revision are retained end to end.

Focused tests belong in:

- `packages/opencode/test/kilocode/server/config-overlay.test.ts` for raw target snapshots, target changes, 409 revisions, source shadowing, locks, symlink confinement, and response outcomes;
- `packages/opencode/test/kilocode/project-config-update.test.ts` for target selection and atomic writes from repository roots/nested directories;
- a new Kilo-owned backend unit test beside those files only if the compare-and-swap writer needs direct fault-injection coverage;
- `packages/kilo-vscode/tests/unit/config-utils.test.ts`, replacing singleton `ConfigState` assumptions with binding/request-aware draft tests;
- `packages/kilo-vscode/tests/unit/config-scope.test.ts`, deleted when `splitConfigByScope` is removed and replaced by tests proving one explicit scope per save;
- Agent Manager route/context tests for immutable project-root resolution, trust revocation, removal, and generation changes;
- KiloProvider protocol tests for A-to-B activation during reads and writes, out-of-order responses, cache partitioning, and auditing non-save-bar mutators.

## One `.kilo/agent-manager.json` per project

Yes, every project has its own repository-local state file:

```text
project-a/.kilo/agent-manager.json
project-b/.kilo/agent-manager.json
project-c/.kilo/agent-manager.json
```

This is already structurally supported because `WorktreeStateManager` derives its file from its immutable constructor root. The final architecture makes this ownership explicit and safe.

### Ownership rules

Each `ProjectContext` owns exactly one:

- canonical repository root and canonical Git common directory;
- `WorktreeStateManager(root)` writing only `<root>/.kilo/agent-manager.json`;
- `WorktreeManager(root)`;
- `SetupScriptService(root)` and project run service;
- diff/import/branch-naming services;
- git stats and PR pollers;
- worktree/session/section/order/run/stale caches;
- mutation queue and initialization promise.

The global project registry stores descriptors only. It never stores worktrees, sections, sessions, tab order, or repository behavior. The pinned project is derived from the current workspace and remains outside the registry.

### Initialization

The first explicit expansion of a trusted project calls one single-flight `ensureReady()` promise:

1. validate root and Git common directory;
2. construct project-owned services;
3. update that repository's local Git exclude;
4. load only that repository's `.kilo/agent-manager.json`;
5. discover and reconcile only that repository's worktrees;
6. register Local and worktree session routes for that project;
7. start context-owned polling if the project is expanded and the panel is visible;
8. post one generation-stamped project snapshot.

Repeated expansion must reuse the same initialization promise. Collapse/removal during initialization records the desired lifecycle transition and prevents late completion from posting or mutating a replacement context.

### Writes and disposal

All mutations for one project execute through that context's serialized mutation queue. An operation captures the context and generation before its first await and never re-resolves through `contexts.active()` afterward.

Collapse:

- leaves the project registered;
- stops pollers/watchers after current operations reach a safe boundary;
- flushes its own state file;
- retains session routes required for already-running backend sessions;
- never aborts a session merely because the UI collapsed.

Removal:

- never deletes `.kilo/agent-manager.json`, worktrees, branches, or sessions;
- refuses removal while a project mutation/run requires ownership, unless an explicit coordinated shutdown is implemented;
- awaits context disposal and state flush before deleting the registry descriptor;
- invalidates context generation before awaits so late callbacks are ignored.

Panel disposal awaits all initialized contexts before shared services are disposed.

Two VS Code windows writing the same repository state file remain the same pre-existing concurrency boundary as today's single-project Agent Manager. This plan prevents one panel from creating two contexts for the same Git common directory; cross-window file coordination is not expanded in this feature.

## ProjectContext lifecycle

`ProjectContext` becomes a lifecycle owner rather than only a lazy service container.

```ts
type ProjectLifecycle =
  | "cold"
  | "initializing"
  | "ready"
  | "suspended"
  | "disposing"
  | "disposed"

interface ProjectContext {
  readonly id: ProjectId
  readonly root: string
  readonly commonGitDir: string
  readonly generation: number
  ensureReady(): Promise<ReadyProjectContext>
  run<T>(operation: (ctx: ReadyProjectContext) => Promise<T>): Promise<T>
  suspend(): Promise<void>
  dispose(): Promise<void>
}
```

Every async init, poll, mutation, diff, run, import, setup, PR update, branch naming, and session operation checks context identity and generation before committing state or posting to the webview.

## Strict project-qualified protocol

When multi-project mode exposes more than one project, every repository operation requires project identity.

Required project qualification includes:

- worktree create/delete/rename/import/order/section/open/PR actions;
- Local and worktree session create/open/close/fork/promote/share/unshare actions;
- prompt, abort, permission, question, command, sandbox, and context actions;
- terminal create/input/resize/close/show actions;
- diff/watch/apply/revert actions;
- run/setup/configuration actions;
- all state/session/diff/run/terminal/setup/PR output messages.

Missing, unknown, mismatched, inactive-when-required, or ambiguous identities return a typed route error. They never fall back to the current project or `workspaceFolders[0]`.

Single-project mode retains a narrow compatibility adapter that injects the pinned project identity. Core handlers always operate on explicit references.

## One KiloProvider with a project/session route service

Keep one embedded `KiloProvider`. Multiple providers would duplicate event handling, terminal registrations, caches, and current-session state for one webview.

Add an Agent Manager route service:

```ts
interface SessionRoute extends SessionRef {
  directory: string
  generation: number
}
```

It must:

- register explicit routes for every Local session at its project root;
- register every worktree session at its worktree path;
- let child sessions inherit the parent route;
- validate directory ownership;
- detect ambiguous raw session IDs;
- supply the exact directory to every SDK operation, including share/unshare;
- remove current-root and workspace-root fallback for identified Agent Manager sessions;
- refresh sessions independently for every initialized project and emit real project-stamped `SessionInfo` records.

The shared detail pane consumes the selected `SessionRef`. Every sidebar body consumes its project's real session store. Background session UI may initially be visually simpler, but it must not display fabricated titles or placeholder session objects.

Project activation in `KiloProvider` must invalidate and refresh project-scoped config, providers, agents, commands, skills, MCP state, indexing, sandbox state, and Git status under an activation generation guard.

## Global services with composite keys

Some services remain panel-global to avoid duplicate VS Code registrations, but all associations use composite references.

- terminal mappings: `ProjectId + SessionId` or `ProjectId + WorktreeId`;
- run state: keyed by `WorktreeRef`, including project Local;
- visible/presence state: keyed by `SessionRef`;
- tabs and sidebar selection: keyed by `SidebarTarget`;
- diff/apply/revert state: keyed by `ProjectRef` and target;
- pending setup/create/delete state: keyed by project-qualified resource refs.

Remove unknown-worktree-to-current-root terminal fallback. A context supplies a validated CWD to the global terminal manager.

Global backend events are routed once by event directory and registered session route. Status, tool, orchestration, permission, and question events retain their directory and enter exactly one owning project context. A cold/collapsed context is not initialized by an unsolicited event.

## Uniform project sidebar UI

### One body implementation

Extract the existing real `renderBody()` from `AgentManagerApp.tsx` into `ProjectSidebarBody`. Do not maintain active and background implementations.

`ProjectSidebarBody` receives a stable project-scoped store and project-qualified action callbacks. It reuses:

- the existing Local card markup;
- `WorktreeSectionActions`;
- `WorktreeItem`;
- `SectionHeader` and current drag/drop behavior;
- `UnassignedSessionsSection`;
- existing rename/delete/open/PR/run/setup/session affordances.

Render it for every expanded project:

```tsx
<For each={projects()}>
  {(project) => (
    <ProjectAccordion project={project}>
      <Show when={project.expanded}>
        <ProjectSidebarBody projectId={project.id} />
      </Show>
    </ProjectAccordion>
  )}
</For>
```

The body is keyed by `projectId`, not active status. Changing detail selection cannot remount it.

### Per-project webview stores

Replace active-only shared sidebar signals with `Map<ProjectId, ProjectSidebarStore>` or an equivalent Solid store registry.

Each store owns:

- state/worktrees/sections/order/stale state;
- real `SessionInfo` and managed-session state;
- git stats and local stats;
- PR and run/setup state;
- pending delete/rename/create state;
- sidebar search/order/collapse state where repository-owned;
- generation for dropping stale output.

Only shared detail/chat/terminal state remains global. The top toolbar reads the selected detail target's project store.

`project-live.ts` may be evolved into this complete store registry. It must stop mirroring active payloads into a separate sidebar signal set.

### Scrolling and layout

The project list becomes the sidebar scroll container. Individual project bodies must not use a global `50vh` cap that makes two projects fight for viewport height. Section and project collapse state controls density; normal browser scrolling exposes all expanded worktrees.

### UI behavior

- Clicking a Local/worktree/session card emits one atomic project-qualified selection.
- Rename/delete/run/open/section/PR actions execute against the clicked card's project without changing sidebar structure.
- The active project may receive an emphasis style, but no different markup.
- Active project chevrons are not disabled; expansion and detail selection are separate concepts.
- Global New Session/Run buttons target the last selected detail project.
- New Worktree accepts an explicit target project, defaulting to the selected detail project.

## Uniform polling and live state

Every ready expanded context owns the same poller set. There is no active singleton poller plus background poller split.

Pollers emit `{ projectId, generation }` and update only their owning context/store. Stop/suspend increments generation before clearing timers so in-flight Git/PR results are dropped.

Context state is pushed after every project mutation, not only initial expansion or active-project changes. This includes worktree/session/section/order/run/setup changes in background projects.

Panel visibility changes poll cadence uniformly across all expanded contexts.

## Registry correctness

Registry mutations use one in-process queue. Each mutation re-reads persisted storage, validates it, applies one mutation, writes once, then updates memory. Trust/remove persistence failures are user-visible and do not leave UI state ahead of storage.

Registry descriptors include canonical root, canonical Git common directory, URI scheme/authority, order, label, trust, and added time. They do not contain Agent Manager repository state.

## Implementation order

### Slice 0: configuration safety blocker

1. Introduce revisioned `/config/overlay` reads and compare-and-swap writes, first for User scope and with the same generic implementation covered for Project scope.
2. Separate runtime-effective config messages/state from immutable Settings bindings and drafts.
3. Add explicit `User | Project` Settings scope and an immutable trusted project selector/binding for Project writes.
4. Remove hidden `splitConfigByScope` persistence and audit every direct/indirect config mutation, including provider disconnect, import/reset, custom providers, work-style presets, Permission Dock, and indexing.
5. Make config events scope/directory/target/revision aware and generation-guard runtime activation refreshes.
6. Add target-switch, stale-binding, revision-conflict, trust, and draft-preservation tests.

Do not enable multi-project broadly before this slice passes.

### Slice 1: routing and identity blockers

1. Add project-qualified refs and strict protocol types.
2. Add the project/session route service and explicit Local routes.
3. Remove Agent Manager current/workspace-root fallback for identified operations.
4. Add atomic project-qualified selection.
5. Convert panel-global maps to composite keys.
6. Add strict routing and raw-ID collision tests.

Do not expose interactive background controls before this slice passes.

### Slice 2: context lifecycle and service ownership

1. Add single-flight initialization, lifecycle state, generation, and mutation queue to `ProjectContext`.
2. Move root-bound diff/import/run/setup/branch-naming/poller ownership behind context APIs.
3. Replace dynamic active getters inside async mutations with captured contexts.
4. Add suspend/remove/dispose coordination.
5. Reject duplicate Git common directories and serialize registry writes.
6. Route global backend events by directory.

### Slice 3: complete per-project stores

1. Refresh and store real sessions per project.
2. Emit all relevant output with project and generation.
3. Evolve `project-live.ts` into a complete project sidebar store registry.
4. Make polling uniform and generation-safe.
5. Add background mutation/state propagation tests.

### Slice 4: uniform real UI

1. Extract the current `renderBody()` intact into `ProjectSidebarBody`.
2. Parameterize it by one project store and project-qualified callbacks.
3. Render one body per expanded project.
4. Delete `ProjectSummary` and its CSS.
5. Separate project expansion from detail activation.
6. Add project-aware New Worktree targeting.
7. Add component/visual tests proving no body remount or structural change on selection.

### Slice 5: validation and release gating

1. Run focused lifecycle/router/context tests after each slice.
2. From `packages/opencode/`, run the focused config overlay/project-update tests and CLI typecheck. Run the opencode annotation and Promise-facade guards for shared-file hooks.
3. Regenerate the JS SDK after endpoint schema changes and verify generated consumers compile; never hand-edit generated sources.
4. From `packages/kilo-vscode/`, run typecheck, lint, focused/unit tests, knip, compile/package, and architecture guards.
5. Manually exercise two repositories with multiple worktrees and sessions in both, including a dirty User draft during project activation, an external config edit conflict, project trust revocation, project removal, and project-config open targeting.
6. Keep the feature flag default off until all acceptance criteria pass.

## Blocking tests

The feature is not complete until tests prove:

1. Two concurrent expands initialize one context once.
2. Collapse/remove during initialization produces no late state or poller posts.
3. A project switch during create/import/setup/session/run/diff cannot change operation ownership.
4. Project B Local sessions never resolve through project A.
5. Missing/mismatched project references fail closed.
6. Poller/PR late results after stop or generation change are dropped.
7. Same raw worktree/session/local IDs in two projects do not collide in runtime or UI stores.
8. Two expanded projects render two permanent full `ProjectSidebarBody` instances.
9. Selecting a card changes only shared detail state and active emphasis, not body structure or mount identity.
10. Every worktree/session/terminal/diff/run/setup/section/PR action targets the clicked project's context.
11. Registry writes preserve concurrent add/remove/trust changes.
12. Roots sharing one Git common directory cannot both register.
13. Panel shutdown awaits all contexts and stops background activity.
14. Flag-off behavior remains the current single-project UI and state file.
15. A Settings draft loaded for project A cannot write project B after any activation, expansion, removal, trust, or worktree switch.
16. User Settings writes target the revisioned user file; explicit Project Settings writes target only the selected trusted project's revisioned root config. No key is silently rerouted.
17. A clean external config change refreshes Settings; a dirty or saving binding is marked stale without losing its draft.
18. Concurrent editors using the same revision produce one success and one 409 conflict, with no lost update or partial file.
19. A comment-only JSONC edit, file deletion/recreation with changed bytes, or newly created higher-priority config changes the revision/target and rejects the stale write.
20. A save response clears only the matching `{ requestId, binding.id }`; an SSE config event or out-of-order read cannot confirm a save.
21. Global and project writes are independently acknowledged and never presented as one atomic transaction.
22. Project config open/read/write actions reject unknown, untrusted, removed, generation-stale, symlink-escaping, or mismatched project targets.
23. Runtime config for a selected managed worktree uses that worktree directory, while Project Settings/open-file targets the immutable registered project root.
24. Project-sourced providers and other config collections cannot trigger an implicit active-project write from Settings actions.

## Acceptance criteria

- No `ProjectSummary` or alternate fake-card body exists.
- Every expanded project displays real live Local, worktree, and session UI concurrently.
- Every visible worktree/session action is usable and routes by explicit project identity.
- Switching detail selection causes no sidebar body remount, replacement, collapse, or data reset.
- Each project reads and writes only its own `.kilo/agent-manager.json`.
- Expanded projects remain live independently; collapsed projects suspend safely.
- No identified operation falls back to active/current/workspace root.
- Single-project behavior and persisted state remain backward-compatible when the flag is off.
- Shared Settings exposes explicit User and Project scope; Project writes require a trusted project selector and immutable binding.
- Runtime project activation and Settings editor binding are separate state machines.
- Every Settings config write has an immutable scope/target binding and revision precondition; narrow domain mutations merge named fields under the same target lock. No config mutation uses a save-time active-directory lookup.
- Dirty drafts survive external updates and conflicts and can never migrate between projects.
- Project Settings targets the explicit registered root, never the active Agent Manager project or active worktree.

## Planned UI

```text
┌─ Sidebar ─────────────────────────────────┬─ Shared detail pane ──────────┐
│ ← selected project   search calendar gear │                              │
│                                           │  Chat / diff / terminal       │
│ PROJECTS                                + │  for the selected             │
│ ▾ abalone-bactrosaurus                    │  project/worktree/session     │
│   ┌─────────────────────────────────┐     │                              │
│   │ Local    main   +3295 -548 ↓54  │     │                              │
│   └─────────────────────────────────┘     │                              │
│   WORKTREES                     actions   │                              │
│   ┌─────────────────────────────────┐     │                              │
│   │ feature-x  #1234  +120 -8 ↓2    │     │                              │
│   │ real menus, rename, run, open    │     │                              │
│   └─────────────────────────────────┘     │                              │
│   ┌─────────────────────────────────┐     │                              │
│   │ bugfix-y            +45 -12      │     │                              │
│   └─────────────────────────────────┘     │                              │
│   SESSIONS                                │                              │
│   • Fix login redirect          running   │                              │
│   • Refactor auth                         │                              │
│                                           │                              │
│ ▾ kilo-pi-provider                        │                              │
│   ┌─────────────────────────────────┐     │                              │
│   │ Local    master   +16 -6 ↓1      │     │                              │
│   └─────────────────────────────────┘     │                              │
│   WORKTREES                     actions   │                              │
│   ┌─────────────────────────────────┐     │                              │
│   │ provider-z   #88   +88 -3        │     │                              │
│   │ real menus, rename, run, open    │     │                              │
│   └─────────────────────────────────┘     │                              │
│   SESSIONS                                │                              │
│   • Add provider tests                    │                              │
│                                           │                              │
│ ▸ docs-repo                    collapsed  │                              │
│                                           │                              │
│                 [New Session] [Run]       │                              │
└───────────────────────────────────────────┴──────────────────────────────┘

Selecting any card:

- keeps every project body mounted and pixel-stable;
- changes only the selected styling, top toolbar target, and shared detail pane;
- never swaps a real body for a summary or vice versa.
```
