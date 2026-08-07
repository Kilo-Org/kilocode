# `kilocode_change` Marker Audit v2: PR #12901

## Scope And Method

Re-review of the two v1 findings from `KILOCODE_CHANGE_MARKERS.md` against the new reviewed head `cbbbd7217f940b59b1b29964264536c567065327`, plus a full audit of the 49-file delta `c69ce6caf638617169509f09e3f5d620eb702146..cbbbd7217f940b59b1b29964264536c567065327` for new marker regressions. Method: tree comparison against merge base `b135b4e10a9028983497bf69cded47b6ce4572ff` and pristine upstream `32696c425fc0fa1ec285389346cfa1fbe22b670a` (branch was force-rewritten, so ancestry is not used), byte-level comparison of restored code, per-file marker counts at both heads, targeted test execution, and the annotation checker. Local checkout is `c5b1427314` (reviewed head plus a docs-only commit; source tree identical). The PR head did not move during this review.

## V1 Finding Status

| # | v1 finding | Status | Summary |
|---|---|---|---|
| P2 | Kimi/Moonshot Anthropic adaptive-effort removed with marker block | Partially fixed | Restoration is byte-identical to baseline, correctly marked, and exercised by a real new test, but it crashes upstream's `providerID`-less mocks: 3 pre-existing tests now fail and CI is red. See new finding F1. |
| P3 | `packages/ui/src/i18n/uk.ts:81` lost its marker | Fixed | All 20 `Kilo Go` lines now carry `// kilocode_change`, and the merge transform now auto-marks branded lines so future merges cannot strip them. |

## New Findings

### F1 P1: Restored `isKimiFamily` crashes upstream test mocks that omit `providerID`; `transform.test.ts` fails 3 tests

**Location:** `packages/opencode/src/provider/transform.ts:1314-1323` (`isKimiFamily`, inside the new `kilocode_change` block), triggered from `anthropicEffort` at line 1301. Failing tests in `packages/opencode/test/provider/transform.test.ts`: `converts effort for @ai-sdk/anthropic`, `converts effort for @ai-sdk/google-vertex/anthropic`, and `leaves legacy Anthropic effort options to budget fallback`.

**Evidence:**

- `bun test ./test/provider/transform.test.ts` at the new head: `382 pass`, `3 fail` (v1 head was `385 pass`, `0 fail`).
- All three failures are the same crash: `TypeError: undefined is not an object (evaluating 'id.toLowerCase')` at `transform.ts:1317`, inside `isKimiFamily` via `anthropicEffort` -> `effortVariants` -> `reasoningVariants`.
- The failing tests build models with upstream's own mock helper at `transform.test.ts:3130-3131`: `({ id, api: { id, npm, url: "" }, ... }) as any` — no `providerID`. That helper is pristine upstream code (identical at upstream `32696c425f` lines 3031-3032), so it cannot be assumed to change.
- `Provider.Model.providerID` is a required field (`provider.ts:1071`), so production callers never hit this; the crash is confined to `as any` test mocks. The `uses bare effort for Claude Opus 4.5` test passes because the opus-4.5 check returns before `isKimiFamily` is reached.
- CI evidence on this head (run 31053081178): `unit (linux, 1/2)` and `unit (windows, 1/4)` fail exactly these three tests with the identical stack; `unit (macos)` failed earlier at 1m53s on an unrelated `sdk-next` embedded-test timeout before its CLI shard ran (see `TESTS_V2.md`). Local macOS repro fails the same suite in ~1.4s with exactly these 3 tests.

**Impact:** The P2 fix reintroduces the correct Kimi behavior but leaves the shared provider test suite red, blocking the merge. The new Kilo-owned test (`test/kilocode/provider/kimi-adaptive-effort.test.ts`) passes because its mocks set `providerID`, so the failure mode is invisible to the new coverage.

**Direction:** Make `isKimiFamily` null-safe inside its Kilo-owned block, e.g. `[model.providerID, model.api.id].some((id) => id?.toLowerCase().includes(...))` or an equivalent `?? ""` guard. Do not fix this by editing upstream's mock helper in the shared test file — that would add another marked shared-file delta and more merge surface. Re-run `bun test ./test/provider/transform.test.ts` to confirm `385 pass, 0 fail`.

## V1 P2 Verification Detail (behind the "partially fixed")

