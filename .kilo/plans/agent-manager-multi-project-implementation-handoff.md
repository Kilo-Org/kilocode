# Agent Manager multi-project implementation handoff

**Status:** Implementation-ready handoff from the current branch

**Date:** 2026-07-22

This document tells the next implementation model exactly how to continue from branch `abalone-bactrosaurus` at commit `8f48da2278` plus the uncommitted plan files. It is the execution checklist. Detailed decisions live in:

- [`agent-manager-multi-project-configuration.md`](./agent-manager-multi-project-configuration.md) for configuration ownership, bindings, revisions, indexing consent, and settings tests;
- [`agent-manager-multi-project-uniform-ui.md`](./agent-manager-multi-project-uniform-ui.md) for runtime, routing, lifecycle, uniform sidebar UI, and acceptance criteria.

If this handoff conflicts with either architecture document, stop and resolve the contradiction before coding.

## Goal

Finish the current prototype into a safe, complete multi-project Agent Manager behind a default-off VS Code experimental flag.

The feature is done only when:

- multiple expanded projects show the same full Agent Manager sidebar behavior;
- every action uses explicit project/worktree/session ownership;
- Settings cannot write the wrong project's config;
- indexing requires machine-local consent per canonical project;
- project identity is canonical, Git-root-aware, common-dir-safe, and remote-authority-aware;
- single-project behavior remains unchanged when the flag is off.

## Current branch baseline

### Implemented and worth keeping

- persistent additional-project registry with serialized/re-read mutations;
- separate `ProjectContext` objects and per-project Agent Manager state files;
- project-stamped state, stats, PR, and session payloads;
- canonical worktree presence comparison for symlink/`/tmp` aliases;
- per-project session listing from project root and worktree directories;
- partial production `ProjectRouteService` integration and raw-session ambiguity rejection;
- project-qualified sidebar DOM IDs and cross-project previous/next navigation;
- atomic selection validation and same-project activation fast path;
- flag-off return to pinned project;
- Experimental Settings toggle and translations;
- focused unit tests for registry, contexts, paths, pollers, routing, sessions, selection, and navigation.

### Not implemented or incomplete

- immutable/revisioned Settings bindings;
- machine-local indexing consent;
- canonical pinned Git toplevel, `commonGitDir`, URI scheme/authority identity;
- strict project envelopes for all Agent Manager operations;
- complete route-service use for every session/terminal/diff/share/permission operation;
- one full sidebar body shared by single- and multi-project modes;
- uniform per-context poller and stale-state ownership;
- all repository mutations through `ProjectContext.run()`;
- complete real two-project E2E verification.

### Known diff cleanup

- remove unrelated `packages/opencode/package.json` ordering/dependency drift;
- restore unrelated `bun.lock` ordering/version drift unless required by a retained change;
- remove `experimental.multi_project` from the CLI config schema and generated SDK once the VS Code flag is the sole source of truth;
- rewrite the changeset after final behavior is complete.

Do not reset or discard unrelated user changes. Inspect every cleanup diff before applying it.

## Non-negotiable invariants

1. Agent Manager activation is not a Settings write target.
2. No identified operation falls back to the active project or workspace root in multi-project mode.
3. A project config write targets the explicitly selected registered project root, never an active worktree.
4. Runtime config remains directory-correct: project Local uses root, worktree sessions use exact worktree directory.
5. Repository config cannot grant indexing consent.
6. New projects default to indexing disabled on this machine.
7. Provider/API credentials and indexing infrastructure never enter project config through Settings.
8. Raw session/worktree IDs are never sufficient UI/runtime identity when multiple projects are exposed.
9. The full existing sidebar behavior is reused; do not maintain a simplified multi-project copy.
10. Do not raise `AgentManagerProvider.ts` or `AgentManagerApp.tsx` line caps.

## Work order

Complete slices in order. Do not start the next slice while the current slice's tests or checks fail.

## Slice 0A: consolidate the feature flag

### Required result

Use one source of truth: VS Code application setting `kilo-code.new.experimental.multiProject`.

### Required changes

1. Remove `experimental.multi_project` from:
   - `packages/core/src/v1/config/config.ts`;
   - `packages/sdk/js/src/v2/gen/types.gen.ts` by regenerating the SDK after schema removal;
   - `packages/kilo-vscode/webview-ui/src/types/messages/config.ts`.
