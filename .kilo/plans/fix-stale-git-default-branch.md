# Fix stale Git default branch diffs

## Goal

Keep branch diff totals and the diff view on the same comparison while preventing an old local `origin/HEAD` from selecting a retired trunk such as `master` after a repository moves to `main`.

## Approach

1. Update the existing shared `GitOps.resolveDefaultBranch` path instead of adding another diff calculator.
2. Resolve the remote's current `HEAD` with a read-only, non-interactive `git ls-remote --symref` call, cache it, and use local `<remote>/HEAD` only when the remote cannot answer.
3. Keep explicit worktree parent branches, configured upstreams, user base overrides, and repositories that still use `master` unchanged.
4. Add focused tests for a stale local `origin/HEAD`, remote-unavailable fallback, and normal `master` repositories.

## Validation

1. Create a disposable repository whose remote moved from `master` to `main` while the clone retains `origin/HEAD -> origin/master`.
2. Record the large pre-fix `master...HEAD` totals.
3. Verify the shared resolver selects `origin/main` after the fix and that stats and file-list targets match.
4. Verify a repository whose remote still advertises `master` continues to use `origin/master`.
5. Run the focused unit tests, extension typecheck/lint, and the isolated VS Code self-test for the indicator-to-diff flow.
