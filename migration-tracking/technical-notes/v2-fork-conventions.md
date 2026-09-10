# Kilo OpenCode v2 fork conventions

Rules for working on the Kilo product line built on `upstream/v2`. Companion to
`migration-tracking/plans/kilo-opencode-v2-plan-progress.md` (scope and phases) and
`migration-tracking/technical-notes/baseline/pinned-v2-baseline.md` (refs, commands, known-red checks).

These rules govern the v2 line only. Kilo `origin/main` keeps its own
conventions.

## Upstream snapshot tracking

- The v2 line is based on a **pinned `upstream/v2` SHA**, currently
  `76dbaf20adbd43fd208a00ef3cda4a51e125a234`. `upstream` is
  `https://github.com/anomalyco/opencode.git`.
- Never treat "latest `upstream/v2`" as the base. Every slice records the SHA it
  was validated against.
- To adopt a newer upstream snapshot: fetch, record the new SHA and its merge
  base in `migration-tracking/technical-notes/baseline/pinned-v2-baseline.md`, merge it into the
  integration branch, re-run the baseline checks, and diff the failure list
  against the previous baseline before declaring the bump clean.
- Snapshot every upstream SHA the branch has consumed. If a recorded SHA stops
  being reachable from `upstream/v2`, upstream rewrote history: stop, assess a
  new integration base, and do not force-push the Kilo branch to match.
- `upstream/dev` is a sibling line, not an ancestor. `upstream/dev` and
  `upstream/v2` diverged at `0e2dd4ad`; do not assume a dev fix reached v2.

## Branches

- **Integration branch:** `johnnyeric/kilo-opencode-v2`. Long-lived, based on
  the pinned snapshot. One clean worktree owns it. It is not a feature
  worktree.
- **Slice branches:** `johnnyeric/v2-<slice>`, branched from the current
  integration branch, one writing agent each. This slice is
  `johnnyeric/v2-baseline`.
- Slice work targets `johnnyeric/kilo-opencode-v2`. Never `main`, never
  `upstream/v2`.
- **Merge forward, never rebase the integration branch.** Merge `upstream/v2`
  and merged slices into it; its history is shared and must stay stable. An
  unmerged slice branch may be rebased or recreated freely.
- Upstream's root `AGENTS.md` asks for short slash-free branch names such as
  `session-recovery`. The Kilo fork overrides that: use the `johnnyeric/`
  prefix so fork branches are distinguishable from upstream branches in a
  shared checkout. Upstream's conventional-commit rule (`type(scope): summary`,
  types `feat|fix|docs|chore|refactor|test`) does apply and matches Kilo's.

## Dev-fix triage lane

Fixes landing on `upstream/dev` or Kilo `origin/main` do not reach the v2 line
automatically. Each candidate gets an explicit classification before any port:

- `not-applicable` — the v2 architecture removed the affected code path.
- `already-fixed` — upstream v2 fixed it independently; record the v2 commit.
- `port` — re-implement against v2. Cherry-pick only when the commit is
  isolated and its provenance and dependencies are understood; re-implementing
  is the default.
- `defer` — real on v2 but out of the current phase; record why.

Track these in the parity ledger's dev-line lane, not in commit messages.

## Kilo-owned paths

Prefer new Kilo-owned files over edits to upstream files. Conflicts on every
upstream merge are the cost of shared-file edits.

| Path | Purpose |
|---|---|
| `migration-tracking/technical-notes/` | Fork documentation and tooling that is not part of any package: this file, `baseline/`, `script/`. |
| `packages/<pkg>/src/kilocode/` | Kilo modules inside an upstream package, following Kilo main's existing convention. |
| `packages/<pkg>/test/kilocode/` | Their tests. |
| `plans/` | Shared with upstream, but Kilo plan documents are new files only — never edit an upstream plan. |

Do not fork or rename an upstream package to add Kilo behavior. Do not
reconstruct the legacy `packages/opencode` tree; it does not exist on v2.

