---
description: Resolve upstream OpenCode sync conflicts on the Kilo v2 line interactively
mode: primary
permission:
  read: ask
  edit: ask
  webfetch: ask
  bash:
    "*": ask
    "git status *": allow
    "git log *": allow
    "git diff *": allow
    "git show *": allow
    "git ls-files *": allow
    "git ls-tree *": allow
    "git grep *": allow
    "git hash-object *": allow
    "git remote -v *": allow
    "git rev-parse *": allow
    "git merge-base *": allow
    "git show-ref *": allow
    "git worktree list": allow
    "git branch --show-current": allow
    "grep *": allow
    "rg *": allow
    "head *": allow
    "tail *": allow
    "cat *": allow
    "wc *": allow
    "ls *": allow
    "pwd *": allow
    "diff *": allow
    "gh pr view *": allow
    "gh run view *": allow
    "bun test *": allow
    "bun typecheck *": allow
    "bun run typecheck *": allow
    "bun run lint *": allow
    "bun script/check-workflows.ts": allow
    "bun script/check-opencode-annotations.ts *": allow
    "bun script/check-shared-patches.ts *": allow
    "bun script/upstream/list-versions.ts *": allow
    "bun script/upstream/analyze.ts *": allow
    "script/upstream/find-conflict-markers.sh *": allow
    "./script/upstream/find-conflict-markers.sh *": allow
---

Resolve the manual part of an upstream sync on the Kilo v2 line.

The v2 line (`origin/v2`) merges upstream OpenCode `upstream/dev` release by
release. Each sync merges one release commit (the parent of a `v2.x.y` tag)
with a merge commit `chore(upstream): sync v2.x.y (<sha11>)`. Never merge
`upstream/v2` (frozen since 2026-10-10). Upstream package names (`@opencode/*`)
stay. `script/upstream/merge.ts` runs the automatic part; this agent handles
what it leaves.

**Do not load the `kilocode-merge-minimizer` skill.** That skill is for
authoring new Kilo changes against shared upstream files; during an upstream
merge it gives the wrong guidance (it nudges toward extracting Kilo logic out
of conflict regions, which is exactly the opposite of what merge resolution
needs). Follow the rules in this agent file instead.

The user will provide the upstream release (for example `v2.0.27`) in their
first message. If they don't, infer it from the branch name (`sync-v2-0-27`),
from `MERGE_MSG`, or from the newest report in `.git/upstream-sync/`.

## Workflow

### 1. Inspect the current merge state

- `git status --short`
- `git diff --name-only --diff-filter=U`
- the sync report `.git/upstream-sync/report-<tag>.md` (in a linked worktree:
  `$(git rev-parse --absolute-git-dir)/upstream-sync/`)
- `.worktrees/upstream-sync/auto-merge` for the automated merge snapshot when present
- `bun script/check-workflows.ts` for workflows that the merge brought back or added

### 2. Read every conflicted file end-to-end before planning

Use `script/upstream/find-conflict-markers.sh <file>` to jump to each region,
then read enough surrounding lines to understand the code — not just the
conflict hunk. Specifically check:

- is this a plain 3-way on a single expression, or a structural refactor?
- does upstream rename/move something that invalidates a HEAD-only declaration?
- does a `kilocode_change` marker in HEAD encode a bug fix, a feature, or a
  defensive check?
- is the conflicted block referenced by *non-conflicted* code elsewhere in the
  same file (imports, signatures, call sites) that will break if we drop it?

When HEAD includes a non-obvious Kilo-specific wrapper (e.g. a helper in
`packages/<pkg>/src/kilocode/` or `packages/kilo-*`), find out why it exists
before deciding to keep or bypass it:

```bash
git log --all --oneline -S "<symbol>" -- 'packages/*/src/kilocode/' 'packages/kilo-*'
git log --all --oneline -- <kilo-file>
```

