# Agent Manager multi-project configuration architecture

**Status:** Blocking architecture for multi-project release

**Date:** 2026-07-22

This document is the canonical configuration specification for Agent Manager multi-project support. The main UI/runtime plan references it and must not duplicate or contradict it.

The executable sequence from the current branch is [`agent-manager-multi-project-implementation-handoff.md`](./agent-manager-multi-project-implementation-handoff.md).

## Decision

Keep the useful current split between user and project settings, but make every Settings read and write target explicit, immutable, revisioned, and independent from Agent Manager activation.

Multi-project must not ship broadly while Settings can load a draft for project A and resolve its save target from the mutable active project B.

## Current behavior

Kilo has four configuration stores:

| Store | Example | Owner |
|---|---|---|
| VS Code preferences | VS Code `settings.json` | This VS Code user/installation |
| Kilo user config | `~/.config/kilo/kilo.json` | User defaults across projects and Kilo clients |
| Kilo project config | `<repo>/.kilo/kilo.jsonc` | Repository behavior and overrides |
| Runtime/session state | In-memory, directory-qualified | One project, worktree, or session |

The shared Settings save currently calls `splitConfigByScope()`:

- `commit_message` is written to project config;
- `indexing.enabled` is written to project config;
- all other generic Settings fields are written to user config.

The Indexing tab also has an explicit Global/Project selector and can write the entire `indexing` object to either layer. This is too broad because project config can receive provider/model/vector-store credentials and infrastructure settings.

Several controls are VS Code preferences and bypass Kilo config entirely, including autocomplete UI, browser automation, notifications, max auto-approve cost, commit-message output language, and indexing button visibility.

## Confirmed blocking failure

The current protocol does not bind a draft to the config target it was loaded from:

1. `KiloProvider.fetchAndSendConfig()` resolves a mutable current directory and sends unqualified `configLoaded` state.
2. The webview owns one global/project/effective draft.
3. Agent Manager changes the active project from A to B.
4. The webview sends an unqualified `updateConfig`.
5. `KiloProvider.handleUpdateConfig()` resolves the current directory again at save time and may write A's draft to B.

Reads are directory-scoped, but writes are not bound to the read target. This is the release blocker.

The backend also lacks an expected target/revision precondition, so external editors or another window can overwrite a config between read and save.

## Ownership policy

### VS Code preferences

These remain in VS Code settings and do not participate in project config:

- extension language and presentation preferences;
- autocomplete enablement, keybindings, provider, and model;
- browser automation enablement/system Chrome/headless mode;
- notification enablement and sound;
- maximum automatic approval cost;
- commit-message output language;
- indexing button visibility while indexing is disabled;
- multi-project feature enablement.

### Kilo user config

These are personal defaults or security policy and should be edited in User scope:

- default, small, and subagent models and variants;
- provider enablement, custom providers, credentials, and endpoints;
- user/global agents and default agent;
- permission defaults and user tool defaults;
- sandbox policy, network access, writable paths, and allowed hosts;
- compaction, checkpoint/snapshot, and tool-output defaults;
- username and display behavior;
- sharing, remote control, telemetry, and experimental features;
- user/global formatter, LSP, MCP, skills, instructions, commands, and workflows;
- indexing provider, model, credentials, vector storage, and global tuning defaults.

A trusted project may override many of these at runtime, but editing User scope never writes those overrides.

### Kilo project config

These describe repository behavior and are valid project settings:

- commit-message prompt;
- repository indexing file extensions, include/ignore rules, and deliberate project tuning overrides;
- repository instructions;
- repository skill paths;
- repository commands/workflows;
- trusted project agents;
- trusted project MCP servers;
- repository formatter/LSP overrides;
- repository watcher ignores;
- repository-specific tool restrictions and permission requests.

Project configuration may override user model/agent/tool defaults, but provider credentials and security-policy weakening must not be silently authored into a repository.

### Machine-local project consent

Indexing enablement is privacy consent, not repository configuration. Store it outside the repository, keyed by canonical `ProjectId` in machine-local extension state:

- newly observed projects default to indexing disabled;
- users explicitly enable indexing for one project on this machine;
- repository config cannot enable indexing;
- repository config may describe what to index, but consent gates whether indexing starts;
- canonical project identity prevents a symlink or alternate path from bypassing consent.

Effective indexing requires both valid user-global indexing configuration and machine-local consent for that project.

### Current tabs

| Settings tab | Correct editable target |
|---|---|
| Models | User by default; explicit Project scope may override models/agents |
| Providers | User only for credentials/endpoints; project-provided entries are source-labelled |
| Agent Behaviour | User or explicit trusted Project scope |
| Auto Approve | User Kilo config; max cost remains VS Code preference |
| Browser | VS Code preferences |
| Checkpoints | User default or explicit Project override |
| Display | User config |
| Autocomplete | VS Code preferences |
| Notifications | VS Code preferences |
| Context | User defaults; repository watcher/instruction rules in explicit Project scope |
| Commit Message | Project scope for prompt; language remains VS Code preference |
| Indexing | User for provider/model/credentials/storage; machine-local project consent for enablement; Project for repository rules |
| Experimental | User config; multi-project also mirrors to VS Code preference |
| Sandboxing | User config only |
| Language | VS Code preference |
| MCP/Commands/Skills | User defaults or explicit trusted Project scope |

