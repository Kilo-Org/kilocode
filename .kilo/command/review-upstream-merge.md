---
description: Review an upstream merge PR and write reports
---

Review $1.

Branch off so we have all the code for the reviewed PR. Then run the following reviews in parallel, using one subagent per review, and save each result in the named markdown file at the repository root. A human will read those files, so if in doubt add a finding for human verification.

When all subagents are done, commit the report files and create a draft PR with the reviewed PR branch as base.

Do not include exhaustive per-file checklists in the report files. Summarize the scope and methodology, then list only findings, notable non-findings, command outputs, and limitations.

## KILOCODE_CHANGE_MARKERS.md

Review carefully, file by file, whether we accidentally removed any `kilocode_change` marker.

Get the full list of files changed in the reviewed PR. Check each changed file. For each file, compare both our `main` branch and the upstream-merged version in the reviewed PR. Determine whether any marker removal, marker move, or Kilo-specific change makes sense, and comment on that.

Do not include a full "Files Checked" section. Mention the number of changed files checked, but only list files that have findings or need human verification.

## INFRASTRUCTURE_CHANGE.md

Review whether this PR adds, removes, or changes any infrastructure, such as GitHub Actions, CI config, release/deploy scripts, Docker/build infrastructure, package manager/workspace infrastructure, repository automation, issue templates, changelog automation, or generated SDK/build automation.

We want to merge upstream code but keep our own infrastructure, so flag anything infrastructure-related. When in doubt, add a finding and say a human should check manually.

Do not include a full "Files Checked" section. Only list infrastructure-relevant files and findings.

## OPENCODE_MENTIONS.md

Check whether the merge now mentions OpenCode somewhere user-facing instead of Kilo, or links to OpenCode web properties.

Focus on UI strings, docs, help text, package metadata shown to users, URLs, CLI output, config docs, generated SDK/OpenAPI descriptions, and error messages.

## UNNECESSARY_MARKERS.md

Check whether any merged files now use `kilocode_change` markers without any actual difference to upstream.

Use `script/upstream/find-reset-candidates.ts --dry-run` to see whether any files changed in the PR are actually now identical to upstream. If you find candidates, verify them with `script/upstream/reset-to-upstream.ts --dry-run`.

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

## TESTS.md

Check whether this PR removed any Kilo-specific tests.

Kilo-specific tests may live in paths containing `kilo` or `kilocode`, or may include Kilo-specific assertions, fixtures, or `kilocode_change` markers.