### Markdown tables in Kilo-owned files

Kilo main's `AGENTS.md` forbids padded markdown tables, and that rule carries to
the v2 line. Use the compact form: a minimal separator row and exactly
single-space-padded content cells.

```
| Command | What it runs |
|---|---|
| `bun typecheck` | Every package, through turbo. |
```

Not the padded form, which makes a one-cell edit rewrite every row and blows up
the diff:

```
| Command                       | What it runs                   |
| ----------------------------- | ------------------------------ |
| `bun typecheck`               | Every package, through turbo.  |
```

Unlike Kilo main, this tree does **not** exclude markdown from prettier — its
`.prettierignore` lists four generated paths and nothing else — so
`prettier --write` over a Kilo-owned document will re-pad every table. Do not run
it over `kilocode/` or Kilo plan documents. Nothing enforces this yet: no v2
workflow runs prettier, and `script/check-md-table-padding.ts` is a Kilo main
script with no v2 equivalent, so the rule is currently upheld by review.

This applies to Kilo-owned markdown only. Leave upstream documents formatted the
way upstream formats them.

The only shared upstream file this slice edits is the root `AGENTS.md`, which
gains a marked two-line pointer to this document and to the baseline report.
That is the intended shape of a shared hook: without it, agents in this
checkout follow upstream's conventions and never find these rules.

## Narrow shared hooks

When a Kilo capability genuinely needs upstream code to call it:

- Add the smallest possible registration or dispatch point, and put the logic in
  a Kilo-owned module the hook imports.
- Do not refactor, reformat, or restructure surrounding upstream code in the
  same change. A hook diff should be readable as a few added lines.
- Respect v2's dependency direction — Schema to Core/Protocol to Server, then
  generated clients. Client runtime code may depend on Schema and Protocol,
  never on Core or Server.
- Never hand-edit generated output (`packages/client/src/generated*`,
  `packages/protocol/openapi.json`, `packages/www/openapi.json`). Regenerate
  with `bun run generate` from `packages/client` and report generated diffs
  separately from handwritten ones.

## `kilocode_change` markers

- Mark every Kilo edit inside a shared upstream file with a `kilocode_change`
  comment saying what changed and why, so upstream merges show the intent.
- Do not mark Kilo-owned files. A file under `kilocode/` or `src/kilocode/` is
  Kilo by construction; markers there are noise. This also applies to Kilo-owned
  packages such as `packages/kilo-ide-ui`, including source relocated from a
  shared v1 package. Record the destination package/file in the v1-to-v2 mapping
  table and remove inherited markers, retaining useful explanatory comments.
- Preserve existing markers when resolving an upstream merge. Resolve in favour
  of the current v2 architecture first, then reapply the Kilo invariant through
  its owned seam.
- Removing a marker from a shared upstream file requires explaining whether its
  behavior was removed or relocated. Removing redundant markers from Kilo-owned
  files does not remove the behavior; record that distinction in the report.

## Validation

The authoritative commands come from this v2 tree, not from Kilo main, and are
listed in `migration-tracking/technical-notes/baseline/pinned-v2-baseline.md`. In short: `bun install`,
`bun typecheck`, `GITHUB_ACTIONS=false bun turbo test`, `bun run check:generated`
in `packages/client` and `packages/www`, and the `packages/cli` build plus
service smoke.

- Tests cannot run from the repo root; use `bun turbo test` or a package
  directory.
- Use `bun typecheck`, never `tsc` directly.
- Pristine upstream v2 is already red at the pinned SHA. Before attributing a
  failure to a slice, check it against the failure inventory in
  `migration-tracking/technical-notes/baseline/pinned-v2-baseline.md`, or re-run
  `bun migration-tracking/technical-notes/script/v2-baseline.ts --checks` on a clean checkout of the pin.
- Report handwritten and generated diffs separately, and never report a check as
  passing without having run it.