2. Do not hand-edit generated SDK files. Run `./script/generate.ts` from repository root after endpoint/schema changes.
3. Change `ExperimentalTab.tsx` so the toggle reads the VS Code setting delivered in `configLoaded.settings`, not `config().experimental`.
4. Add `multiProject` to the extension settings payload sent by `KiloProvider.fetchAndSendConfig()`.
5. Toggling it sends only `updateSetting("experimental.multiProject", checked)`.
6. Keep `VscodeHost.multiProject()` and its change listener reading the same VS Code setting.

### Tests

- toggle initial state reflects VS Code setting when CLI config disagrees;
- toggling updates the VS Code setting and Agent Manager reacts;
- no CLI/project config file gains `experimental.multi_project`.

### Stop gate

Run from `packages/kilo-vscode/`:

```sh
bun run format
bun run format:check
bun run typecheck
bun run lint
bun run test:unit
```

Do not continue if any command fails.

## Slice 0B: machine-local indexing consent

### Required result

Indexing enablement is explicit machine-local consent keyed by canonical `ProjectId`, default false. Project config controls indexing rules but cannot enable indexing.

### Required changes

1. Add a versioned machine-local consent store in the extension, not repository config and not synced across machines.
2. Use canonical project identity as the key. The pinned project and registered projects use the same identity resolver.
3. Remove hidden routing of `indexing.enabled` to project config from `webview-ui/src/utils/config-scope.ts`.
4. Remove project/global inheritance logic for `indexing.enabled` from `indexing-tab-state.ts`.
5. The Indexing UI requires an explicit project selector for enablement and reads/writes consent through dedicated messages.
6. Keep these in User config only:
   - provider;
   - model and dimension;
   - credentials/API keys/base URLs;
   - vector-store type and connection/storage settings;
   - machine/infrastructure tuning defaults.
7. Keep these available in explicit Project scope:
   - file extensions;
   - repository include/ignore rules;
   - deliberate repository chunking/tuning overrides.
8. Indexing startup/status must require both valid User indexing configuration and consent for the routed project.
9. A repository containing `indexing.enabled: true` must not enable indexing.

### Suggested files

- new VS Code-free consent store under `src/indexing/` or `src/agent-manager/`;
- `src/KiloProvider.ts` only as a thin protocol adapter;
- `webview-ui/src/components/settings/IndexingTab.tsx`;
- `webview-ui/src/components/settings/indexing-tab-state.ts`;
- `webview-ui/src/context/config.tsx` only if necessary;
- focused tests beside existing indexing tests.

### Tests

- unknown project defaults off;
- A enabled does not enable B;
- symlink/path alias resolves to the same consent;
- repository config cannot grant consent;
- removing/re-adding behavior follows the documented store policy;
- no credentials/storage settings are emitted in a Project-scope patch.

## Slice 0C: revisioned config overlay backend

### Required result

Config reads return authoritative target descriptors and revisions. Writes use compare-and-swap and cannot overwrite external changes or a changed target.

### Required changes

1. Extend Kilo-owned config overlay code:
   - `packages/opencode/src/kilocode/config/overlay.ts`;
   - a new Kilo-owned writer under `packages/opencode/src/kilocode/config/`;
   - `packages/opencode/src/kilocode/server/httpapi/groups/config-console.ts`;
   - `packages/opencode/src/kilocode/server/httpapi/handlers/config-console.ts`.
2. Read response includes for global and project targets:
   - canonical path;
   - scope;
   - exists/writable;
   - SHA-256 revision of canonical path, existence marker, and exact bytes;
   - raw parsed target layer;
   - effective config and source metadata.
3. Write request accepts exactly one scope, `set`, `unset`, and expected path/revision.
4. Server re-resolves the authoritative target. Never trust client path as a destination.
5. Lock by canonical target path, re-read inside lock, compare revision, patch raw JSONC, validate, and atomically replace.
6. Return a fresh authoritative snapshot.
7. Return typed 409 conflicts for target/revision changes; preserve drafts client-side.
8. Keep Kilo logic in `packages/opencode/src/kilocode/`. Shared upstream files get minimal marked delegation only when unavoidable.
9. Regenerate the SDK after endpoint changes.

### Tests

Add/extend:

- `packages/opencode/test/kilocode/server/config-overlay.test.ts`;
- `packages/opencode/test/kilocode/project-config-update.test.ts`.

Cover:

