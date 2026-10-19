# Upstream sync tooling (Kilo v2 line)

Scripts to sync Kilo's `v2` branch with upstream OpenCode, release by release, and to keep Kilo's patches in shared upstream files small and visible.

- Integration branch: `origin/v2`. Upstream source: `upstream/dev` (upstream's v2 line since 2026-10-10). Never merge `upstream/v2`: it is frozen at `4617210822b`.
- Each sync merges one **release commit**: the parent of a `v2.x.y` tag. Upstream tags a version-bump commit next to `dev`, so the tag itself is not on the branch.
- Sync each release in order, at least weekly. One PR per release, from a branch off `origin/v2`.
- The merge commit message is `chore(upstream): sync v2.x.y (<sha11>)`. The checks use it to find the pinned upstream release.
- **Merge the PR with "Create a merge commit". Never squash or rebase**: that drops the upstream ancestry, and the next sync conflicts again.
- Upstream package names (`@opencode/*`) stay until decision D-1. The package-name transform and the branding codemods are in the code but off in `utils/config.ts`.

v1 (`main`) keeps its own copy of this tooling. This copy is for the v2 line only.

## Quick start

```bash
git remote add upstream https://github.com/anomalyco/opencode.git   # once
bun install --cwd script/upstream                                     # once, for the codemods (ts-morph)

bun script/upstream/list-versions.ts              # releases, which ones v2 has, next target, lag
bun script/upstream/analyze.ts                    # dry run of the next sync: conflicts, new workflows, shared files touched
bun script/upstream/merge.ts                      # merge the next release into a new branch sync-v2-x-y from origin/v2
bun script/upstream/merge.ts --version v2.0.27    # a given release
```

In an Agent Manager worktree that is already on a fresh branch from `origin/v2`, merge in place: `bun script/upstream/merge.ts --base-branch HEAD`.

## What `merge.ts` does

1. Checks the `upstream` remote and a clean working tree. mergiraf is optional (`brew install mergiraf`).
2. Fetches `upstream/dev` with tags, and `origin/v2`.
3. Picks the target: the next release that the base does not have, or `--version`. It refuses a target that skips an older release (`--allow-skip` overrides) and a commit that is not on `upstream/dev`.
4. Analyzes the merge with `git merge-tree` and prints the report: conflicts with a recommendation, new upstream workflows, shared files that Kilo patched and upstream changed, commits added to history, harness change size, and the lag before and after (releases and days).
5. Creates `sync-v2-x-y` from `origin/v2` (or uses the current branch with `--base-branch HEAD`), enables rerere and trains it from earlier sync merges.
6. Runs `git merge --no-ff --no-commit` with the sync message, then resolves what it can:
   - `bun script/check-workflows.ts --fix`: removes workflows that Kilo dropped. This also resolves their modify/delete conflicts.
   - `skipFiles`: removes upstream changes and additions under the product areas Kilo removed (desktop, web app, hosted platform, see `utils/config.ts`). This also resolves their modify/delete conflicts.
   - `keepOurs` and Kilo-owned paths (`utils/owned.ts`): keep Kilo's version.
   - mergiraf: syntax-aware resolution, staged only when no marker is left.
   - package.json: `transforms/transform-package-json.ts` (take upstream, re-apply Kilo's listed fields).
   - Branding transforms: only when `transforms.branding` is on.
   - Lock files: keep ours, then regenerate with `bun install` (only with the Bun version from `packageManager`).
7. Runs `bun script/check-workflows.ts` and lists unexpected workflows.
8. If conflicts or unexpected workflows are left, it stops with the merge in progress and writes the report. Otherwise it commits the merge, runs `script/check-opencode-annotations.ts` and `script/check-shared-patches.ts`, and writes the report.

Reports go to `$(git rev-parse --absolute-git-dir)/upstream-sync/report-<tag>.md`, so they are never committed.

### Options

| Option | Use |
|---|---|
| `--version <tag>` | Release to sync, for example `v2.0.27` |
| `--commit <sha>` | Pin a commit on `upstream/dev`. Only for an unreleased fix that Kilo needs |
| `--base-branch <name>` | Base branch (default `v2`, read from `origin/v2`). `HEAD` merges into the current branch in place |
| `--branch <name>` | Sync branch name (default `sync-v2-x-y`) |
| `--dry-run`, `--report-only` | Analysis and report only |
| `--allow-skip` | Allow a target that skips older releases |
| `--no-fetch` | Do not fetch |
| `--no-worktrees` | No read-only reference worktrees |
| `--no-install` | Do not regenerate lock files |
| `--push` | Push the sync branch after the merge commit (off by default) |
| `--output <path>` | Report path |

Reference worktrees (`.worktrees/upstream-sync/`): `upstream` (pristine release commit), `kilo-base` (the base before the merge) and `auto-merge` (the automated merge with its conflicts). They are read-only evidence.

## Resolving what is left

- Keep Kilo's `kilocode_change` lines and take upstream's other changes. Never drop upstream code without a reason in the PR.
- When a conflict hits a Kilo patch, check the plugin-first order before you re-apply it, and record the result in the sync PR:
  1. Kilo plugin on the public plugin API (`@opencode/plugin`).
  2. Kilo host (U-E0-01): `SdkPlugins.register`, Effect layer overrides such as `Global.layerWith`, environment translation at the entry. It does not exist yet.
  3. Small, generic seam patch in a shared file, marked `kilocode_change`, in a file that changes rarely.
  4. Feature patch in a shared file, marked, last resort, with the reason in the PR.
  5. Branding and product strings: the rename script (codemods below), never hand edits.

  Move the code in a follow-up PR: the sync PR contains only the merge and the conflict resolutions.
- New upstream workflow: review it, add it to `active` or `removed` in `script/check-workflows.ts`, then `bun script/check-workflows.ts --fix`.
- Conclude with `git commit --no-edit` to keep the sync message.
- `.kilo/agent/upstream-merge.md` has the detailed resolution workflow.

## Verify a sync

```bash
bun install
bun script/check-workflows.ts
bun run check                                   # or bun typecheck in packages/core, cli, server, tui, plugin
bun script/check-opencode-annotations.ts
bun script/check-shared-patches.ts
bun script/upstream/progress.ts --check           # regenerate with `bun script/upstream/progress.ts` when it fails
```

Then run focused tests in `packages/core`, `cli` and `server` with the test isolation from `.kilo/skills/v2-migration/SKILL.md`, run the same tests on `origin/v2`, and classify each failure as new or already failing. Self-test the CLI as the skill describes (`VERIFICATION_TEST.md`).

The sync PR body gives: release and SHA, lag before and after, each conflict and its resolution, shared files touched, tooling gaps, the test comparison, self-test evidence, and in bold: **Merge with 'Create a merge commit'. Do not squash or rebase.**

## Shared-patch checks

Both checks compare the tree with the pinned upstream release commit: the second parent of the newest `chore(upstream): sync` merge in the history, or the initial base of `v2` (`5e73d5cb1f7`, release commit of v2.0.26) before the first sync. They need no network, only a full history.

- `bun script/check-opencode-annotations.ts [--worktree] [--pin <ref>]`: fails on a Kilo line in a shared upstream file without a `kilocode_change` marker. A file that cannot carry markers (JSON) needs an `unmarked` reason in `shared-patches.json`.
- `bun script/check-shared-patches.ts [--worktree] [--json] [--pin <ref>]` (U-L3-01): prints each shared file that Kilo adds or changes, its marked and unmarked lines, and the shared files Kilo deleted. It fails when a shared file has no entry in `shared-patches.json` (rung and missing seam), or when a count grows above its limit. A PR that adds a shared patch adds the entry and raises the limit in the same diff. Deleted workflows are not counted: `script/check-workflows.ts` governs them. Paths in `skipFiles` are not shared files and are not counted. Generated files (`bun.lock`, listed in `utils/owned.ts`) are listed but not counted: they follow from the `package.json` files, so a new Kilo-owned package does not trip the checks.

CI runs both in `.github/workflows/kilo-v2.yml` (job `shared upstream patches`), and the tests of this directory (job `upstream sync tooling tests`).

## Progress map

`bun script/upstream/progress.ts` generates `migration-tracking/progress/README.md`, `progress.json`, `progress.svg` (treemap: one box per feature, green done, grey open, yellow dropped) and `history.svg` (one point per day, read from the committed `progress.json` files on the first-parent history): Kilo's v1 delta as cells per feature (modules, API operations, patches, tests), each checked against the v2 working tree. A patch cell closes with a done-proof that carries its ID: `kilocode_change(<feature>:<id>)` in a shared upstream file or `kilo_port(<feature>:<id>)` in a Kilo-owned file; the map records the rung where it landed (plugin, host, seam, patch). The summary also carries two ratchets: the core-internal upstream modules that Kilo packages and adapters import (the run fails when a `packages/kilo-*-core` logic package imports `@opencode/*`), and the shared patches by rung in `shared-patches.json`. Inputs are `migration-tracking/progress/features.json` (pins, feature split, exclusions), `dispositions.json` (decisions per cell) and `shared-patches.json` (rungs). `--check` fails when the committed output is stale (CI job `migration progress map`); `--list <feature>` prints the open cells of one feature; `--compare <base.json> <head.json> [<pr.diff>]` prints the markdown delta that the CI job `migration progress comment` posts on every same-repository pull request (one comment, updated per push, with the treemap of the head commit). With the PR diff it adds the placement line: new marked lines in shared files by rung, new `kilo_port` annotations and new core-internal imports. `badge.svg` and the two charts are embedded in the root `README.md` inside a marked block. The pins name the v1 target (a `main` commit) and the upstream commit it was synced to. Move them together when the v1 reference moves, in a PR of their own, and expect patch IDs of changed hunks to change with them; `dispositions.json` entries and done-proofs that no longer resolve fail the run and must be updated in the same PR. `.kilo/skills/v2-migration/SKILL.md` describes how a port closes cells.

## Per-file tools

| Command | Use |
|---|---|
| `bun script/upstream/fix-kilocode-markers.ts <file> [--dry-run]` | Rebuild the markers of one shared file from its diff with the pinned upstream release. It refuses a file where Kilo deleted upstream lines (the standalone marker that explains a deletion would be lost) unless `--force` |
| `bun script/upstream/reset-to-upstream.ts <file> [--dry-run]` | Reset one file to the pinned upstream release (with the enabled transforms). It refuses a file listed in `shared-patches.json` unless `--force` |
| `bun script/upstream/find-reset-candidates.ts [path] [--dry-run]` | Find shared files whose diff with upstream is only `kilocode_change` markers, and reset them. Whitespace-only and small real diffs are listed for review, never reset, and files in `shared-patches.json` are skipped |
| `script/upstream/find-conflict-markers.sh <file>` | Print the conflict markers of a file |

## Transforms and codemods

| Tool | v2 state |
|---|---|
| `transforms/keep-ours.ts` | On. Kilo-owned paths and `keepOurs` (empty on v2) |
| `transforms/skip-files.ts` | On. `skipFiles` lists the upstream product areas Kilo removed. Workflows go through `script/check-workflows.ts` |
| `transforms/lock-files.ts` | On. Keep ours, regenerate with the pinned Bun |
| `transforms/transform-package-json.ts` | On for conflicted package.json files. Re-applies Kilo's root `dev` and `lint` scripts |
| `transforms/package-names.ts` | Off until decision D-1 (`transforms.packageNames`). Package renames apply to Kilo-owned code too (for example `packages/kilo-plugin` imports `@opencode/plugin`), so Kilo imports follow the rename |
| `transforms/preserve-versions.ts` | Off: v2 follows upstream version numbers (`transforms.versions`) |
| `transforms/transform-i18n.ts`, `transform-take-theirs.ts`, `transform-scripts.ts`, `transform-extensions.ts`, `transform-web.ts` | Off until rebranding (`transforms.branding`) |
| `codemods/transform-strings.ts`, `codemods/transform-imports.ts` | Off until rebranding. Default is a dry-run report of each change; `--apply` writes |

Brand-text tools never touch Kilo-owned paths (`utils/owned.ts`); package-name tools (`package-names.ts`, `transform-imports.ts`) do, so Kilo imports follow a rename. Each branding CLI prints a dry-run report by default (`bun script/upstream/codemods/transform-strings.ts`). `--apply` writes, and refuses while the switch is off unless `--force` is given.

## Not ported from v1 (yet)

| v1 tool | Reason |
|---|---|
| `opencode-changesets.ts`, `script/kilocode/changeset-version.ts` | Postponed. The v2 line has no changesets yet. Port them (as in v1: one changeset per sync with the upstream release notes) with the first v2 channel release |
| `transforms/remove-kilo-web.ts` | Its target (`WebCommand` in `packages/opencode/src/index.ts`) does not exist on v2 |
| Pre-merge compatibility branch (`refactor: kilo compat for`) and `.opencode-version` | It pre-applied the renames to upstream so they did not conflict. With renames off it only adds a commit. The pin comes from the sync merge message instead. Bring it back when the rename transforms turn on (D-1, rebranding) |
| Version resync after a merge | v2 follows upstream version numbers |