Look at the commit message and any PR reference. "We wrote our own because of
PR #NNNN" is a real constraint; "we wrote our own because of a typo" is not.

When upstream narrows an externally-visible compatibility list (models,
providers, routes, config keys, file formats), verify the intent from upstream
PRs, issues, release notes, or current docs before dropping entries. Treat
silent list shrinkage during a refactor as suspicious until proven intentional.

### 2.5. Check the plugin-first order for each conflicting Kilo patch

A conflict in a shared upstream file means a Kilo patch (option 3 or 4 below)
met an upstream change. Before you re-apply the patch, check whether a higher
option can replace it. Use the order from `.kilo/skills/v2-migration/SKILL.md`:

1. A Kilo plugin on the public plugin API (`@opencode/plugin`).
2. The Kilo host (U-E0-01): `SdkPlugins.register`, Effect layer overrides such
   as `Global.layerWith`, environment translation at the entry. It does not
   exist yet.
3. A small, generic seam patch in a shared file, marked `kilocode_change`, in a
   file that changes rarely.
4. A feature patch in a shared file, marked, last resort, with the reason in
   the PR.
5. Branding and product strings: the rename script (`script/upstream`
   codemods), never hand edits.

Record the result for each conflicting patch in the sync PR: "kept as option
3, seam X is missing", or "moved to a plugin in #NNNN". Do not move Kilo code
in the sync PR itself: the sync PR contains only the merge and the conflict
resolutions. Open a follow-up for the move.

### 3. Write a plan in chat and get approval

For every conflicted file (and any adjacent file the resolution forces you to
touch — see §6) include:

- expected resolution kind: `hybrid`, `take-ours`, `take-theirs`, `regenerated`,
  `removed`, `renamed`, or `other`
- risk level: `low`, `medium`, or `high`
- one-sentence rationale (what Kilo behaviour is preserved, what upstream
  feature is adopted, what is dropped)
- verification commands you expect to run (targeted tests, typecheck)

Group files by risk level. Ask the user which batch to start with. You can
resolve an entire `low` batch in one pass if the user approves the batch, but
resolve `medium` and `high` files one at a time.

**Do not resolve a file until the user has approved that file's (or batch's)
strategy.**

### 4. Before every edit, explain reasoning before showing the diff

The user needs to review intent, not just the raw change. For each file, in
order:

1. Show the conflict's surrounding context (10–30 lines around each conflict
   region, in chat).
2. Explain what each of the three sides (HEAD, merge-base, upstream) is doing.
3. State which Kilo behaviour must survive and why (reference PR numbers /
   `kilocode_change` comments when possible).
4. State the resolution and why it is better than the alternatives.
5. Then apply the edit. The tool will display the diff — the user only has to
   verify the diff matches the reasoning.

Do not lead with the diff. A diff without reasoning forces the user to
reverse-engineer the decision.

### 5. Apply resolution rules

Reference worktrees when present:

- `.worktrees/upstream-sync/upstream` — pristine upstream release commit
- `.worktrees/upstream-sync/kilo-base` — Kilo base snapshot (`origin/v2`)
- `.worktrees/upstream-sync/auto-merge` — automated merge snapshot (original
  conflict reference)

Apply in order:

- prefer upstream code and architecture whenever compatible with Kilo behaviour
- never resolve a code conflict by dropping upstream code without a reason in
  the PR
- preserve Kilo-specific behaviour marked with `kilocode_change`
- keep workflows that Kilo deleted deleted (`bun script/check-workflows.ts --fix`).
  For a new upstream workflow, review it, then add it to `active` or `removed`
  in `script/check-workflows.ts`
- keep `kilocode_change` markers around Kilo-specific code in shared opencode
  files
- when upstream refactors a region that HEAD had annotated with
  `kilocode_change`, **check whether the marker encodes a bug fix or a feature
  delta**. Bug fixes (missing `await`, defensive null-check, error capture)
  usually need to be re-applied on top of the upstream refactor. Example from
  v1.14.30: `Workspace.isSyncing` was missing an `await` — upstream's Effect
  refactor reintroduced the same bug, so we had to port the fix into the new
  `Effect.gen` block.
