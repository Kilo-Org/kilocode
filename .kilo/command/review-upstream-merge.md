---
description: Review an upstream sync or a feature PR on the Kilo v2 line and write reports
---

Review $1.

This repository is the Kilo v2 line. The integration branch is `origin/v2`. Upstream syncs merge one release commit of `upstream/dev` (the parent of a `v2.x.y` tag) with a merge commit `chore(upstream): sync v2.x.y (<sha11>)`. Kilo-owned paths need no markers: see `script/upstream/utils/owned.ts`. The plugin-first order (`.kilo/skills/v2-migration/SKILL.md`): 1 Kilo plugin, 2 Kilo host (U-E0-01), 3 small seam patch, 4 feature patch (last resort), 5 rename script for branding.

Branch off so we have all the code for the reviewed PR. Then run the following reviews in parallel, using one subagent per review, and save each result in the named markdown file at the repository root. A human will read those files, so if in doubt add a finding for human verification.

When all subagents are done, commit the report files and create a draft PR with the reviewed PR branch as base.

Do not include exhaustive per-file checklists in the report files. Summarize the scope and methodology, then list only findings, notable non-findings, command outputs, and limitations.

## KILOCODE_CHANGE_MARKERS.md

Review carefully, file by file, whether we accidentally removed any `kilocode_change` marker.

Get the full list of files changed in the reviewed PR. Check each changed file. For each file, compare `origin/v2` (the PR base) and the version in the reviewed PR. Determine whether any marker removal, marker move, or Kilo-specific change makes sense, and comment on that.

Do not include a full "Files Checked" section. Mention the number of changed files checked, but only list files that have findings or need human verification.

## SHARED_PATCHES.md

Check the shared upstream files in the PR against the plugin-first order.

- Run `bun script/check-shared-patches.ts` and `bun script/check-opencode-annotations.ts` on the PR head and on `origin/v2`. Report both outputs.
- For each shared upstream file that the PR adds or changes (feature PR) or where a sync conflict touched a Kilo patch (sync PR), check that the PR states the option (1 to 5) and the missing seam, and that `script/upstream/shared-patches.json` has an entry with the same rung and seam.
- Flag every count in `script/check-shared-patches.ts` that grew. Each increase needs a stated reason in the PR and in `shared-patches.json`. Flag a raised limit without a new entry.
- For each option 3 or 4 patch, say whether option 1 (plugin) or 2 (host) could replace it, or whether a smaller seam would do. For a sync PR, check that the PR records this check for each conflicting Kilo patch.
- Flag Kilo logic in a shared file that has no `kilocode_change` marker, and branding edits made by hand instead of by the rename script.

## INFRASTRUCTURE_CHANGE.md

Review whether this PR adds, removes, or changes any infrastructure, such as GitHub Actions, CI config, release/deploy scripts, Docker/build infrastructure, package manager/workspace infrastructure, repository automation, issue templates, changelog automation, or generated SDK/build automation.

We want to merge upstream code but keep our own infrastructure, so flag anything infrastructure-related. Run `bun script/check-workflows.ts`: after a sync, `kilo-v2.yml`, `check.yml` and `test.yml` must be the only workflows. Flag upstream changes to the triggers of `check.yml` and `test.yml` (for example branch filters that no longer include `v2`). When in doubt, add a finding and say a human should check manually.

Do not include a full "Files Checked" section. Only list infrastructure-relevant files and findings.

## OPENCODE_MENTIONS.md

Check whether the PR adds user-facing OpenCode mentions or links to OpenCode web properties. On v2, branding is not done yet (the rename script is off until the rebranding work turns it on), so the tree still has many OpenCode strings. Report only new ones that this PR adds in Kilo code or Kilo patches, and new upstream strings that the rename script would not catch.

Focus on UI strings, docs, help text, package metadata shown to users, URLs, CLI output, config docs, generated SDK/OpenAPI descriptions, and error messages.

## UNNECESSARY_MARKERS.md

Check whether any merged files now use `kilocode_change` markers without any actual difference to upstream.

Use `script/upstream/find-reset-candidates.ts --dry-run` to see whether any files changed in the PR are actually now identical to upstream. If you find candidates, verify each with `script/upstream/reset-to-upstream.ts <repo-relative-file> --dry-run`.

## BROKEN_PIPELINE_CHAINS.md

Review this PR for broken end-to-end chains where our custom functionality requires changes across multiple files or layers, but the merge may have removed or altered an intermediate step. The code may still compile, so these issues can be silent.

Look for cases like:

- A parameter that is set but never read.
- A field that is populated but never passed through.
- An event that is emitted but no longer handled.
- A config option that is defined but never propagated to where it is used.
- A type definition extended on one side but not consumed on the other.

For each `kilocode_change` in this PR, trace the full chain: where the value or behavior is introduced, where it needs to flow through, and where it is ultimately consumed. Verify every link in the chain still exists after the merge.

Pay special attention to:

- Props or parameters passed through multiple component or function layers.
- Values written to state, context, or storage that are read elsewhere.
- Message types, events, or IPC handlers where sender and receiver must match.
- Configuration or feature flags defined in one place and checked in another.
- Type definitions extended on one side but consumed on the other.

When in doubt, add a finding. A human will verify it. Compiling code is not proof the chain is intact.

## CONFIG_REGRESSION.md

Check whether this PR changes config discovery, loading or path resolution in a way that affects Kilo's config and storage plans on v2 (separate v2 data store, `kilo2` app directory, `.kilo` config). On v2 the upstream `opencode` paths are still the default until the identity work lands, so do not flag them as such. Flag:

- Changes to config discovery, loading, or path resolution that would make a Kilo config seam (once added) harder, or that read v1 Kilo data (`~/.local/share/kilo`, `~/.config/kilo`).
- Changes that break a Kilo config path that a Kilo patch or plugin already added.

When in doubt, add a finding. A human should verify config path changes manually.

## TESTS.md

Check whether this PR removed any Kilo-specific tests.

Kilo-specific tests may live in `packages/kilo-*`, `packages/**/test/kilocode/`, `script/upstream/`, or may include Kilo-specific assertions, fixtures, or `kilocode_change` markers. Also list upstream tests that the PR skips or deletes, with the reason the PR gives.
