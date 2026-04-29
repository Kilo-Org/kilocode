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
2. If no decision ledger exists yet, run:
   - `bun script/upstream/decisions.ts init --version <version>`
3. Before editing, write a concise plan in the chat:
   - file-by-file strategy
   - expected decision kind: `hybrid`, `take-ours`, `take-theirs`, `regenerated`, `removed`, `renamed`, or `other`
   - risk level: `low`, `medium`, or `high`
   - verification commands you expect to run
4. Resolve each conflict carefully:
   - preserve Kilo-specific behavior marked with `kilocode_change`
   - adopt upstream changes when they do not conflict with Kilo behavior
   - keep `kilocode_change` markers around Kilo-specific changes in shared opencode files
   - do not modify unrelated files
5. After resolving each file, record the decision before staging it:
   - `bun script/upstream/decisions.ts add --version <version> --file <path> --kind <kind> --risk <risk> --summary "..." --rationale "..." --alternative "..." --verification "..."`
   - include at least one rejected alternative for non-trivial `hybrid`, `take-ours`, or `take-theirs` choices
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

Only ask the user before proceeding if a decision is destructive, changes auth,
billing, data deletion, public API compatibility, config schema behavior,
migrations, provider routing, or security posture in a way that cannot be
safely inferred from the existing Kilo changes.