No field silently chooses a file during save. The UI must display its scope.

## Settings UX

Use explicit scope and project controls:

```text
Scope: User | Project

Project: backend
Target: /projects/backend/.kilo/kilo.jsonc
```

- User scope always targets user config.
- Project scope requires an explicit trusted project selector.
- The Settings selector is separate from Agent Manager's active project.
- Opening Settings may initialize the project selector once from the current project, but later Agent Manager switches never change it.
- A dirty project draft cannot move to another project. Selector changes require Save, Discard, or Stay.
- Inherited values show source badges such as User, Project: backend, and Managed.
- Project scope offers Override and Reset to inherited.
- Project-sourced providers cannot be silently deleted from project config through User scope.

Runtime config still follows the exact session directory. Settings Project scope targets the registered project root, not the active worktree. Worktree-config editing is a separate future feature requiring an explicit `WorktreeRef`.

## Immutable binding contract

A Settings read returns an opaque binding:

```ts
interface SettingsBinding {
  id: string
  connectionGeneration: number
  scope: "global" | "project"
  project?: {
    projectId: string
    root: string
    generation: number
  }
  directory: string
  target: {
    scope: "global" | "project"
    path: string
    revision: string
    exists: boolean
    writable: boolean
  }
}
```

The write contains only the opaque binding and patch:

```ts
interface WriteSettingsConfig {
  type: "settingsConfig.write"
  requestId: string
  bindingId: string
  set: Record<string, unknown>
  unset: string[][]
}
```

The extension stores the authoritative binding. On write it must:

1. reject unknown/expired bindings;
2. verify project existence, generation, and trust;
3. capture the binding before the first await;
4. use the binding's stored directory and scope;
5. never call `getWorkspaceDirectory()`, `contexts.active()`, or use a worktree/session fallback;
6. clear a draft only from the matching `{ requestId, bindingId }` response.

Bindings expire after save, reconnect, trust revocation, project removal, or context generation change.

## Backend revision contract

`GET /config/overlay` must return the exact global/project target path, parsed raw target config, effective config/source metadata, and a revision.

The revision is a SHA-256 fingerprint of canonical target path, existence marker, and exact file bytes. This catches content changes, JSONC comment-only edits, and target changes.

`PATCH /config/overlay` accepts one scope and requires:

```ts
{
  scope: "global" | "project"
  set: Record<string, unknown>
  unset: string[][]
  expected: {
    path: string
    revision: string
  }
}
```

The backend must re-resolve the authoritative target, verify path/revision under a target lock, patch the raw target layer, validate it, atomically replace the file, and return a fresh snapshot. It never accepts an arbitrary client path.

Expected failures include expired binding, unknown/untrusted project, changed target, revision conflict, invalid config, non-writable target, and I/O failure. Every failure preserves the draft.

## Required implementation

1. Add revisioned target descriptors and compare-and-swap writes to the Kilo config overlay API.
2. Split activation-bound runtime config state from binding-keyed Settings editor state.
3. Replace unqualified `configLoaded`/`updateConfig` with settings read/write messages carrying request and binding IDs.
4. Replace hidden `splitConfigByScope` saves with explicit scope on every editable control.
5. Restrict Indexing Project scope to repository rules; keep provider/model/credentials/storage in User scope.
6. Move indexing enablement from project config to machine-local consent keyed by canonical `ProjectId`, default off.
7. Audit direct config mutators outside the save bar, especially provider disconnect, imports/resets, custom providers, work styles, permission rules, and indexing actions.
8. Make Open Project Config take a `ProjectRef`, resolve the immutable registered root, and verify trust.
9. Partition config caches/events by scope, directory, target, revision, and activation generation.

## Blocking tests

- Load Settings for A, switch Agent Manager to B, save: only A's bound target changes.
- Same test while selecting A/B worktrees and sessions.
- User-scope save always changes only user config.
- Project-scope save requires the explicit trusted project and changes only its registered root config.
- Dirty drafts survive Agent Manager switches and cannot migrate between Settings projects.
- Out-of-order reads and writes update only the matching request/binding.
- External file change causes a revision conflict without losing the draft.
- A changed config target path causes a target conflict.
- Project removal, generation change, or trust revocation expires its binding.
- Indexing provider/model/credentials/storage never enter project config through the form.
- A repository file containing `indexing.enabled: true` cannot grant indexing consent.
- New projects default to indexing disabled until explicitly enabled on this machine.
- Consent follows canonical project identity across symlink/path aliases and never leaks to another project.
- `commit_message.prompt` and repository indexing rules still support explicit project writes.
- Runtime worktree config uses the worktree directory while Project Settings remains bound to the registered project root.

## Release gate

Keep multi-project disabled by default until the immutable binding/revision contract and the blocking tests above are implemented. The useful existing project-local behavior should be preserved, not removed; its write target must become explicit and immutable.
