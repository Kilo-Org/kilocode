---
description: Resolve upstream merge conflicts with a reviewable decision ledger
---

Resolve the manual part of an upstream merge and preserve the decision process
for PR review.

Arguments: `$ARGUMENTS`

Use the first argument as the upstream version, for example `v1.1.50` or
`1.1.50`. If no argument is provided, infer the version from the newest
`script/upstream/reports/manual-decisions-*.json` file or the current branch
name.

Workflow:

1. Inspect the current merge state:
   - `git status --short`
   - `git diff --name-only --diff-filter=U`
   - `script/upstream/reports/manual-decisions-<version>.md`
   - `upstream-merge-report-<version>.md` when present
   - `.worktrees/opencode-merge/auto-merge` for the automated merge snapshot when present
2. If no decision ledger exists yet, run:
   - `bun script/upstream/decisions.ts init --version <version>`
3. Before editing, write a concise plan in the chat:
   - file-by-file strategy
   - expected decision kind: `hybrid`, `take-ours`, `take-theirs`, `regenerated`, `removed`, `renamed`, or `other`
   - risk level: `low`, `medium`, or `high`
   - verification commands you expect to run
4. Resolve each conflict carefully.

   **Reference worktrees when present:**
   - `.worktrees/opencode-merge/opencode` is the pristine upstream opencode tree
   - `.worktrees/opencode-merge/kilo-main` is the Kilo base snapshot
   - `.worktrees/opencode-merge/auto-merge` is the automated merge snapshot and the original conflict reference

   **Inspect conflicts (optional):**
   - `script/upstream/find-conflict-markers.sh <file>` on the working tree
   - `script/upstream/find-conflict-markers.sh .worktrees/opencode-merge/auto-merge/<file>` on the auto-merge snapshot

   **Apply the resolution rules:**
   - prefer upstream code and architecture whenever compatible with Kilo behavior
   - preserve Kilo-specific behavior marked with `kilocode_change`
   - keep `kilocode_change` markers around Kilo-specific changes in shared opencode files
   - keep Kilo-specific text, code, and marker comments the same as the auto-merge conflict snapshot unless a refactor is required
   - if Kilo-specific code must be refactored to fit new upstream architecture, explain the refactor in the decision rationale
   - if upstream moved the relevant logic to another file, port the Kilo behavior there and record the decision as `renamed` or `hybrid` with `--target <new-path>`
   - if upstream deleted a file, analyze whether the Kilo behavior should be ported elsewhere or removed rather than restoring the deleted file
   - if tests fail only because upstream intentionally removed behavior, remove or update the obsolete tests rather than adding the old file back
   - do not modify unrelated files
5. After resolving each file, record the decision before staging it:
   - `bun script/upstream/decisions.ts add --version <version> --file <path> --kind <kind> --risk <risk> --summary "..." --rationale "..." --alternative "..." --verification "..."`
   - the add command captures the resolved file snapshot; use `--resolution "..."` only when a file was deleted, renamed, generated, or too large to summarize automatically
   - include at least one rejected alternative for non-trivial `hybrid`, `take-ours`, or `take-theirs` choices
   - include `--target <new-path>` for `renamed` decisions
   - use the rationale to explain why this preserves Kilo behavior while accepting the appropriate upstream change
6. Run the appropriate checks:
   - stage resolved files with `git add -A` before the ledger check so git no longer reports unmerged paths
   - always run `bun script/upstream/decisions.ts check --version <version>`
   - if `packages/opencode/` shared files changed, run `bun run script/check-opencode-annotations.ts`
   - run targeted typechecks/tests when practical for touched packages
7. Finish with:
   - files resolved
   - decisions recorded
   - checks run and results
   - any remaining high-risk areas for reviewer attention

The generated markdown is the review artifact. For each manual file, ensure it
contains the original diff3 conflict, the resolved content snapshot, the
decision kind, summary, rationale, rejected alternatives, verification, and
resolution hash. The PR body from `decisions.ts pr-body` should therefore let a
reviewer compare the conflict with the resolution without reconstructing the
agent session.

Only ask the user before proceeding if a decision is destructive, changes auth,
billing, data deletion, public API compatibility, config schema behavior,
migrations, provider routing, or security posture in a way that cannot be
safely inferred from the existing Kilo changes.

See `script/upstream/README.md` → `Common Pitfalls` for patterns that bite
repeatedly: auto-merged code referencing conflict-block declarations, related
sibling files that need edits but are not unmerged, when to prefer `hybrid`
over `renamed`, function signatures drifting across a conflict boundary, and
why full turbo typecheck is the right catch-all.
