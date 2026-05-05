---
description: Resolve upstream merge conflicts
---

Resolve the manual part of an upstream merge.

Arguments: `$ARGUMENTS`

Use the first argument as the upstream version, for example `v1.1.50` or
`1.1.50`. If no argument is provided, infer the version from the current branch
name, `upstream-merge-report-<version>.md`, or the newest relevant report file.

Workflow:

1. Inspect the current merge state:
   - `git status --short`
   - `git diff --name-only --diff-filter=U`
   - `upstream-merge-report-<version>.md` when present
   - `.worktrees/opencode-merge/auto-merge` for the automated merge snapshot when present
2. Before editing, write a concise plan in the chat:
   - file-by-file strategy
   - expected resolution kind: `hybrid`, `take-ours`, `take-theirs`, `regenerated`, `removed`, `renamed`, or `other`
   - risk level: `low`, `medium`, or `high`
   - verification commands you expect to run
3. Ask the user to approve the plan before applying any manual conflict
   resolution. Do not resolve a file until the user has approved that file's
   strategy.
4. Resolve each conflict carefully, one file at a time.

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
   - if Kilo-specific code must be refactored to fit new upstream architecture, explain the refactor in the final summary
   - if upstream moved the relevant logic to another file, port the Kilo behavior there and list both paths in the final summary
   - if upstream deleted a file, analyze whether the Kilo behavior should be ported elsewhere or removed rather than restoring the deleted file
   - if tests fail only because upstream intentionally removed behavior, remove or update the obsolete tests rather than adding the old file back
   - do not modify unrelated files
5. After each file is resolved, verify the decision before moving on:
   - inspect the resolved file and confirm it has no conflict markers
   - compare against the opencode, kilo-main, and auto-merge references when present
   - run the smallest relevant check for that file when practical
   - summarize the exact resolution, tradeoff, and verification result in chat
   - ask the user to approve the resolved file before staging it or resolving the next file
6. Run the appropriate checks:
   - stage resolved files with `git add -A` so git no longer reports unmerged paths
   - if `packages/opencode/` shared files changed, run `bun run script/check-opencode-annotations.ts`
   - run targeted typechecks/tests when practical for touched packages
   - run `bun run typecheck` from the repo root before declaring the merge ready
7. Finish with:
   - files resolved
   - resolution choices and rationale
   - checks run and results
   - any remaining high-risk areas for reviewer attention

Every manual merge decision requires explicit user approval before applying and
again after verification. Be especially cautious when a decision is destructive,
changes auth, billing, data deletion, public API compatibility, config schema
behavior, migrations, provider routing, or security posture.

Common pitfalls to watch for:
- auto-merged code can reference declarations that still live inside conflict blocks
- related sibling files can need edits even when they are not listed as unmerged
- `renamed` should be used only when behavior moves to a different file
- function signatures can drift across conflict boundaries
- full repo typecheck is the catch-all for non-conflicted call-site breakage
