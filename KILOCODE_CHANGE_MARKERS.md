# Kilo Change Marker Review: PR #11090

## Scope and Method

Reviewed all 270 files in the complete `origin/main...HEAD` diff, with `origin/main` at `b90ab85c3b4ad5097fe11e431d0319f31f935d6e`, `HEAD` at `6a1377abaa88902b741f3ffff276aa6b743f3a3c`, and pristine upstream at tag `v1.15.4` (`2b92c5677e830e95d34fc3d5664a69297d2d0b51`). The merge base is exactly the requested `origin/main` commit.

The review used a three-way blob and diff comparison for every changed path, including rename-aware old/new path mapping. It then inspected all 107 changed files that contain `kilocode_change`, every one of the 21 removed marker lines, and the semantics of the 139 removed non-marker lines that had previously been inside or inline with a marker. Newly added lines were also cross-checked against upstream v1.15.4 to distinguish upstream changes from Kilo-specific merge adaptations.

No Kilo runtime behavior appears to have been lost merely because a marker was deleted. The findings below are annotation coverage defects: several markers moved off the statements they used to annotate, and several new or rewritten Kilo-specific adaptations are not covered by markers.

## Findings

### Medium: Four inline markers moved to the following line and no longer cover the Kilo-specific statement

The checker treats a standalone `// kilocode_change` as covering only that comment line. In main, each marker was inline on the modified statement. In the reviewed head, formatting moved it to the next line, leaving the actual Kilo delta uncovered.

- `packages/opencode/src/snapshot/index.ts:305` adds the Kilo-only `opts` parameter, while the marker is now at `packages/opencode/src/snapshot/index.ts:306`.
- `packages/opencode/src/tool/shell.ts:315` uses Kilo's encoded `Shell.args(...)`, while the marker is now at `packages/opencode/src/tool/shell.ts:316`.
- `packages/opencode/test/server/httpapi-config.test.ts:62` changes upstream's `config.json` assertion to `opencode.json`, while the marker is now inside the asserted object at `packages/opencode/test/server/httpapi-config.test.ts:63`.
- `packages/ui/src/components/markdown.tsx:267` adds the Kilo-only `Promise<Rendered>` return shape, while the marker is now at `packages/ui/src/components/markdown.tsx:268`.

These are direct marker-movement regressions from the reviewed merge. Moving each marker back inline, or using a correctly bounded block, would restore machine-readable coverage.

### Medium: New output-token-limit plumbing is marked only on closing delimiters

The merge carries `RuntimeFlags.outputTokenMax` into compaction budgeting and overflow accounting, but the markers sit on closing braces or parentheses. They do not cover the preceding Kilo-specific signature and arguments under the repository checker's line-based rules.

- `packages/opencode/src/session/compaction.ts:147` adds `outputTokenMax` to `preserveRecentBudget`, but only the closing brace at `packages/opencode/src/session/compaction.ts:152` is marked.
- `packages/opencode/src/session/compaction.ts:263` starts the Kilo-specific multiline call and `packages/opencode/src/session/compaction.ts:266` passes `flags.outputTokenMax`, but only `packages/opencode/src/session/compaction.ts:267` is marked.
- `packages/opencode/src/session/processor.ts:683` starts the rewritten overflow call and `packages/opencode/src/session/processor.ts:687` passes `flags.outputTokenMax`, but only `packages/opencode/src/session/processor.ts:688` is marked.

The behavior itself is coherent and has corresponding test changes. The issue is solely that the Kilo delta is not fully annotated.

### Medium: Legacy instance-context compatibility is only partially enclosed by markers

The upstream instance refactor required Kilo to preserve legacy AsyncLocalStorage context across bus callbacks, Promise bridges, bootstrap, disposal, and test fixtures. The semantic adaptation is consistent, but several required imports and executable lines sit outside the nearby marker blocks.

