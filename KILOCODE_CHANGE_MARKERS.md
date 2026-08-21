# `kilocode_change` Marker Audit: PR #12901

## Findings

### P2 medium, human verification required: Kimi Anthropic adaptive-effort behavior was removed with its marker block

**Location:** `packages/opencode/src/provider/transform.ts:1298-1307` (`anthropicEffort`) and `packages/opencode/src/provider/transform.ts:1451-1460` (the remaining Kimi defaults).

**Evidence:**

- Baseline `b135b4e10a9028983497bf69cded47b6ce4572ff`, lines 1296-1307 and 1365-1375, had a marked Kilo branch that recognized Kimi/Moonshot by provider ID, API ID, and Kimi/Moonshot API hosts, then mapped published effort values to `{ thinking: { type: "adaptive", display: "summarized" }, effort }`.
- `git blame -L 1290,1375 b135b4e10a... -- packages/opencode/src/provider/transform.ts` attributes the removed implementation to `fd60036e4a`; the in-code rationale says Kimi omits adaptive thinking text unless summarized display is requested. Pristine upstream `32696c425fc0fa1ec285389346cfa1fbe22b670a` does not contain this later Kilo behavior.
- Head `c69ce6caf638617169509f09e3f5d620eb702146` contains upstream's generic `anthropicEffort` and no `isKimiFamily`. Its remaining default only enables token-budget thinking for selected K2 IDs at lines 1451-1460.
- A direct head probe for `moonshotai/kimi-k3` over `@ai-sdk/anthropic`, with models.dev efforts `low/high/max`, printed exactly `reasoningVariants=undefined`, `heuristicVariants={"high":{"thinking":{"type":"enabled","budgetTokens":16000}},"max":{"thinking":{"type":"enabled","budgetTokens":31999}}}`, and `options={"toolStreaming":false}`. The baseline branch would instead expose adaptive `low/high/max` variants with summarized thinking.
- `bun test ./test/provider/transform.test.ts` passed `385` tests, but the current reasoning-variant suite has no Kimi-family adaptive-effort or Moonshot-host case. The passing suite therefore does not cover this removed behavior.

**Impact:** Kimi/Moonshot models reached through Anthropic-compatible transports lose their published effort choices and fall back to `high/max` token budgets. If the baseline support rationale still applies, these requests use the wrong control shape and can omit summarized thinking needed for replay.

**Direction:** Before merge, a human must verify whether Kimi Anthropic adaptive-effort support was intentionally withdrawn. If not, restore the narrow Kimi family mapping on top of v1.18's upstream-owned `reasoningVariants`/`anthropicEffort`, mark only that Kilo delta, and add model-ID plus Moonshot-host regression cases.

### P3 low: Ukrainian `Kilo Go` branding survived but its marker was removed

**Location:** `packages/ui/src/i18n/uk.ts:81`, `dialog.usageExceeded.freeTier.description`. The same currently unmarked brand delta appears in `packages/ui/src/i18n/{ar,br,bs,da,de,en,es,fr,it,ja,ko,nl,no,pl,ru,th,tr,uk,zh,zht}.ts`.

**Evidence:**

- Baseline `packages/ui/src/i18n/uk.ts:60-69` wrapped the usage-exceeded translations in `kilocode_change` markers and used `Kilo Go`.
- Pristine upstream `packages/ui/src/i18n/uk.ts:75-82` supplies the improved Ukrainian wording but uses `OpenCode Go`.
- Head correctly combines the improved upstream copy with `Kilo Go` at line 81, but drops both markers. `git grep -n -I 'Kilo Go' c69ce6caf6 -- packages/ui/src/i18n` reports `20` lines and `0` of those lines has an inline marker. The PR-specific marker removal is the Ukrainian block; the sibling unmarked brand lines make the broader maintenance risk visible.

**Impact:** There is no current runtime branding regression, but marker-guided future merges can classify the retained Kilo branding as upstream-owned and overwrite it with `OpenCode Go`.

**Direction:** Restore a narrow inline marker on `packages/ui/src/i18n/uk.ts:81` rather than the obsolete broad translation block. Consider normalizing the same narrow annotation on the other 19 Kilo-specific brand lines separately.

## Meaningful Moves And Removals

- Marker-focused three-way inspection covered all 22 files with marker-text deltas. Only the findings above and the meaningful ownership moves below warrant file-level discussion.
- `packages/opencode/src/mcp/index.ts`, `packages/opencode/src/session/tools.ts`, and new `packages/opencode/src/tool/code-mode.ts` move remote-MCP sandbox authority from an AI SDK-converted tool to the native MCP entry. The Kilo markers move with that authority boundary, and the code-mode integration tests retain explicit sandbox markers. No authority loss was found.
- `packages/core/src/models-dev.ts` removes three marker lines because `ReasoningOption` and `reasoning_options` are now pristine-upstream v1.18 behavior. The implementation remains present and upstream-owned.
- `packages/opencode/src/session/processor.ts` removes the inline marker from `metadata: match.part.state.metadata`, but pristine upstream now has the same metadata-preservation behavior and head retains it.
- `packages/opencode/test/mcp/oauth-browser.test.ts` removes its two-line marked mock-race workaround because head matches pristine upstream's real OAuth/browser integration test byte-for-byte.
- `packages/ui/src/context/marked.tsx` removes only the stale type-import markers after upstream begins owning those imports. The active Kilo policy that disables single-dollar math remains marked, while upstream's unambiguous `\(...\)` support is retained.
- `packages/opencode/src/provider/transform.ts` correctly removes the broad marker around the now-upstream-owned `reasoningVariants` implementation. The Kimi special case in the P2 finding is different: it was Kilo behavior inside that broad block and has no head replacement.
- The force update from prior reviewed head `425f5f3b364927b461ef689114d38b9432717daf` to `c69ce6caf638617169509f09e3f5d620eb702146` changes exactly `packages/opencode/test/cli/run/footer.view.test.tsx` (`3` additions, `2` deletions) and `packages/opencode/test/kilocode/issue-8656-stall.test.ts` (`1` addition, `1` deletion). The footer test replaces the native animated spinner with a marked `BoxRenderable` registration; the Kilo-owned issue-8656 test raises only the stall-observation budget from `30_000` to `60_000` and correctly needs no marker.

