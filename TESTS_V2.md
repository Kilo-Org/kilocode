# TESTS_V2.md — Kilo-specific test removal review, round 2

**Scope:** Round-2 review of the upstream-merge PR merging opencode v1.18.13 (`a105350812`) into Kilo. Reviewed HEAD `37a5cbf5db` (round 1 reviewed `cce22e608f`); pre-merge Kilo base `b135b4e10a`. The delta under review is `git diff cce22e608f..37a5cbf5db` (65 files, 4 fix commits: `cbbbd7217f`, `af6d1ded6d`, `a4d86f117f`, `37a5cbf5db`). Question, unchanged from round 1: did this PR remove or weaken any Kilo-specific tests — and do the delta's new tests actually assert the fixed behavior?

**Methodology:** (1) Re-checked both round-1 findings at the new head (file content + delta touch status). (2) Read every delta-added/-modified test file in full and matched each against the source change it asserts (`transform.ts`, `task.ts`, `meta.txt`, `modal.ts`, `models.ts`, `footer.command.tsx`, `language.tsx`, `provider-error.ts`, prompt-input store, merge tooling). (3) Fresh sweep of the full PR diff (`b135b4e10a..37a5cbf5db`): deleted test files (`--diff-filter=D`), removed `it/test/describe` lines, `kilocode_change` marker-count deltas for every touched test file; every removed test block was attributed by checking presence at upstream tag `a105350812` and, where absent there, by `git log -S` on the upstream range `6697cf3fd8..a105350812` (merge-base..tag). (4) Executed the delta-added/-modified tests plus round-1's flagged file; outputs below. (5) Ran the new `script/check-test-ci.ts` guard.

**Bottom line:** Round 1's two flags are unchanged (neither addressed nor worsened). The delta removes no Kilo test and weakens no Kilo assertion; every delta test change is additive or a marked replacement of an *upstream* assertion with the Kilo-intentional inverse. All new tests assert the actual fixed behavior and pass locally (525 tests executed across 9 targeted runs, 0 failures). Two new low-severity items are flagged for human verification.

## Round-1 verification status

### 1. `packages/opencode/test/mcp/oauth-browser.test.ts` — STILL VALID, not addressed

Marker count still 0 at `37a5cbf5db`; the delta does not touch the file. The upstream rewrite (real `Bun.serve` OAuth server + injected `McpBrowser` layer) stands as merged. New evidence: the file passes locally at this head (3 pass, 0 fail, 3.8s, real HTTP round-trips on 127.0.0.1). One local pass does not answer the slow-CI race question — the CI-flakiness watch item remains open for post-merge CI observation.

### 2. `packages/opencode/test/kilocode/issue-8656-stall.test.ts` — STILL VALID, not addressed

Line 130 still polls with `60_000` ms; the delta does not touch the file. The doubled stall-tolerance budget remains a deliberate Kilo-side relaxation (`25f4b58d93`) that a human should confirm masks environment slowness only, not a post-merge stall-recovery regression. Not executed in this round (needs up to 60s of polling per run; see Limitations).

## New findings

### 1. Plain `grok-3` variant-suppression coverage dropped at the merge and not restored by the delta (low — flag: human verification)