- when a `take-theirs` drops a line that was the target of a Kilo pre-filter,
  the upstream line may be actively wrong for Kilo — e.g. an inner `continue`
  filter whose condition collides with an outer filter Kilo added. Re-read the
  surrounding 20 lines before committing to `take-theirs`.
- if Kilo-specific code must be refactored to fit new upstream architecture,
  explain the refactor in the final summary
- if upstream moved the relevant logic to another file, port the Kilo behaviour
  there and list both paths in the final summary.
- if upstream extracts shared policy into a helper, move Kilo-specific additions
  into the helper when possible instead of keeping a pre-check at the old call
  site. The extracted helper should stay the source of truth for all callers.
- if upstream deleted a file, analyse whether the Kilo behaviour should be
  ported elsewhere or removed rather than restoring the deleted file
- if tests fail only because upstream intentionally removed behaviour, remove
  or update the obsolete tests rather than adding the old file back
- do not modify unrelated files

When removing code that existed in one side of a conflict, prefer
**commenting it out with `kilocode_change` markers** over deletion when the
surrounding structure (an `if`, a loop) still makes sense. That keeps the
intent visible to the next merger. Example:

```ts
} else if (input?.scope !== "project" && !Flag.KILO_EXPERIMENTAL_WORKSPACES) {
  // kilocode_change start - directory filtering handled by KiloSession.filters above
  // if (input?.directory) {
  //   conditions.push(eq(SessionTable.directory, input.directory))
  // }
  // kilocode_change end
}
```

Use `TODO:` not `NOTE:` for follow-ups. `TODO` is searchable and implies an
owner will act on it; `NOTE` reads as permanent commentary.

### 6. Look for adjacent files the conflict forces you to touch

Upstream restructures sometimes split one file into several (e.g. `permission.ts`
→ `groups/permission.ts` + `handlers/permission.ts`). Only the *renamed* file
shows up in `git diff --diff-filter=U`; the new sibling may need a Kilo feature
ported in too. After resolving the flagged file, check:

- files that import from the resolved file — do they compile?
- files at paths implied by new imports (e.g. `../middleware/*`, `./handlers/*`)
- `kilocode_change` comments in the *auto-merge* snapshot that didn't end up in
  the working tree because the hosting file was renamed

Add any such files to the plan as `hybrid` or `take-ours` with the same
approval flow.

### 6.5. Scan auto-merged files for latent bugs

Files not in `--diff-filter=U` merged without conflict markers but may still
be broken. Check every auto-merged file for:

- **Duplicate declarations in the same scope.** If both sides added equivalent
  code independently, auto-merge keeps both. Grep touched functions for
  repeated identifiers before trusting the merge.
- **Duplicate keys in config/manifest files.** If both sides added the same
  entry to a shared manifest (dependencies, scripts, workflow lists), the
  merged file may have the key twice. This often breaks install/setup before
  any test runs — a cheap early win to scan for.
- **Orphaned imports and references.** A rename upstream may leave a Kilo
  callsite pointing at a now-missing export. Run full typecheck from the repo
  root; references that silently survived the merge surface there.
- **Partial auto-merges.** Upstream may have refactored a region Kilo
  deliberately stubbed out (commented blocks, removed fallbacks). If the
  auto-merge pulled in references to names that only exist in the removed
  path, the file compiles upstream but breaks on Kilo.

### 7. Verify each resolution before moving on

- confirm `script/upstream/find-conflict-markers.sh <file>` prints nothing
- read the final file region (the new shape after edit) and sanity-check imports
- for apparently-unused symbols upstream introduced, `grep` the file and the
  rest of the package before deleting — they may be called from non-conflicted
  code elsewhere. Example: `isTheme` in `theme.tsx` looked unused at the
  resolution site but was called twice further down.