## Notable Non-Findings

- Every one of the `262` baseline-to-head changed paths was compared across baseline, pristine upstream, and head. `145` head paths match pristine upstream byte-for-byte; `117` are head-specific adaptations. The only baseline marker-bearing exact-upstream replacement is `packages/opencode/test/mcp/oauth-browser.test.ts`, whose removed workaround is obsolete as described above.
- The all-path removed-line scan found Kilo-specific text in `packages/opencode/test/tool/fixtures/models-api.json`, but this generated fixture still contains the `kilo` provider, `Kilo Gateway`, and the `kilo-auto/{balanced,frontier,small,free}` models at head. Its replacement with the refreshed upstream-sized catalog is not a Kilo fixture loss.
- `packages/opencode/test/provider/transform.test.ts` explicitly changes Grok 4/Grok 4.5 and OpenRouter-small-option expectations to match the chosen v1.18 adaptation. Those are recorded behavior choices with coverage, unlike the uncovered Kimi removal.
- `packages/opencode/src/config/config.ts`, `packages/opencode/src/tool/registry.ts`, `packages/tui/src/component/prompt/index.tsx`, and new code-mode source/tests add or move narrow markers around Kilo confinement, active-instance, sidebar-hint, spinner, and sandbox adaptations. No additional unexplained semantic Kilo loss was found in their three-way hunks.
- `packages/ui/src/i18n/nl.ts` gains the required new-file marker because that locale exists in Kilo's baseline/head but not pristine upstream. The marker is meaningful, not accidental broadening.
- The force-updated `packages/opencode/test/kilocode/issue-8656-stall.test.ts` ran both real regression paths successfully: bounded provider recovery and the explicit `timeout:false` hanging control. Raising the observation budget changes test tolerance only; it does not weaken assertions or skip the failure mode.

## Exact Command Outputs

- `git rev-parse HEAD` and `git rev-parse johnnyeric/kilo-opencode-v1.18.0` both output `c69ce6caf638617169509f09e3f5d620eb702146`.
- `git show -s --format='merge=%H%nparents=%P%nsubject=%s' 2847475275` outputs merge `2847475275e2eb68bdefda2296c38a96c0d76c68`, parents `b135b4e10a9028983497bf69cded47b6ce4572ff 32696c425fc0fa1ec285389346cfa1fbe22b670a`, subject `merge: record upstream v1.18.0`.
- `git diff --name-only b135b4e10a... c69ce6caf6 | wc -l` outputs `262`; `git diff --shortstat ...` outputs `262 files changed, 169695 insertions(+), 70035 deletions(-)`.
- Binary-safe per-path three-way classification outputs `total=262 upstream_match=145 three_way=117 baseline_equals_upstream=0`.
- Marker intersection/count audit outputs `baseline_marker_files=75 head_marker_files=79 marker_text_diff_files=22 marker_count_diff_files=19`.
- Repository `git grep` marker counts output baseline `806` files / `5983` lines, pristine upstream `0` files / `0` lines, and head `810` files / `6030` lines. Counts were used only as a cross-check, not as preservation proof.
- `bun run script/check-opencode-annotations.ts --base b135b4e10a...` outputs `Skipping shared upstream annotation check - upstream merge detected.` This is a skip, not a pass.
- `git diff --check b135b4e10a... c69ce6caf6` outputs nothing and exits `0`.
- `bun test ./test/provider/transform.test.ts` outputs `385 pass`, `0 fail`, `692 expect() calls`.
- Direct Kimi probe outputs `reasoningVariants=undefined`, `heuristicVariants={"high":{"thinking":{"type":"enabled","budgetTokens":16000}},"max":{"thinking":{"type":"enabled","budgetTokens":31999}}}`, and `options={"toolStreaming":false}`.
- `bun test ./test/cli/run/footer.view.test.tsx` outputs `24 pass`, `3 skip`, `0 fail`, `117 expect() calls`; it also emits existing unknown `leader` token warnings.
- `bun test ./test/kilocode/issue-8656-stall.test.ts` outputs `2 pass`, `0 fail`, `14 expect() calls`. The bounded control logs recovery after one stall; the `timeout:false` control logs a busy session ending at `step-finish:tool-calls` before cleanup.

## Limitations

- The audit used the supplied local commit objects and did not query or mutate GitHub. It therefore verifies the exact local reviewed head and ancestry, not remote mergeability or CI state.
- The annotation checker deliberately skips upstream merges, so the primary evidence is the per-path three-way comparison, marker-delta review, removed-Kilo-identifier scan, surrounding source/tests, and targeted execution.
- The Kimi probe verifies transformation output but does not send a live request to Moonshot/Kimi. Product support intent and endpoint acceptance remain the explicit human-verification requirement in the P2 finding.
- Marker-led review cannot prove preservation of an undocumented Kilo behavior that had no marker, Kilo identifier, test, or distinguishable baseline/upstream delta.