- exact raw target layer;
- comment-only external edit conflict;
- missing-file target revision;
- newly created higher-priority target conflict;
- concurrent writers: one success, one 409;
- symlink escape rejection;
- global and project writes remain separate;
- atomic write failure never exposes partial content.

### Stop gate

From `packages/opencode/`:

```sh
bun run typecheck
bun test test/kilocode/server/config-overlay.test.ts
bun test test/kilocode/project-config-update.test.ts
```

From repository root:

```sh
./script/generate.ts
bun run script/check-opencode-annotations.ts
bun run script/check-opencode-promise-facades.ts
```

## Slice 0D: immutable Settings bindings

### Required result

Settings has explicit `User | Project` scope. Project scope requires an explicit trusted project selector. Drafts and saves never follow Agent Manager activation.

### Required changes

1. Split runtime-effective config from Settings editor config.
2. Add a binding controller under `packages/kilo-vscode/src/kilo-provider/`; keep `KiloProvider.ts` as a thin adapter.
3. Replace unqualified config protocol with:
   - read request carrying request ID, scope, and optional project ID;
   - snapshot carrying opaque binding ID and source/target metadata;
   - write request carrying request ID, binding ID, set, and unset.
4. The extension stores authoritative bindings. The webview never supplies a writable path.
5. Project binding resolution:
   - resolve registered `ProjectContext.root`;
   - require project existence, matching generation, and trust;
   - never use active worktree/session or `getWorkspaceDirectory()` after binding creation.
6. Bindings expire on successful save, reconnect, project removal, generation change, or trust revocation.
7. Separate drafts by scope/project binding.
8. Dirty selector changes prompt Save, Discard, or Stay.
9. Out-of-order reads/writes update only matching request/binding.
10. External config events refresh clean drafts and mark dirty drafts stale without overwriting them.
11. Remove `splitConfigByScope()` after all controls declare scope explicitly.
12. Audit direct config mutators outside the save bar, including provider disconnect, imports/resets, custom providers, work styles, Permission Dock, MCP actions, and indexing.
13. Open Project Config takes explicit `ProjectRef`, checks trust, and resolves the registered root.

### UI scope policy

Use the table in `agent-manager-multi-project-configuration.md`. Do not invent another policy.

### Blocking tests

- load A, activate B, save A: only A target changes;
- same while selecting worktrees/sessions;
- User save changes only user config;
- Project save changes only selected trusted project's root config;
- dirty draft cannot migrate to another project;
- project removal/trust revocation expires binding;
- external edit returns conflict and preserves draft;
- no save-time active-directory lookup occurs.

## Slice 1: canonical project identity

### Required result

Every project is a canonical Git repository root with URI authority and common Git directory identity.

### Required changes

1. Replace path-only project descriptors with:

```ts
{
  id,
  uri,
  scheme,
  authority,
  root,
  commonGitDir,
  label,
  order,
  trusted,
  addedAt
}
```

2. Pinned and added projects use the same resolver:
   - validate URI host scope;
   - `git rev-parse --show-toplevel`;
   - `git rev-parse --path-format=absolute --git-common-dir`;
   - realpath/normalize both;
   - derive ID from scheme, authority, and canonical root.
3. Opening VS Code in a repository subdirectory still uses the Git toplevel and root state file.
4. Reject another exposed project sharing canonical `commonGitDir`.
5. Key Git mutation locks by common Git directory.
6. Preserve remote URI scheme/authority in picker, storage, and open-folder operations.
7. Migrate or safely read the current registry version without dropping valid entries.

### Tests

- workspace subdirectory resolves to repository root;
- symlink aliases dedupe;
- linked worktree/common-dir duplicate rejected;
- other remote authority hidden but preserved;
- missing/non-Git entry remains removable and never falls back to pinned root.

## Slice 2: strict routing and lifecycle

### Required result

Every repository-bound operation is explicitly project-qualified once multiple projects are exposed.

### Required changes

1. Introduce one project envelope at the Agent Manager boundary with project ID and generation.
2. Compatibility adapter injects pinned identity only in single-project mode.
3. Multi-project mode rejects missing/mismatched identity with typed errors.
4. Wire `ProjectRouteService` into every existing-session operation:
   - transcript/messages;
   - prompt/abort;
   - share/unshare;
   - fork/continuation;
   - permission/question responses;
   - terminal;
   - file/context operations;
   - diff/apply/revert.