- **What happened:** Base `b135b4e10a` had two unmarked Kilo assertions in `packages/opencode/test/provider/transform.test.ts`: `grok-4 returns empty object` (openrouter) and `grok-3 returns empty object` (xai), both asserting `ProviderTransform.variants(...) → {}`. The merge (`cce22e608f`) replaced them with upstream's `grok-4 uses the provider's standard efforts`, flipping the asserted behavior to upstream's. The delta restored the Kilo policy: source `transform.ts` gained `if (id.includes("grok") && !id.includes("grok-4.5")) return {}` (marked), `transform.test.ts` gained the marked `grok-4 suppresses generic provider efforts` (`toEqual({})`), and the new `test/kilocode/provider/grok-reasoning-variants.test.ts` covers xai `grok-4`, openrouter `x-ai/grok-code-fast`, `grok-3-mini`, and `grok-4.5`.
- **The gap:** no test at the new head covers **plain `grok-3`** (xai) suppression — the one base case not restored. The behavior is still implemented (the `id.includes("grok")` branch catches it; verified by reading the branch order: the `grok-3-mini` special case returns first, then generic suppression, then the npm switch).
- **Action for a human:** Add `["grok-3", "@ai-sdk/xai"]` to the `test.each` in `grok-reasoning-variants.test.ts`, or confirm the case was intentionally dropped (e.g. model no longer offered).

### 2. Duplicate test `grok-4.5 uses standard reasoning efforts` in `transform.test.ts` (low — flag: human verification)

- **What:** The test appears **twice** in the same `describe("@ai-sdk/xai")` block (`transform.test.ts:4860` unmarked, and again at ~`:4891` inside a `kilocode_change start/end` block) with byte-identical body and assertions. Introduced by `76783409bf` during the merge (already duplicated at `cce22e608f`); the delta did not add or remove it. Both copies pass (the file runs 439 tests green), so it is benign, but the marked copy is redundant — upstream's unmarked original asserts the same thing.
- **Action for a human:** Drop the marked duplicate to keep the file's deviation surface minimal for future merges.

## Notable non-findings

- **`script/translate-app.test.ts` is DELETED by the delta, not added** (correcting the review brief's file list). `cbbbd7217f` removes `script/translate-app.ts` (523 lines), `translate-app.test.ts` (168), and `translate-app.md` together — the fix for round-1 INFRASTRUCTURE_CHANGE.md finding 2 (upstream maintainer tooling landed with unmarked `KILO_*` renames and a wrong `opencode` binary). Net effect on the full PR diff is **zero**: the files never existed at base (added mid-branch in `76783409bf`, removed before head). The deleted test was upstream's own (byte-identical to upstream at merge head, 0 markers) testing only the deleted script — self-consistent, no Kilo coverage lost. The deletion is completed by the merge tooling: `skip-files.test.ts` asserts `defaultConfig.skipFiles` matches all three translate-app paths, `transform-package-json.test.ts` asserts `translate:app` is stripped from root scripts (removal count 3→4), and root `package.json` no longer has `translate:app`.
- **All delta-added tests assert the fixed behavior and live in proper locations.** The four new opencode suites are under `test/kilocode/` (no markers needed): `provider/grok-reasoning-variants.test.ts` ↔ `transform.ts` grok suppression; `provider/kimi-adaptive-effort.test.ts` ↔ `isKimiFamily` null-tolerance (`id?.toLowerCase() ?? ""`) plus adaptive-thinking variants, including the partial-metadata case with no `providerID`/`url`; `session/meta-prompt.test.ts` ↔ `meta.txt` Kilo branding (asserts `You are Kilo`, `kilo.ai/docs`, and the *absence* of OpenCode strings); `task-nesting.test.ts` (8 tests) ↔ `task.ts` `NotFoundError`-tolerant ancestor walk plus permission/sandbox inheritance. Shared-path additions carry markers: `store.test.ts` (upstream-owned session-ui file) adds exactly 3 Kilo cases in one marked block; `modal-models.test.ts`, `transform.test.ts`, `footer.view.test.tsx` changes are marked; `provider-error.test.ts` adds 2 line-marked messages. New merge-tooling tests (`script/upstream/transforms/skip-files.test.ts`, `transform-i18n.test.ts`) follow the existing unmarked convention of that Kilo-owned directory; the new `script/check-test-ci.ts` carries the `// kilocode_change - new file` header.
- **The delta's two assertion replacements are upstream assertions inverted to Kilo behavior, both marked** — not removals of Kilo coverage: upstream's `hides Modal models when discovery fails` (`toEqual({})`) became `preserves Modal models when discovery fails` (`toEqual(provider.models)`) matching `modal.ts`'s new catalog-preserving fallback, plus a new no-credentials case; upstream's `grok-4 uses the provider's standard efforts` became the suppression test noted above.
- **Fresh full-PR sweep at the new head reproduces round 1's results.** Deleted test files: only `packages/session-ui/src/components/markdown-preload.test.ts` (upstream deletion `638788f8d0`, no Kilo content, stale 3-arg signature — unchanged from round 1). Marker-count decreases across all 60+ touched test files: only `oauth-browser.test.ts` 2→0 (round-1 finding 1) and `account/service.test.ts` 1→0 (converged with upstream, line unchanged — round-1 non-finding). All other deltas are increases: `models.test.ts` 0→6, `footer.view.test.tsx` 5→10 (delta added the marked ctrl+p block), `thread.test.ts` 2→4, `modal-models.test.ts` 0→4, `transform.test.ts` 24→26, `provider-error.test.ts` 0→2, `code-mode.test.ts` 0→19, `code-mode-integration.test.ts` 0→18, `registry.test.ts` 28→32, `store.test.ts` 0→2.
- **Every removed `it/test/describe` block in the full PR diff is upstream-attributed:** `gpt-5.5 should NOT set reasoningEffort` was *renamed* by upstream to `...for the completions API` and survives at head (`transform.test.ts:736`); `smallOptions disables OpenRouter reasoning when the weakest effort is low` was removed by upstream `68f225a11d`; `mode cost preserves over-200k pricing from base model` was removed by upstream `e434ce01d3`; the `message-file.test.ts` inline-references case is upstream's removal (round 1). The two grok empty-object removals are covered under New finding 1.
- **`footer.view.test.tsx` modification strengthens coverage:** the single `ARROW_UP` close-check became ctrl+p *and* `ARROW_UP` checks (marked), matching `footer.command.tsx`'s new `up()` helper that unifies both bindings at panel boundaries. `language-utils.test.ts` (Kilo-owned path) adds a `localeToBcp47` describe (`br→pt-BR`, `zht→zh-TW`, live `Intl.PluralRules`) matching the `language.tsx` plural fix.
- **New CI test infrastructure is self-consistent:** `test.yml` gains `Verify package test scheduling` (`check-test-ci.ts`) and `Run root tooling unit tests` (`test:script:ci`) steps inside the existing marked block, plus junit paths extended to `.artifacts/unit/junit.xml` for both reporting and upload; `package.json` adds `test:script:ci` (`bun test ./script` with junit reporter). The guard passes locally (`check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))`).
- **Patch changes in the delta are test-safe:** `patches/@dnd-kit%2Fdom@0.5.0.patch` removed and `solid-js` patch bumped 1.9.10→1.9.12; no test file references `dnd-kit` (grep over `packages/opencode/test`, `packages/session-ui/src`, `packages/ui/src`).