- `packages/opencode/src/bus/index.ts:1` adds `Fiber` and `packages/opencode/src/bus/index.ts:9` adds `instanceContext`; both exist to support the marked compatibility block beginning at `packages/opencode/src/bus/index.ts:199`, but the imports are unmarked.
- `packages/opencode/src/effect/bridge.ts:37` switches upstream's workspace-only restore to Kilo's instance-aware restore, while the standalone marker is on the next line at `packages/opencode/src/effect/bridge.ts:38`.
- `packages/opencode/src/effect/run-service.ts:29` captures `InstanceRef` before the marker block, and `packages/opencode/src/effect/run-service.ts:41` feeds the Kilo-resolved instance back into `attachWith` after the block ends.
- `packages/opencode/src/project/instance-store.ts:7` imports the legacy instance context, while the Kilo bootstrap behavior at `packages/opencode/src/project/instance-store.ts:57` and `packages/opencode/src/project/instance-store.ts:58` is preceded by an inline marker comment rather than enclosed in a start/end block.
- The corresponding fixture adaptation is likewise unmarked at `packages/opencode/test/fixture/fixture.ts:14`, `packages/opencode/test/fixture/fixture.ts:35`, `packages/opencode/test/fixture/fixture.ts:37`, and `packages/opencode/test/fixture/fixture.ts:45`.

This is important merge-maintenance metadata because these lines are precisely where future upstream instance-context changes are likely to conflict semantically.

### Low, human verification: Kilo substitutions were propagated into newly upstream-owned code without markers

These changes make product sense, but they are Kilo-specific relative to pristine v1.15.4 and are not covered by a documented checker exemption. Some follow an existing repository convention of leaving broad branding substitutions unmarked, so a maintainer should confirm whether that convention is intentional before changing them.

- The renamed v2 location middleware retains Kilo header names at `packages/opencode/src/server/routes/instance/httpapi/groups/v2/location.ts:43` and `packages/opencode/src/server/routes/instance/httpapi/groups/v2/location.ts:44`; upstream uses `x-opencode-directory` and `x-opencode-workspace`. The old main file had the same unmarked Kilo headers, so this is carried-forward debt rather than a removed marker.
- Newly inherited upstream runtime flags are translated to Kilo variables without markers at `packages/opencode/src/effect/runtime-flags.ts:20`, `packages/opencode/src/effect/runtime-flags.ts:21`, `packages/opencode/src/effect/runtime-flags.ts:22`, `packages/opencode/src/effect/runtime-flags.ts:24`, `packages/opencode/src/effect/runtime-flags.ts:25`, and `packages/opencode/src/effect/runtime-flags.ts:51`.
- The WarpGrep bus API migration adds the Kilo instance argument at `packages/opencode/src/tool/warpgrep.ts:64` without a marker, even though the related import at `packages/opencode/src/tool/warpgrep.ts:5` is marked.
- The upstream plugin compatibility test marks the first `@kilocode/plugin` substitution at `packages/opencode/test/tool/registry.test.ts:286`, but not the same substitution at `packages/opencode/test/tool/registry.test.ts:298` or `packages/opencode/test/tool/registry.test.ts:318`.

### Low: A first-line marker looks like a whole-file annotation but is not recognized as one

`packages/opencode/src/provider/models.ts:1` starts with `// kilocode_change - adapt Kilo model assembly to the upstream core models service`. The file does not exist in pristine upstream v1.15.4, and the comment clearly intends to explain the whole Kilo-owned adapter. However, the annotation checker recognizes a whole-file marker only when the first line is exactly the `// kilocode_change - new file` form. The current comment covers only line 1.

This marker text predates the reviewed merge, so it was preserved rather than accidentally removed. It remains relevant because the merge reformatted most of this shared-path file, and a direct upstream comparison sees the remaining body as unannotated.

## Notable Non-Findings