5. Route global SSE events once by exact directory/session ownership.
6. Preserve non-Agent-Manager KiloProvider behavior.
7. Execute repository mutations through `ctx.run()` and generation-check commits.
8. Removal waits for mutation queue, stops pollers/watchers, flushes state, detaches routes, then removes registry entry.
9. Flag-off activates pinned Local and suspends secondaries without aborting sessions.

### Tests

- same raw session ID across projects is ambiguous without qualifier;
- B Local/share/unshare/permission never routes through A;
- unknown IDs produce no terminal/file/diff operation;
- project switch during mutation cannot change operation ownership;
- late completion after removal cannot mutate replacement context.

## Slice 3: uniform context-owned state and polling

### Required result

Every initialized expanded project owns the same live-state services. Active selection changes cadence/detail only, not ownership.

### Required changes

1. Move stats and PR pollers into `ProjectContext`; remove active singleton/background split.
2. Each context owns stale/presence state, cached stats, local stats, PR state, run/setup state, and generation.
3. Background presence updates project stale state rather than emitting empty arrays.
4. All project outputs include project ID and generation; webview discards stale generations.
5. Session-created/deleted/updated events refresh the owning project store without active-project filtering.
6. Panel visibility and expansion uniformly control polling.

### Tests

- two expanded projects both receive stats/presence/PR updates;
- collapse stops only that project's pollers;
- stale late poll result is dropped;
- background session deletion updates only its project.

## Slice 4: one full sidebar body

### Required result

Single- and multi-project modes render the same full `ProjectSidebarBody` implementation.

### Required changes

1. Extract the current full `renderBody()` from `AgentManagerApp.tsx` intact.
2. Parameterize it with one project store and project-qualified actions.
3. Preserve:
   - busy state;
   - drag/drop and grouping;
   - section actions;
   - search and keyboard hints;
   - run/setup state;
   - New Worktree dialog;
   - worktree menus and PR actions;
   - complete managed/unassigned session behavior.
4. Delete the simplified duplicate body path.
5. Render project rows keyed by stable project ID and keep bodies mounted across active changes.
6. New Worktree receives explicit target project, defaulting to Settings/detail selection policy as specified.

### Tests

- single-project behavior unchanged with flag off;
- two expanded projects render two full bodies;
- active selection changes no body mount identity;
- drag/drop, sections, worktree actions, sessions, and keyboard navigation work across projects.

## Slice 5: cleanup and release validation

1. Remove unrelated manifest/lockfile drift.
2. Update changeset to final user-visible behavior.
3. Run all extension and affected CLI checks.
4. Build/package the extension.
5. Use the VS Code self-test fixture with two repositories and multiple worktrees/sessions.
6. Keep feature default off until every blocking test passes.

### Required extension checks

From `packages/kilo-vscode/`:

```sh
bun run format
bun run format:check
bun run typecheck
bun run lint
bun run test:unit
bun run knip
bun run check-kilocode-change
bun run compile
```

From repository root:

```sh
bun run script/check-opencode-annotations.ts
bun run script/check-opencode-promise-facades.ts
bun run script/check-md-table-padding.ts
```

### Manual scenarios

1. Flag off: current single-project Agent Manager is unchanged.
2. Enable flag in Experimental Settings; restart; value persists without CLI/project config changes.
3. Add/trust/expand two repositories; restart; pinned remains first.
4. Both projects show Local, worktrees, sessions, stats, PR state, and full actions.
5. Navigate previous/next across projects.
6. Create/delete/rename worktrees in both projects.
7. Send prompts and answer permission/question requests in both projects.
8. Share/unshare B while A is active; exact B directory is used.
9. Load Project Settings A, activate B, save A; B is unchanged.
10. Modify A config externally while draft is dirty; conflict preserves draft.
11. Indexing defaults off for a new project; enabling A does not enable B; repo config cannot enable either.
12. Disable flag while B is active; pinned Local becomes active and B remains registered/suspended.
13. Repeat key routing and identity checks in a remote VS Code window.

## Rules for the implementation model

- Work on one slice at a time.
- Read the referenced architecture section before editing.
- Add focused tests before or with behavior changes.
- Use `apply_patch` for manual edits.
- Do not hand-edit generated SDK files.
- Do not raise file-size caps.
- Do not add fallback compatibility code unless the plan explicitly requires the single-project adapter.
- Do not claim a slice complete until its stop gate passes.
- If a required API or ownership decision is missing, stop and update this plan instead of guessing.
