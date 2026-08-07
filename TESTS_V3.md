# TESTS_V3.md — Kilo-specific test removal review, round 3

**Scope:** Round-3 review of the upstream-merge PR merging opencode v1.18.13 (`a105350812`) into Kilo. Reviewed HEAD `b6505b164b` (round 1 reviewed `cce22e608f`, round 2 `37a5cbf5db`). NEW PR base `6fce4e2564` (merge-base with main, verified via `git merge-base`). The delta under review is `git diff 37a5cbf5db..b6505b164b` (433 files — the branch merged in latest origin/main, plus two resolution commits `d99467fa02`, `e958d44860`). Question, unchanged: did this PR remove or weaken any Kilo-specific tests — and do the delta's new/changed tests assert the actual shipped behavior?

**Methodology:** (1) Re-checked all four open round-2 items at the new head (file content + delta touch status + attribution commits). (2) Delta review: zero test deletions (`--diff-filter=D` over `*test*`/`*spec*`/`*snap*`, case-insensitive re-run for Kotlin `*Test.kt`); `kilocode_change` marker-count comparison old-head vs new-head for all 115 touched test files; extracted all 47 removed `it/test/describe/expect` lines and attributed each to a behavior-matched source change or a replacement test; same extraction for removed Kotlin `@Test fun` methods. (3) Fresh full-PR sweep at the new base (`6fce4e2564...b6505b164b`, 419 files, 93 touched test files): deletions, marker deltas, removed test blocks, fixture/helper deletions. (4) Feature→test pairing for everything new landing via the main-merge (speech-to-text AAC, command-files endpoints, variant persistence, fork task remapping, grep signal controls, agent-manager additions). (5) Executed 20 targeted test runs at `b6505b164b` (outputs below; ~870 tests + 315 HTTP route scenarios, 0 persistent failures).

**Bottom line:** Both round-2 findings that were gaps in test coverage are RESOLVED (plain `grok-3` case restored, duplicate `grok-4.5` test removed). Round 1's two human-verification flags remain open; the stall-test one deepened slightly (Windows-specific budget). The delta deletes zero test files and weakens no Kilo assertion except one flagged item: two asterisk-absence assertions dropped from a TUI file-tree test by a branch-author stabilization commit. Every new feature that landed via the main-merge brought its tests, and the HTTP exercise coverage guard passes with 0 missing routes.

## Prior-findings verification

### 1. `oauth-browser.test.ts` CI-stability watch — STILL OPEN, unchanged

Marker count still 0 at `b6505b164b`; the delta does not touch the file. Passes locally again this round (3 pass, 0 fail, real HTTP round-trips). The slow-CI race question remains answerable only by post-merge CI observation. Unchanged from rounds 1–2.

### 2. `issue-8656-stall.test.ts` timeout relaxation — STILL OPEN, deepened (platform-scoped)

The delta touches this file again (`e958d44860 fix: stabilize Windows repository cache validation`, bundled with a `repository-cache.ts` fix): the stall-poll budget became `process.platform === "win32" ? 90_000 : 60_000`, and both test-case timeouts rose `120_000 → 180_000`. The non-Windows 60s budget from round 2 is unchanged; the new slack is Windows-only. Local evidence this round: **2 pass in 23.94s** — the stall is detected quickly on a healthy machine, so the budgets have large headroom here. Still flagged for a human to confirm the relaxations mask CI/Windows environment slowness only, not a post-merge stall-recovery regression.

### 3. Plain `grok-3` suppression coverage — RESOLVED

`d99467fa02 resolve merge conflicts` added `["grok-3", "@ai-sdk/xai"]` to the `test.each` in `test/kilocode/provider/grok-reasoning-variants.test.ts`. Verified in the file and in the run output (5 pass, includes the grok-3 case). The base behavior round 2 found uncovered is now tested again.

### 4. Duplicate `grok-4.5 uses standard reasoning efforts` in `transform.test.ts` — RESOLVED

`d99467fa02` removed the marked duplicate block (the delta removes exactly that `kilocode_change start/end` pair; marker count 26 → 24, fully explained). A single unmarked copy survives at `transform.test.ts:4860`. The marked Kilo-policy test `grok-4 suppresses generic provider efforts` (line 4238) is intact.

