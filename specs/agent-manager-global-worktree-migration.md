# Agent Manager Global Worktree Migration Plan

## Goal

Move Agent Manager worktrees and persisted Agent Manager state out of the user's repository and into Kilo's global data directory.

This removes the need to keep generated worktree directories inside the project, reduces repo-local ignore complexity, and keeps Agent Manager data alongside Kilo's other global runtime data.

## Best Global Directory

### Options considered

1. `~/.config/kilo`
   - Good for user-authored configuration.
   - Bad fit for generated git worktrees and mutable state.
   - Reject: worktrees are data, not config.

2. `~/.kilocode`
   - Already used for user-authored global Kilo content like skills, rules, and workflows.
   - Mixing large generated git worktrees into that directory would blur the line between user content and generated runtime data.
   - Reject for Agent Manager worktrees.

3. VS Code global storage
   - Too extension-specific.
   - Makes the storage layout depend on one client instead of Kilo's shared global paths.
   - Reject.

4. `Global.Path.data` / `~/.local/share/kilo`
   - Matches the existing CLI runtime data root.
   - Correct XDG-style bucket for generated application data.
   - Keeps worktrees close to Kilo's other global state without treating them as config.
   - Recommended.

### Chosen layout

Use the Agent Manager namespace under Kilo's global data root:

```text
~/.local/share/kilo/agent-manager/{repoSlug}/
  agent-manager.json
  worktrees/
    {branch-or-slug}/
```

Where `repoSlug` is deterministic per repository root so different clones of the same repo do not collide.

On Windows, this should map to `%LOCALAPPDATA%\kilo\agent-manager\{repoSlug}\...`.

## Scope

### In scope

- Create new Agent Manager worktrees in the global data directory.
- Store Agent Manager state in the same global directory.
- Keep `.kilocode/setup-script*` in-repo because it is project-specific and user-editable.
- Migrate legacy in-repo state from `.kilocode/agent-manager.json` on first load.
- Continue recognizing legacy in-repo worktrees during the transition window.
- Update tests and docs to reflect the new layout.

### Out of scope for this pass

- Automatically relocating existing legacy worktree directories from `.kilocode/worktrees/` to the global directory.

That follow-up is possible, but it adds Git bookkeeping and live-session migration risk. The safer first step is to switch all new worktrees to the global location while preserving compatibility with existing legacy worktrees.

## Implementation Plan

### Phase 1: Path extraction and storage switch

- Add a dedicated path helper for Agent Manager global paths.
- Put Agent Manager state at `Global.Path.data`-equivalent storage under `agent-manager/{repoSlug}/agent-manager.json`.
- Put new worktrees under `agent-manager/{repoSlug}/worktrees/`.

### Phase 2: Legacy compatibility

- Keep reading legacy state from `.kilocode/agent-manager.json` when no global state exists yet.
- Save migrated state back to the global location.
- Keep discovery support for legacy worktrees under `.kilocode/worktrees/` so old sessions still show up.

### Phase 3: Git ignore cleanup

- Stop adding `.kilocode/worktrees/` and `.kilocode/agent-manager.json` to `.git/info/exclude`.
- Continue excluding `.kilocode/setup-script*` because setup scripts remain repo-local.
- Keep worktree-local metadata excluded inside each worktree checkout.

### Phase 4: Coverage and docs

- Update unit tests to assert the global location.
- Add migration coverage for legacy state loading.
- Update Agent Manager docs to show the new global path and explain that only setup scripts remain in the repo.

## Current Status

The current diff already covers most of Phases 1 through 3:

- global Agent Manager path helper
- global worktree creation
- global state file
- legacy state migration
- legacy worktree discovery
- `.git/info/exclude` cleanup
- updated unit tests

The remaining work is mainly documentation cleanup and making sure the chosen directory is explicitly justified in-repo.

## Follow-up Recommendation

If we later want to fully remove legacy path complexity, add a separate migration that uses Git-aware worktree moves for existing `.kilocode/worktrees/` entries and updates stored paths after validating that no live session is using the old location.
