# KILOCODE_CHANGE_MARKERS Review

## Scope and methodology

Reviewed only Kilo-specific behavior associated with `kilocode_change` markers for PR #13368 at exact base `6175210c0fd0092a86aa475e4d8d7616711a1464` and head `5d120f0696a83b354804e0848f1c1af4b0088a4f`. Verified upstream v1.18.18 commit `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`, merge commit `6b9a826e03cd8a5716e73d25596fa6199cf25d59` with parents `6175210c...` and `31406ccc...`, and conflict-resolution commit `c9861e9548c543c82881fd33d2c9856c6a72ef2b`. `origin/main` was `e1198adeb3ba914991a0f042ce9eb42e660e5b37` and was used only as a supplementary current-Kilo reference.

All 48 files from `git diff --name-status 6175210...5d120f0` were checked across the PR base, pristine upstream v1.18.18, final head, and `origin/main`. The audit compared marker counts and locations, flattened and merge-parent diffs, final Kilo-to-upstream differences, conflict remerge output, and deleted regions by behavior and concept. The 48-file PR delta is 885 insertions and 159 deletions. Seventeen changed files contain markers at both base and head. No marker line was removed; eight marker lines were added in `packages/opencode/src/config/config.ts` and `packages/opencode/src/session/compaction.ts`.

## Findings

### P2: Upstream's fixed five-retry cap silently overrides the retained configurable Kilo retry limit

- **Evidence:** `packages/opencode/src/session/retry.ts:148-157` retains the marked Kilo `opts.limit` check, then applies the newly adopted unmarked upstream `RETRY_MAX_RETRIES = 5` check. `packages/opencode/src/kilocode/session/processor.ts:198-214` still documents and supplies `KILO_SESSION_RETRY_LIMIT` as the Kilo-specific limit. `packages/core/src/flag/flag.ts:155-159` still exposes the dynamic environment setting. The base had the marked configurable check but no unconditional cap; `origin/main` has the same prior Kilo contract.
- **Concrete effect:** with `limit: 10`, a deterministic schedule probe recorded attempts `[1,2,3,4,5]`, not attempts through 10. With the setting unset, behavior also changes from unbounded Kilo retries to five. Values below five still work, which is why the unchanged regression test at `packages/opencode/test/kilocode/session-processor-retry-limit.test.ts:159-235` passes with value 2 while not covering the semantic collision.
- **Marker assessment:** no marker was textually removed, but upstream code inserted immediately after a retained marked region narrowed the effective behavior represented by that marker. The Kilo-specific limit no longer means what its helper, flag, and tests say it means.
- **Provenance:** introduced by upstream adoption/merge interaction.
- **Minimal fix direction:** make the upstream cap conditional on `opts.limit === undefined`, or otherwise define one effective limit that preserves explicit Kilo values; add controls for unset and values above five.

### P2: Unknown-field warnings are restored only for untrusted project config, leaving other retained Kilo warning paths silent

- **Evidence:** `packages/opencode/src/config/config.ts:315-348` adds a marked `configWarnings` parameter and excess-key warning logic, but warnings are emitted only when a caller passes an accumulator. Project files pass `warnings` at `packages/opencode/src/config/config.ts:700-714`, and untrusted config-directory files do so at `packages/opencode/src/config/config.ts:752-769`. In contrast, explicit `KILO_CONFIG` calls `loadFile(..., true)` without `warnings` at `packages/opencode/src/config/config.ts:682-695`; `KILO_CONFIG_CONTENT` calls `loadConfig(...)` without `warnings` at `packages/opencode/src/config/config.ts:823-846`; global files loaded by `loadGlobal` likewise do not receive the instance accumulator.
- **Concrete effect:** a deterministic probe set `Flag.KILO_CONFIG` to `{ "model": "test/model", "unknownField": true }`. Head loaded `model` successfully but returned `warnings: []`. At base, `ConfigParse.schema` rejected unknown top-level fields, and the existing marked catch at `packages/opencode/src/config/config.ts:683-696` converted that defect into a warning. Thus the follow-up restores the old warning behavior only for some sources.
- **Marker assessment:** the retained marker says `capture KILO_CONFIG failures as warnings`, but the upstream switch to ignored excess properties made that region stale for unknown fields. The new marked compatibility block is too narrowly wired and does not fully preserve the behavior concept represented by the older warning markers.
- **Provenance:** introduced by conflict-resolution/follow-up adaptation to upstream's ignored excess properties.
- **Minimal fix direction:** pass the instance warning accumulator through all user-facing config sources that previously surfaced unknown-field defects, or centralize excess-key warning collection so project, global, `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, managed, and remote sources have an explicit and tested policy.

### P3: Two changed Kilo-owned files retain prohibited whole-file markers

- **Evidence:** `packages/opencode/src/kilocode/config-validation.ts:1` and `packages/opencode/test/kilocode/config-validation.test.ts:1` still begin with `// kilocode_change - new file`. Both files changed in this PR, both paths are checker-exempt because they contain `kilocode`, and root/package guidance says such paths must not contain markers.
- **Marker assessment:** these markers were not introduced or moved by this PR, but they are stale and remained in files actively touched by the merge follow-up. They create false upstream-conflict ownership signals.
- **Provenance:** pre-existing Kilo hygiene issue retained in changed files.
- **Minimal fix direction:** remove the two whole-file markers.

