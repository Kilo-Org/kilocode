# Agent Manager PR Merge Readiness

## Goal

Show approvals, merge readiness, conflicts, branch updates, and merge actions in the Agent Manager PR panel without duplicating the existing PR status loading path.

## Data and caching

- Extend the existing PR status query with GitHub mergeability, merge state, auto-merge, and head/base commit IDs.
- Reuse the existing PR poller, repository cache, bridge cache, signature dedupe, and webview replay.
- Store the last merge method per repository in extension `globalState`.
- Load conflicting paths on demand. `GitOps.conflicts` fetches missing commits and runs `git merge-tree --write-tree --name-only` without changing the worktree, index, or stash. Cache results by worktree, remote, base, and head IDs.

## Actions

- `agentManager.updatePRBranch` calls GitHub's Update branch endpoint.
- `agentManager.mergePR` uses `gh pr merge` with the selected method and expected head SHA.
- `agentManager.disablePRAutoMerge` disables GitHub auto-merge.
- `agentManager.loadPRConflicts` returns the conflict paths computed by `GitOps`.
- All mutations use the existing PR action bridge, request dedupe, refresh, and error result patterns.

## UI

- Show merge readiness first in the PR summary.
- Show approvals inline with reviewer avatars and counts.
- Show conflict title, compact explanation, `Fix with Kilo`, and a bounded scrollable file list.
- Show Update branch when the branch is behind.
- Show a small shared split button for merge methods, auto-merge, and direct merge.
- Keep the file list capped so the top summary box does not grow without bound.

## Verification

- Test merge-tree conflict detection against divergent commits.
- Test PR merge action routing and conflict result handling.
- Run extension typecheck, lint, bundle, architecture checks, i18n checks, and unit tests.
- Verify the PR panel states with isolated VS Code screenshots.