- The restored `isKimiFamily` helper is byte-identical to baseline `b135b4e10a` (`diff` of both extracts: no output, `HELPER_IDENTICAL`). Family detection covers provider ID, API ID (`kimi`/`moonshot`, case-insensitive), and the four hosts `api.kimi.com`, `api.moonshot.ai`, `api.moonshot.cn`, `api.moonshotai.cn`.
- The restored call-site line returns `{ thinking: { type: "adaptive", display: "summarized" }, effort }`, identical to baseline line 1299, and sits after the upstream-owned opus-4.5 early return, matching baseline precedence.
- Marking is correctly narrow: two `kilocode_change start/end` blocks wrap exactly the Kilo delta (call-site line plus the whole helper); upstream's opus-4.5 line and `anthropicAdaptiveEfforts` logic remain unmarked upstream code.
- The new test `packages/opencode/test/kilocode/provider/kimi-adaptive-effort.test.ts` genuinely exercises the behavior through `ProviderTransform.reasoningVariants`: ID-based detection (`moonshotai`/`kimi-k3` over `@ai-sdk/anthropic`, expecting adaptive+summarized `low/high/max` variants) and host-based detection (custom provider at `https://api.moonshot.ai/anthropic`). It passes (`2 pass`, `0 fail`) and would have failed at the v1 head (where `reasoningVariants` returned `undefined` for this shape).

## V1 P3 Verification Detail (behind the "fixed")

- `git grep -n -I 'Kilo Go' cbbbd7217f -- packages/ui/src/i18n | wc -l` = `20`; all 20 lines carry `// kilocode_change`; zero unmarked `Kilo Go` lines remain. This also completes the v1 "consider normalizing the other 19" suggestion, not just `uk.ts:81`.
- Each i18n file's delta is exactly `1 + / 1 -` (marker appended to the brand line); no translation content changed in the v1->v2 delta.
- `script/upstream/transforms/transform-i18n.ts:203-204` now appends ` // kilocode_change` to every line where the transform performed a replacement (`lineReplacements > 0`). Soundness: (a) idempotent — already-marked lines are preserved by `shouldPreserveLine` before replacement, so no double-marking; (b) placement safe — locale entries are single-line double-quoted strings, so an end-of-line comment cannot land inside a string; (c) one marker per transformed line regardless of replacement count. New `transform-i18n.test.ts` verifies marking of branded lines, non-marking of preserved legacy config lines, and the replacement count; it passes.
- Behavioral consequence (intended, not a defect): with the 20 files now marker-bearing, `transformConflictedI18n`'s `oursHasKilocodeChanges` check will flag future conflicted i18n files for manual resolution instead of silently auto-branding them. That is precisely the protection the v1 finding asked for — branding can no longer be overwritten as "upstream-owned" — at the cost of manual handling when real conflicts occur.

## Full-Delta Marker Audit (49 files)

- The only marker removal in the delta is `packages/opencode/test/account/service.test.ts:39`, and it is justified: the line is now byte-identical to pristine upstream (baseline/v1 head had a stale marker on converged code). Same documented class as v1's correct removals in `models-dev.ts`, `processor.ts`, and `marked.tsx`.
- No overly broad markers. `tools.ts` relocates the marked `restricted` computation earlier and marks the new `networkRestricted` pass-through (net +1 marked line, no authority loss); `code-mode.ts` adds two narrow marked lines; `registry.ts` adds three; the new workflow step sits inside the pre-existing `kilocode_change start/end` block in `.github/workflows/test.yml`.
- New files: `script/check-test-ci.ts` correctly carries `// kilocode_change - new file` (new file in a shared path). `script/upstream/transforms/transform-i18n.test.ts`, `packages/opencode/test/kilocode/provider/kimi-adaptive-effort.test.ts`, and `packages/opencode/test/kilocode/session/meta-prompt.test.ts` live in Kilo-owned paths (`script/upstream/` merge tooling, `test/kilocode/`) and correctly carry no markers.
- Marker inventory: v1 head `810` files / `6030` lines -> v2 head `811` files / `6067` lines (+1 file, +37 lines), fully accounted per file: +20 i18n brand lines, +4 `transform.ts`, +4 `registry.test.ts`, +3 `registry.ts`, +2 `code-mode.ts`, +1 `tools.ts`, +1 `check-test-ci.ts`, +1 `transform-i18n.ts` (marker literal in new code), +2 `transform-i18n.test.ts` (assertion literals), -1 `account/service.test.ts`.
- `bun run script/check-opencode-annotations.ts --base b135b4e10a...` outputs `Skipping shared upstream annotation check — upstream merge detected.` As in v1, this is a skip, not a pass; the per-file audit above stands in for it.

## Notable Non-Findings