## New findings

### 1. TUI file-tree test lost its only "no text markers" guard (low — flag: human verification)

- **What:** `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`, test "does not render text markers for highlighted rows": the two closing assertions `expect(focused/unfocused.some((line) => line.includes("*"))).toBe(false)` were removed by `cb44dd327c fix(tui): stabilize highlighted file-tree test` (branch author, via the main-merge). The rest of the test (arrow-marker presence, focused/unfocused) survives.
- **Assessment:** The component at head (`packages/tui/src/feature-plugins/system/diff-viewer-file-tree.tsx`) renders no `*` anywhere, so the removed guard would pass today — the removal reads as flake-stabilization, not behavior-masking. But the no-text-marker property is now unpinned: if a future change (width-dependent truncation, status glyphs) introduces `*` into rows, nothing catches it. Suite passes at head (11 pass, 1 skip).
- **Action for a human:** Confirm the flake root cause (presumably a width/theme-dependent glyph in CI) and, if the property still matters, re-pin it with a deterministic render width.

### 2. `instance-vcs-watcher.test.ts` branch-update test flaked once under multi-file load (low — CI watch)

- **What:** In a 4-file parallel `bun test` run, `instances publish branch updates after git switch` failed once: `timed out waiting for vcs.branch.updated` after 16.67s (the wait helper's internal budget is 2s per attempt; total wall-clock includes instance setup). The same file passed 4/4 times in isolation (8s per run) and the delta's only change to this file is additive (new JetBrains eager-watcher case, matching the `KilocodeWatcher.eager("jetbrains")` source change).
- **Assessment:** Event-bus timing under parallel instance creation — a known flake shape for this suite, not a merge regression (no watcher source change weakens publication). Flagged so CI watchers aren't surprised if it recurs on loaded runners.

## Notable non-findings

- **Zero test-file deletions in the delta** (115 test files touched, 0 deleted; case-insensitive scan covers Kotlin `*Test.kt`). Full-PR deletions at the new base: only `packages/session-ui/src/components/markdown-preload.test.ts` (upstream deletion `638788f8d0`, no Kilo content — rounds 1–2) plus three dependency patch files (`@tanstack` ×2, `solid-js@1.9.10` superseded by the 1.9.12 bump). No fixture/snapshot/helper deletions; snapshot changes are updates (33 visual-regression PNGs refreshed/added, `parameters.test.ts.snap` extended with the new grep params, help snapshots updated).
- **Marker-count deltas across all 115 delta test files:** the only decrease is `transform.test.ts` 26→24 (the resolved duplicate, above). All other deltas are increases (Kilo coverage grew: `credential.test.ts` 5→10 with a marked "redacts bound values from query errors" test, `sqlite.test.ts` 0→2, `tui-plugin.ts` 2→5, `grep.test.ts` 3→4, `parameters.test.ts` 2→4, `task.test.ts` 26→28, `transform-i18n.test.ts` 2→3) or equal. Full-PR sweep at the new base reproduces rounds 1–2: only `oauth-browser.test.ts` 2→0 (open finding) and `account/service.test.ts` 1→0 (converged with upstream) decrease.
- **All 47 removed assertion lines in the delta are attributed to behavior-matched rewrites or replacements.** The largest: `session-fork-remap.test.ts` rewritten from "task detachment" to "task children" — fork now CLONES task child sessions under the forked parent and remaps references, pairing exactly with the new marked `KiloSession.remapChildren(...)` call in `session.ts` fork; assertions strengthened (cloned-ID ≠ child-ID checks, parent linkage, remapped text references) plus a new "ignores malformed task references" case. `task.test.ts` adds a marked test verifying forked task children remain resumable.
- **`summary-file-diff.test.ts`** updated `["patch"]` → `["after", "before", "patch"]` dropped-fields expectation, tracking the new marked `DiffInput { full, file }` full-content path in `summary.ts`; the feature itself is covered by 4 new `DiffFull.detail` live tests in `diff-full.test.ts` (modified/added/deleted/unchanged).
- **Three removed Kotlin test methods are behavior-tracking replacements by the JetBrains dev on main** (both with changesets): `multi hunk partial context patch is not renderable` → `6414e64b29 fix(jetbrains): render multi-hunk diffs` made multi-hunk patches renderable and replaced it with `multi hunk patch reconstructs concatenated changed regions` + `multi hunk patch with truncated context is not renderable`; the two RevertBanner header tests → `c47cfeceeb fix(jetbrains): align reverted diff action` renamed/updated them and added 5 rollback-banner tests.
- **`kilo web` help-snapshot removal is intentional:** the web command removal (`7f1b402587 chore(upstream): preserve kilo web command removal`, base PR #12978) drops the snapshot entry and the `WebCommand` registration from `help.test.ts`/`help-snapshots.test.ts`; merge tooling grew `remove-kilo-web.test.ts` (new) and a `skip-files.test.ts` case asserting `web.ts` is skipped. Self-consistent.
- **New main-merge features brought their tests:**
  - *Speech-to-text AAC compression* (base PR #12983): `speech-to-text-capture.test.ts` rewritten — PCM assertions replaced by AAC assertions (`AVEncoderBitRateKey` 24 kbps, `.m4a`) plus two new `ffmpegCaptureArgs`/`ffmpegPipeArgs` suites; exports verified in `src/speech-to-text/capture.ts`. 29 tests pass with the variant suites.
  - *Command-files endpoints* (`/kilocode/command/files`, `/kilocode/command/remove`): service-level `command-files.test.ts` (5 tests: discovery, legacy-workflow mapping, attribution precedence, symlinks, remove-validation) PLUS HTTP-level scenarios in `httpapi-exercise-scenarios.ts` including on-disk removal verification. The coverage runner passes `--fail-on-missing`: **315 pass, 0 fail, 0 missing, 0 extra**.
  - *Variant persistence*: CLI side `src/kilocode/cli/cmd/run/variant.ts` + `variant.test.ts` (4 tests); VS Code side `preserveVariant` + `session-variant-store.test.ts` (3 new tests) and `mode-model.test.ts` split the old "clears stale variant" case into nearest-effort-fallback and unknown-variant-clears — matching policies on both sides.
  - *Grep signal controls*: new `src/kilocode/tool/grep-signal-controls.ts` + dedicated test file, marked schema tests in `parameters.test.ts`, snapshot update, and a marked truncation-message update in `grep.test.ts`.
  - *Agent-manager additions* (multi-project, git stats, model usage, gh executable resolution): 8 new kilo-vscode unit suites, 289 tests executed green across two runs.
- **Full-PR removed test blocks at the new base are all attributed:** upstream's own removals from rounds 1–2 (`smallOptions...weakest effort is low` ← `68f225a11d`, `mode cost preserves over-200k pricing` ← `e434ce01d3`, `message-file` inline-references case, `markdown-preload`), the Kilo tooling rename (`fixCatalog removes upstream-only desktop sentry entries` → expanded to `removes unsupported upstream entries` + new `transformDependencies` test), the resolved grok cases, and pure re-indentation moves in `transform.test.ts` (removed lines re-added verbatim on the `+` side; `gpt-5.5 should NOT set reasoningEffort for the completions API` survives at line 736).
- **New Kilo source files lacking a dedicated test are trivial:** `pii.ts` (single exported constant), `task-resume.ts` (2-line hint formatter, behavior exercised via `session-fork-remap.test.ts`), `spawn-exit.ts` (15-line WeakSet helper, exercised through `ripgrep-settlement.test.ts` process-lifecycle tests), `focus-panel.ts` (small agent-manager helper). All other new kilo/kilocode source files pair with a new or updated test.

## Test-run outputs (all at `b6505b164b`, bun test v1.3.14)

| Run (cwd) | Result |
|---|---|
| `bun test ./test/kilocode/provider/grok-reasoning-variants.test.ts ./test/kilocode/command-files.test.ts ./test/kilocode/cli/run/variant.test.ts` (packages/opencode) | 14 pass, 0 fail (3.30s) |
| `bun test ./test/kilocode/session-fork-remap.test.ts` (packages/opencode) | 8 pass, 0 fail, 42 expects (17.46s) |
| `bun test ./test/mcp/oauth-browser.test.ts ./test/kilocode/tool/grep-signal-controls.test.ts` (packages/opencode) | 7 pass, 0 fail (7.73s) — round-1 flagged file green again |
| `bun test ./test/kilocode/issue-8656-stall.test.ts` (packages/opencode) | 2 pass, 0 fail (23.94s) — stall detected fast; 60s budget has headroom locally |
| `bun test ./test/provider/transform.test.ts ./test/cli/help/help-snapshots.test.ts ./test/kilocode/help.test.ts` (packages/opencode) | 462 pass, 0 fail, 33 snapshots (31.60s) |
| `bun test ./test/kilocode/diff-full.test.ts ./test/kilocode/summary-file-diff.test.ts ./test/kilocode/database/sqlite-error.test.ts ./test/kilocode/cli/cmd/run-terminal.test.ts` (packages/opencode) | 21 pass, 0 fail (16.54s) |
| `bun test ./test/kilocode/server/tui-config.test.ts ./test/kilocode/instance-vcs-watcher.test.ts ./test/kilocode/agent-manager-tool.test.ts ./test/kilocode/test-runner-cleanup.test.ts` (packages/opencode) | 41 pass, **1 fail** — vcs-watcher flake, see New finding 2 |
| `bun test ./test/kilocode/instance-vcs-watcher.test.ts` ×4 isolated (packages/opencode) | 4 pass, 0 fail every run (~8s each) |
| `bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip` (packages/opencode) | `summary pass=315 fail=0 skip=0 missing=0 extra=0` |
| `bun test test/cli/tui/diff-viewer-file-tree.test.tsx test/kilocode/data.test.ts test/kilocode/spinner-runtime.test.ts` (packages/tui) | 11 pass, 1 skip, 0 fail |
| `bun test test/kilocode/interactive-terminal.test.tsx` (packages/tui) | 1 pass, 0 fail |
| `bun test tests/unit/session-variant-store.test.ts tests/unit/mode-model.test.ts tests/unit/speech-to-text-capture.test.ts` (packages/kilo-vscode) | 29 pass, 0 fail |
| `bun test` on 6 agent-manager suites (arch, terminal-side/routing/layout/state, new-worktree-project) (packages/kilo-vscode) | 133 pass, 0 fail, 590 expects |
| `bun test` on 12 kilo-vscode unit suites (gh, git-executable, git-stats-snapshot, model-usage-history, provider-multi-version, session-model-selector, session-variants, model-selector-utils, git-ops, git-stats-poller, sandbox-bootstrap, format-keybinding) | 156 pass, 0 fail |
| `bun test test/kilocode/{database-migration-compat,reference-materialization,ripgrep-settlement}.test.ts` (packages/core) | 7 pass, 0 fail |
| `bun test ./test/credential.test.ts` (packages/core) | 5 pass, 0 fail |
| `bun test src/__tests__/telemetry.test.ts` (packages/kilo-telemetry) | 17 pass, 0 fail |
| `bun test ./test/sqlite.test.ts` (packages/effect-drizzle-sqlite) | 8 pass, 0 fail |
| `bun test ./script/upstream/transforms/{skip-files,remove-kilo-web,transform-package-json,transform-i18n}.test.ts` (root) | 37 pass, 0 fail |

Total: ~870 tests + 315 route scenarios executed, 0 persistent failures (one parallel-load flake, New finding 2).

## Limitations

- Local execution, not CI: the `oauth-browser.test.ts` slow-CI race (round-1 finding) and the stall-test budget question (deepened this round) can only be settled by CI observation after merge. Local runs show large timing headroom on this machine.
- The kilo-jetbrains Gradle suites were not executed (test changes reviewed statically; all removals attributed to behavior-changing fix commits with replacements).
- The Playwright spec `model-selector-accessibility.spec.ts` (rewritten for flat relevance-ranked search) was not executed — needs the storybook/browser harness; reviewed statically against the selector source change.
- Root `bun test` is blocked by design (`do not run tests from root`); script-tooling tests were run with explicit `./script/...` paths per the `test:script:ci` convention.
- Marker counting and upstream-attribution carry the rounds 1–2 caveat: a Kilo assertion written in fully generic terms inside a shared file is indistinguishable from upstream content. Mitigations unchanged: per-block attribution against upstream tag `a105350812` and `git log -S` over the upstream range; every removed block in both the delta and the full-PR sweep is attributed.