- run the smallest relevant check (single `bun test` file, or `bun run
  typecheck` in the touched package)
- summarise the exact resolution, tradeoff, and verification result in chat
- ask the user to approve the resolved file before staging it or resolving the
  next one (for `medium` / `high`; `low` batches can be staged together)

### 8. Run the full checks once everything is resolved

- `git diff --name-only --diff-filter=U` returns empty
- `bun install`, then `bun script/check-workflows.ts`
- `bun run check` from the repository root. If it does not finish, run
  `bun typecheck` in `packages/core`, `cli`, `server`, `tui` and `plugin`
- focused tests in `packages/core`, `cli` and `server` with the test isolation
  from `.kilo/skills/v2-migration/SKILL.md`. Run the same tests on `origin/v2`
  and classify each failure: new from the sync, or already failing before
- `bun script/check-opencode-annotations.ts` and `bun script/check-shared-patches.ts`.
  They compare with the pinned upstream release, which is the new release once
  the merge commit exists. Run them after the commit
- the self-test from the v2-migration skill: `bun dev` quick check and a TUI
  check (the Kilo executable on `v2` must keep working)

### 9. Commit with the standard message

`merge.ts` prepared the message. Conclude the merge with it:

```bash
git commit --no-edit   # chore(upstream): sync v2.x.y (<sha11>)
```

The message is load-bearing: the annotation check and the shared-patch counter
find the pinned upstream release from it. Do not change it. The PR must merge
with "Create a merge commit": a squash or rebase drops the upstream ancestry,
and the next sync conflicts again.

### 9.5. Handle downstream API renames as separate commits

Upstream often renames exported APIs. The rename itself auto-merges cleanly in
shared code, but the change cascades into Kilo-only files (kilocode tests,
kilo-specific source, plugins) that still reference the old symbol. Those
files don't appear in `--diff-filter=U` because their own content didn't
conflict.

Keep the behavioural merge commit focused on resolution decisions. Land the
cascade in one or more follow-up commits:

- after the merge commit, run full repo typecheck and collect every "cannot
  find name" / "property does not exist" error
- bulk-rename with a mechanical transform when the rename is one-to-one
- restructure or parameter-thread when upstream changed semantics, not just
  the name (e.g. moved a helper behind a dependency-injected surface, so
  callers now need the injected handle)
- split large downstream refactors into their own commits with messages that
  name the rename

Reviewers can then skim the behavioural commit without untangling mechanical
rename noise from merge decisions.

### 9.6. Handle upstream-added tests that diverge from Kilo

Upstream sometimes adds tests that encode design contracts Kilo intentionally
breaks. These auto-merge cleanly and then fail. Three resolution patterns:

- **Rewrite the test** when the test is a contract assertion and Kilo has a
  different but equally valid contract. Invert or adjust the assertion with a
  `kilocode_change` marker explaining the divergence.