- `packages/opencode/script/postinstall.mjs` drops three inline markers because the old target-path and two resource-copy calls were consolidated into two correctly bounded Kilo blocks. Kilo binary naming, variant selection, and tree-sitter/console copying remain present.
- `packages/opencode/src/server/routes/instance/httpapi/server.ts` removes the marked global `schemaErrorLayer` provision because upstream v1.15.4 now provides that layer at the root and instance route groups. The reviewed head matches upstream's placement, so the removed marker is stale rather than lost.
- `packages/opencode/src/session/prompt.ts` removes three marked `SyncEvent` wiring lines because upstream replaced that service with `EventV2Bridge`. Kilo's prompted/synthetic dual-write behavior remains in marked blocks, and the image-normalization layer remains marked after its upstream-driven move.
- `packages/opencode/src/config/agent.ts` and `packages/opencode/src/config/command.ts` move marker boundaries so upstream logging and return statements are no longer incorrectly included in Kilo blocks. The Kilo warning, context capture, and error publication behavior remains enclosed.
- The `WithInstance` marker removals in TUI and LSP tests follow upstream's deletion of that adapter. The tests now use `provideTestInstance`, and Kilo's legacy-context behavior is retained through the new instance compatibility layer.
- The six nested/orphan marker-balance events in `packages/opencode/src/session/compaction.ts` and `packages/ui/src/components/markdown.tsx` are present in both main and the reviewed head at equivalent locations. They were not introduced by this merge.

## Commands and Concise Outputs

- `pwd && git branch --show-current && git rev-parse HEAD && git rev-parse origin/main && git status --short --branch`
  - Confirmed the requested worktree, branch `review/upstream-11090-reports`, clean starting state, `HEAD=6a1377abaa88902b741f3ffff276aa6b743f3a3c`, and `origin/main=b90ab85c3b4ad5097fe11e431d0319f31f935d6e`.
- `git merge-base origin/main HEAD`
  - `b90ab85c3b4ad5097fe11e431d0319f31f935d6e`.
- `git diff --name-status origin/main...HEAD` and `git diff --stat origin/main...HEAD`
  - 270 changed files, 7,733 insertions, 3,901 deletions; 13 additions, 5 deletions, and 4 detected renames.
- `git show --no-patch --format=... HEAD` and `git show --no-patch --format=... v1.15.4`
  - Confirmed the reviewed merge head and pristine upstream tag `2b92c5677e830e95d34fc3d5664a69297d2d0b51`; the tag is an ancestor of the reviewed branch.
- Inline Python over `git diff --name-status -z origin/main...HEAD` plus `git show <ref>:<path>`
  - Compared all 270 paths across main, head, and upstream: 73 head blobs exactly match upstream, 2 base blobs match upstream, 105 are three-way integrations, and 90 are absent at the corresponding upstream path.
- Inline Python marker inventory over all changed paths
  - 107 changed files contain markers; marker occurrences increase from 1,321 on main to 1,377 on head. Five files have a net marker-count decrease. A hunk-level scan found 21 removed marker lines across all files.
- Inline Python coverage scan of removed main lines
  - 13 files remove or rewrite marker-covered behavior, totaling 139 non-marker lines; each group was inspected against both head and upstream.
- `bun run script/check-opencode-annotations.ts --base origin/main`
  - `Skipping shared upstream annotation check - upstream merge detected.`
- `git diff --check origin/main...HEAD` and `git diff --check v1.15.4..HEAD -- $(git diff --name-only origin/main...HEAD)`
  - Both exited 0 with no whitespace errors.

## Limitations

- The repository annotation checker deliberately skips this merge, so it provides no pass/fail evidence for the reviewed changes. Findings rely on three-way diffing plus the checker's documented line-coverage semantics.
- A line-number intersection scan between the main-to-head and upstream-to-head diffs produced false positives for moved upstream code and pre-existing unmarked branding. Those candidates were manually reduced to the findings above; the raw heuristic result was not treated as proof.
- Generated files, lockfiles, documentation, Kilo-owned paths, and non-source assets were included in the 270-file three-way review, but they are outside the annotation checker's shared-source coverage rules.
- No git mutation command, commit, build, or test suite was run. This was a read-only marker review except for creating this report.