## Files needing human verification

- None beyond the findings above. The intended product policy for `KILO_SESSION_RETRY_LIMIT` should be confirmed before resolving the first finding: current code and tests describe it as the Kilo-specific effective limit, but the PR changes values above five and the unset case.

## Notable non-findings

- No `kilocode_change` marker line was deleted, moved to a different file, or textually narrowed in the 48-file PR delta. Existing marker-bearing changed files remained the same 17 files; the eight added marker lines cover the config-warning adaptation and compaction prompt rerendering.
- The compaction adaptation at `packages/opencode/src/session/compaction.ts:415-446` correctly broadens markers around the Kilo payload-recovery inputs and rerenders the adopted upstream anchored-summary prompt after payload stripping/chunking. Focused compaction recovery/chunk tests passed, and the one combined-suite timeout passed in isolation.
- The Kilo prompt/provider selection markers in `packages/opencode/src/session/system.ts` remain coherent around upstream Muse and Kimi expansion. Provider/system tests passed.
- Existing Kilo provider markers in `packages/opencode/src/provider/transform.ts` remain distinct from the adopted upstream Merge Gateway and DeepSeek changes; no Kilo Gateway routing, reasoning, or cache behavior was lost. Provider transform and Copilot model tests passed.
- The retained compatibility marker `packages/core/src/session/compaction.ts:221` for the released-reader `include` field remains necessary relative to pristine upstream and is preserved at head.
- Shared changed files that exactly adopted upstream behavior, including `packages/opencode/src/config/parse.ts`, did not receive inappropriate Kilo markers.

## Commands and exact results

- `git status --short --branch` initially returned only `## review/pr-13368-upstream-merge`; during the review other subagents created unrelated untracked lens reports. No source file was modified by this review.
- `git rev-parse HEAD review/pr-13368-upstream-merge ...` resolved both HEAD and branch to `5d120f0696a83b354804e0848f1c1af4b0088a4f`; the supplied base, upstream, merge, and conflict-resolution commits all resolved exactly.
- `git show --no-patch --format='%H%n%P%n%s' 6b9a826...` returned parents `6175210c... 31406ccc...`; `git merge-base 6175210... 5d120f0...` returned `6175210c0fd0092a86aa475e4d8d7616711a1464`.
- `git diff --name-status 6175210...5d120f0` returned 48 files. `git diff --stat` returned `48 files changed, 885 insertions(+), 159 deletions(-)`.
- Marker inventory returned `changed_files=48`, `marker_bearing_head_files=17`, no removed marker lines, and `added_marker_lines=8`.
- `bun run script/check-opencode-annotations.ts --base 6175210c...` exited 0 but printed `Skipping shared upstream annotation check — upstream merge detected.` It did not validate coverage and is not counted as a substantive pass.
- `bun run script/upstream/fix-kilocode-markers.ts <file> --dry-run` identified upstream v1.18.18 (`31406ccc`) and said it would update each sampled shared file: `config.ts`, `session/compaction.ts`, `session/retry.ts`, `session/system.ts`, and `provider/transform.ts`. It also warned of 25, 41, and 205 upstream-only deleted lines for config, retry, and transform respectively. Because the fixer reconstructs all final Kilo/upstream differences rather than adjudicating merge intent, these results were treated as review leads, not automatic findings.
- `bun test test/session/retry.test.ts test/kilocode/session-processor-retry-limit.test.ts`: `56 pass`, `0 fail`, 80 expectations.
- Retry limit probe with `limit: 10`: exact output `[1,2,3,4,5]`.
- `bun test test/kilocode/config-resilience.test.ts test/kilocode/config-validation.test.ts`: `23 pass`, `0 fail`, 48 expectations.
- Explicit `KILO_CONFIG` unknown-field probe: exact output `{"model":"test/model","warnings":[]}`.
- `bun test test/provider/transform.test.ts test/plugin/github-copilot-models.test.ts test/session/system.test.ts`: `443 pass`, `0 fail`, 850 expectations.
- `bun test test/session/compaction.test.ts test/kilocode/compaction-payload-recovery.test.ts test/kilocode/session-compaction-chunks.test.ts`: `76 pass`, `1 skip`, `1 fail`; the failure was a 5000 ms timeout for `anchors repeated compactions with the previous summary`. Isolated rerun with `bun test test/session/compaction.test.ts -t 'anchors repeated compactions with the previous summary'`: `1 pass`, `62 filtered out`, `0 fail`, 9 expectations. Classified as load-sensitive/environmental, not a marker finding.
- `git diff --check 6175210... 5d120f0...`: no output, exit 0.

## Limitations

- This was only the KILOCODE_CHANGE_MARKERS lens, not a full merge or PR review. Infrastructure, branding strings, config semantics beyond marker-associated preservation, and general correctness were not exhaustively assessed.
- `origin/main` is newer than the PR base and was supplementary only; provenance conclusions use the supplied base and pristine upstream commit.
- The repository annotation guard intentionally skips upstream-merge ranges, so marker correctness was established manually rather than by that guard.
- Marker-fixer dry runs report that normalized output would differ but do not print the proposed patch in dry-run mode; broadness/staleness judgments therefore relied on direct four-reference diffs and behavior tracing.
- No GitHub state was mutated, no commit or push was made, and no source file was edited.
