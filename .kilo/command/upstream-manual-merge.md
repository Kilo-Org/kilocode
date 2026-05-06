---
description: Resolve upstream merge conflicts
---

Resolve the manual part of an upstream merge.

Arguments: `$ARGUMENTS`

Use the first argument as the upstream version, for example `v1.1.50` or
`1.1.50`. If no argument is provided, infer the version from the current branch
name, `upstream-merge-report-<version>.md`, or the newest relevant report file.

## Workflow

### 1. Inspect the current merge state

- `git status --short`
- `git diff --name-only --diff-filter=U`
- `upstream-merge-report-<version>.md` when present
- `.worktrees/opencode-merge/auto-merge` for the automated merge snapshot when present

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
`packages/opencode/src/kilocode/`), find out why it exists before deciding to
keep or bypass it:

```bash
git log --all --oneline -S "<symbol>" -- packages/opencode/src/kilocode/
git log --all --oneline -- <kilo-file>
```

Look at the commit message and any PR reference. "We wrote our own because of
PR #NNNN" is a real constraint; "we wrote our own because of a typo" is not.

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

- `.worktrees/opencode-merge/opencode` — pristine upstream tree
- `.worktrees/opencode-merge/kilo-main` — Kilo base snapshot
- `.worktrees/opencode-merge/auto-merge` — automated merge snapshot (original
  conflict reference)

Apply in order:

- prefer upstream code and architecture whenever compatible with Kilo behaviour
- preserve Kilo-specific behaviour marked with `kilocode_change`
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
  there and list both paths in the final summary. Verify the new file already
  carries the Kilo-renamed symbols (e.g. `x-kilo-directory`) by diffing against
  pristine upstream.
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
- `bun run typecheck` from `packages/opencode/` (targeted) and from repo root
  (catches non-conflicted call-site breakage)
- relevant targeted tests. Tests that hang or time out in an unrelated part of
  the graph may be pre-existing — note them, don't block the merge on them
- `bun run script/check-opencode-annotations.ts` if `packages/opencode/` shared
  files changed. Note that this tool compares against the merge base via `HEAD`
  and will be silent until the merge commit lands
- other CI guards that touched files imply (knip for `kilo-vscode/`,
  `check-kilocode-change`, source-links, visual regression)

### 9. Commit with the standard message

Per `script/upstream/README.md`:

```bash
git commit -m "resolve merge conflicts"
```

The default `git merge` auto-message (`Merge branch '…' into …`) is also fine,
but `resolve merge conflicts` is the convention for these PRs.

### 10. Resync version strings in a separate commit

Upstream stamps its own version into shared files — notably
`packages/extensions/zed/extension.toml` (version field + 5 Kilo-Org download
URLs), and any `package.json` that upstream bumped in the same release window.
After the merge this leaves parts of the tree pointing at upstream's version
(e.g. `1.14.30`), whose release tag does not exist on Kilo's pipeline, so the
Zed download URLs silently 404.

Fix this in a dedicated commit *after* `resolve merge conflicts`:

```bash
bun run script/sync-versions.ts             # uses root package.json version
# or, to target an explicit version:
bun run script/sync-versions.ts 7.2.41
git add -A
git commit -m "chore: resync versions after upstream merge"
```

The script rewrites every top-level `"version"` in `package.json` files
(excluding `node_modules`, hidden dirs, and `packages/kilo-jetbrains/` which
tracks its own cadence), plus the Zed extension toml. It is idempotent — rerun
it any time to rebase the version back onto Kilo main (useful during
long-running upstream merges where `main` releases in the meantime).

Keeping this in its own commit makes reviewers' job easier: the merge commit
only contains behavioural resolutions, and the version resync is a trivial
diff they can skim in one glance.

### 11. Write the PR body

Structure the description so reviewers can skim:

- **Non-trivial merge decisions**: a short section per file (or group of
  related files) that required more than a mechanical `take-ours`/`take-theirs`.
  Focus on *what Kilo behaviour survived* and *what upstream features were
  adopted*. Link to Kilo PRs when a `kilocode_change` encodes a specific fix.
- **Notable auto-merged changes**: new columns, new helper files, renamed
  middleware — anything reviewers should eyeball even though git didn't flag
  it.
- **What to test**: explicit, scenario-level test steps for each non-trivial
  change. Don't list tests; list *user-visible behaviour* so a tester who
  doesn't read the diff can exercise it.
- **CI guards to watch**: typecheck, knip, annotation check, visual regression.
- **Follow-ups**: any `TODO:` you left in code, as a bullet list with links.

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