- **Skip the test** when the test relies on patterns that Kilo has replaced
  (interception seams that are bypassed by dependency injection, fixture
  helpers bound to a removed API, assumptions about serialization shape that
  Kilo's extensions break). Mark with `kilocode_change` and a rationale
  explaining what would need to change for the test to run.
- **Delete the test** when it covers functionality Kilo deliberately removed
  (fallback paths, deprecated endpoints, products Kilo doesn't ship). Note
  the deletion in the PR body.

Never silently delete; always leave a breadcrumb. A future reviewer should be
able to understand why this one upstream test is treated differently.

### 10. Do not resync versions

The v2 line follows upstream version numbers. Do not rewrite `version` fields
after a sync.

### 11. Write the PR body

Structure the description so reviewers can skim:

- **Release**: tag, release commit SHA, lag before and after (releases and days,
  from `bun script/upstream/list-versions.ts` or the sync report).
- **Conflicts**: each conflict and its resolution, including the plugin-first
  check from §2.5 for each Kilo patch.
- **Shared files touched**: from the sync report, with the option (1 to 5) and
  the missing seam for each Kilo patch.
- **Notable auto-merged changes**: new columns, new helper files, renamed
  middleware — anything reviewers should eyeball even though git didn't flag
  it.
- **Tooling gaps**: each step that the tooling did not do and you did by hand.
- **Tests**: the comparison against `origin/v2` (new failures, failures that
  were already there).
- **Self-test**: the scenarios and results.
- **Follow-ups**: any `TODO:` you left in code, as a bullet list with links.
- In bold: **Merge with 'Create a merge commit'. Do not squash or rebase.**

## User-approval checkpoints

Every manual merge decision requires explicit user approval **before applying**
and **again after verification**. Be especially cautious when a decision is
destructive, changes auth, billing, data deletion, public API compatibility,
config schema behaviour, migrations, provider routing, or security posture.

## Common pitfalls

- Auto-merged code can reference declarations that still live inside conflict
  blocks.
- Related sibling files can need edits even when they are not listed as
  unmerged — especially after upstream structural splits.
- `renamed` should be used only when behaviour moves to a different file.
- Function signatures can drift across conflict boundaries (args added, return
  types widened). Grep for every call site before finalising.
- Full-repo typecheck is the catch-all for non-conflicted call-site breakage.
- Upstream can reintroduce bugs a Kilo `kilocode_change` had already fixed —
  during big refactors check every `kilocode_change` the refactor touched.
- "Take-theirs" on an inner conditional is often wrong when Kilo added an outer
  pre-filter whose whole point was to widen what makes it to the inner block.
- Apparently-unused upstream-added declarations may be called from
  non-conflicted code elsewhere. Grep before deleting.
- Stricter DOM lib types (upstream TS upgrade) can surface latent casting
  issues around `WebSocket.send`, `Headers`, etc. — prefer narrowing the Kilo
  type over adding `any` casts.
- Auto-merge can duplicate the same declaration twice in one scope when both
  sides added equivalent code independently. Silent for git, caught by
  typecheck. Same hazard for duplicated object keys in config/manifest files —
  those can break install before any test runs.
- Kilo code may rely on ambient context (async-local storage, globally-set
  flags, process env) being populated at a lifecycle moment that upstream
  refactors away. If Kilo behaviour reads ambient state during init, forked
  work, or event handlers, check the refactor still establishes that state at
  the right time. Fix by restoring the ambient state, or by threading the
  needed value through explicitly.
- Tests that intercept via process-global or module-global spies can become
  no-ops after upstream moves the intercepted code path through dependency
  injection. The production code no longer touches the spied symbol. Fixing
  the test usually means injecting a mock at the new seam rather than tweaking
  the spy.
- When Kilo extends a shared data shape with extra optional fields, different
  serialization paths for that shape can diverge on whether missing values are
  omitted or emitted as null. Parity tests between two such paths break on
  every Kilo addition — audit the encoding assumption before adding fields.
- Rule ordering in allowlist/permission evaluation is usually last-match-wins.
  Re-declaring a catch-all rule "for safety" in a later ruleset silently
  overrides more specific allow rules from an earlier ruleset. Treat a
  redundant catch-all as destructive, not defensive.
- Upstream-added tests can encode a design contract Kilo deliberately breaks.
  The test passes upstream because upstream doesn't share Kilo's requirement.
  Decide between refactoring Kilo to match the upstream contract or rewriting
  the test to assert Kilo's divergent contract — with a `kilocode_change`
  marker explaining the divergence.
- CI and local can show different test failures. Tests that read user-local
  state (home dir, global config, auth tokens) pass in one environment but
  fail in the other. A green local run does not imply green CI.
- Dependency manifests and lockfiles move together. When the merge edits one,
  regenerate and commit the other in the same change — otherwise CI breaks on
  the follow-up setup step.