## Test-run outputs (all at `37a5cbf5db`, bun test v1.3.14)

| Run (cwd) | Result |
|---|---|
| `bun test test/kilocode/provider/grok-reasoning-variants.test.ts test/kilocode/provider/kimi-adaptive-effort.test.ts test/kilocode/session/meta-prompt.test.ts` (packages/opencode) | 8 pass, 0 fail (1.05s) |
| `bun test test/kilocode/task-nesting.test.ts` (packages/opencode) | 8 pass, 0 fail, 27 expects (3.64s) |
| `bun test test/plugin/modal-models.test.ts` (packages/opencode) | 3 pass, 0 fail; log shows new `modal model discovery failed` warn path exercised |
| `bun test test/provider/transform.test.ts` (packages/opencode) | 439 pass, 0 fail, 812 expects |
| `bun test test/cli/run/footer.view.test.tsx` (packages/opencode) | 25 pass, 3 skip, 0 fail |
| `bun test test/mcp/oauth-browser.test.ts` (packages/opencode) | 3 pass, 0 fail (3.80s) — round-1 flagged file |
| `bun test ./script` (root; what `test:script:ci` runs) | 55 pass, 0 fail across 10 files |
| `bun test src/v2/components/prompt-input/store.test.ts` (packages/session-ui) | 8 pass, 0 fail |
| `bun test test/provider-error.test.ts` (packages/llm) | 2 pass, 0 fail |
| `bun test tests/unit/language-utils.test.ts` (packages/kilo-vscode) | 20 pass, 0 fail |
| `bun run script/check-test-ci.ts` (root) | `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))` |
| `bun run script/check-opencode-annotations.ts --worktree` (root) | `No shared upstream source files changed — nothing to check.` |

Total: 525 tests executed, 0 failures.

## Limitations

- Local execution, not CI: round-1 finding 1's slow-CI race question can only be settled by CI observation after merge; a single local pass of `oauth-browser.test.ts` is weak evidence.
- `issue-8656-stall.test.ts` was not executed (up to 60s polling per case and it exercises real stall timing, not a fixed behavior); round-1 finding 2's justification question remains open.
- Marker counting and upstream-attribution carry round 1's caveat: a Kilo assertion written in fully generic terms inside a shared file is indistinguishable from upstream content. The per-block upstream attribution (presence at `a105350812`, then `git log -S` on `6697cf3fd8..a105350812`) mitigates this for removed blocks; all were attributed.
- The ~45 test files byte-identical to upstream were not re-read line by line (unchanged from round 1); upstream's own test changes remain out of scope.