- `packages/opencode/src/session/prompt/meta.txt` re-branding (OpenCode -> Kilo, opencode.ai -> kilo.ai) has no inline marker — `.txt` prompts have no comment convention — but is now covered by the `takeTheirsAndTransform` merge config entry plus the Kilo-owned `meta-prompt.test.ts`. Designed mechanism, not a marker gap.
- Root and package-level `package.json` script changes (`extension:isolated*`, `test:ci` additions, `translate:app` removal) cannot carry markers in JSON; they are covered by `transform-package-json.ts` PRESERVE/DELETE lists with updated tests and by the new `check-test-ci.ts` CI guard, which runs clean: `check-test-ci: ok (25 test-bearing package(s))`.
- The `script/translate-app.{ts,test.ts,md}` removal targets upstream-only automation for products Kilo does not ship; the files were added to `defaultConfig.skipFiles` with test coverage (`skip-files.test.ts`). No Kilo content loss.
- Unmarked translation-content lines that differ from upstream in the 20 i18n files (e.g. `ui.sessionReview.*`, `ui.sessionTurn.*` keys; wholesale `it.ts`/`nl.ts` differences) are Kilo-maintained translations, not branding; marking them would defeat the transform's preservation semantics. Pre-existing state, unchanged by this delta.
- The code-mode/registry delta changes restricted-session behavior (MCP tools are now hidden from code-mode catalogs instead of failing at the sandbox boundary) with markers intact and updated marked tests; `bun test ./test/tool/registry.test.ts ./test/tool/code-mode.test.ts` passes `60 pass`, `0 fail`. Behavior review belongs to other reviewers; marker posture is correct.

## Exact Command Outputs

- `git rev-parse johnnyeric/kilo-opencode-v1.18.0` -> `cbbbd7217f940b59b1b29964264536c567065327` (unchanged during review; local checkout `c5b1427314` differs from reviewed head only by report `.md` files).
- `git diff --name-only c69ce6caf6..cbbbd7217f | wc -l` -> `49`; shortstat `49 files changed, 282 insertions(+), 756 deletions(-)`.
- `diff` of baseline vs v2-head `isKimiFamily` extracts -> no output; `HELPER_IDENTICAL`.
- `bun test ./test/kilocode/provider/kimi-adaptive-effort.test.ts` -> `2 pass`, `0 fail`, `2 expect() calls`.
- `bun test ./test/provider/transform.test.ts` -> `382 pass`, `3 fail`, `689 expect() calls`; failures are the three tests named in F1, all `TypeError: undefined is not an object (evaluating 'id.toLowerCase')` at `transform.ts:1317`.
- `git grep -n -I 'Kilo Go' cbbbd7217f -- packages/ui/src/i18n | wc -l` -> `20`; same piped through `grep -v kilocode_change` -> empty (`(none)`).
- `git diff c69ce6caf6..cbbbd7217f --numstat -- packages/ui/src/i18n` -> `1 1` for each of the 20 files.
- Marker inventory: v2 head `git grep -l -I kilocode_change` -> `811` files, `git grep -I kilocode_change` -> `6067` lines; v1 head `810` / `6030`.
- `bun test transform-i18n.test.ts skip-files.test.ts transform-package-json.test.ts` -> `30 pass`, `0 fail`, `86 expect() calls`.
- `bun test ./test/kilocode/session/meta-prompt.test.ts` -> `1 pass`, `0 fail`, `4 expect() calls`.
- `bun test ./test/tool/registry.test.ts ./test/tool/code-mode.test.ts` -> `60 pass`, `0 fail`, `155 expect() calls`.
- `bun run script/check-test-ci.ts` -> `check-test-ci: ok (25 test-bearing package(s))`.
- `bun run script/check-opencode-annotations.ts --base b135b4e10a...` -> `Skipping shared upstream annotation check — upstream merge detected.`
- `git diff --check c69ce6caf6..cbbbd7217f` -> no output, exit `0`.
- Pristine upstream `transform.test.ts:3031-3032` matches the head's `target` mock helper byte-for-byte (no `providerID`).

## Limitations

- CI attribution for run 31053081178 is now log-verified (see `TESTS_V2.md`): the three `transform.test.ts` crashes fail `unit (linux, 1/2)` and `unit (windows, 1/4)` deterministically, while the `unit (macos)` 1m53s failure is the unrelated `sdk-next` embedded-test 10s timeout on macos-15, with zero CLI-shard lines in that job's log. F1 does not depend on the macOS shard.
- Scope was the 49-file v1->v2 delta plus the two v1 findings; the full 262-path baseline->head three-way classification from v1 was not re-run.
- The Kimi restoration was verified against baseline semantics and unit-level transforms only; no live Moonshot/Kimi endpoint was contacted, and product intent for the restoration remains assumed from the PR fixing the v1 finding.
- The `transform-i18n` auto-marking was verified by unit test and code reading, not by running a simulated upstream merge; its interplay with `oursHasKilocodeChanges` (manual-resolution flagging) is predicted from code, not observed.
