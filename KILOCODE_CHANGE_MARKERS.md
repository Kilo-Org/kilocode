# `kilocode_change` Audit: PR #12204

Audited current HEAD `472247daa9063cf7dfea423bec64c46cea44ba36` against base `c49560af0f94459015d3fa4e1efa23ad9b291955`.

**Scope:** all **972 changed files** were included in the audit (`170` added, `545` modified, `60` deleted, `197` renamed). Marker text changed in 95 paths. The audit combined the complete name/status and diff inventories with marker-specific diffs, rename/deletion tracing, block-balance checks, targeted base/current semantic comparisons, the marker normalizer dry run, and current PR CI logs. This is not an exhaustive per-file checklist.

## Findings

### High: Kilo TUI prompt arbitration was removed during the package extraction

`packages/tui/src/routes/session/index.tsx:254-299` still computes Kilo-only suggestion, network, interactive-terminal, blocking-question, and visibility state. However, the corresponding base render block was removed. The current input area at `packages/tui/src/routes/session/index.tsx:1422-1460` renders only permissions, the first question, the subagent footer, and the normal prompt.

Compared with the base implementation, current code no longer renders:

- `TerminalPrompt` while an interactive terminal owns input.
- Blocking `SuggestPrompt` requests.
- `NetworkPrompt` reconnect requests.
- Non-blocking questions with `nonBlocking` and `inputFocused` props.
- The base guard that kept permission/prompt input hidden while a terminal was active.

The retained imports and computed values are now unused (`TerminalPrompt`, `SuggestPrompt`, `NetworkPrompt`, `terminal`, `question`, `blockingSuggestion`, `networkVisible`), while `visible()` becomes false and suppresses the normal prompt. Users can therefore be left with no actionable input UI. Restore the base Kilo arbitration semantics around the upstream extracted prompt/slot structure and add focused coverage for terminal, blocking suggestion, network wait, and non-blocking question states.

This loss also made the markers structurally invalid: `packages/tui/src/routes/session/index.tsx:1460` is an orphaned `kilocode_change end` after its opening marker was deleted.

### High: The extracted TUI package breaks CLI/serve subprocess startup in CI

Current Linux CI repeatedly fails before command execution with:

```text
Cannot find module 'react/jsx-dev-runtime' from 'packages/tui/src/config/index.tsx'
```

The extracted JSX module starts at `packages/tui/src/config/index.tsx:1`; `packages/tui/tsconfig.json:5-6` declares `jsx: preserve` and `jsxImportSource: @opentui/solid`, and `packages/tui/bunfig.toml:1-4` provides the OpenTUI preload only when Bun starts in that package. Importing `@opencode-ai/tui/config` from CLI/serve subprocesses does not apply the package-local Bun config, so runtime JSX resolution falls back to React. This causes `kilo run` subprocess tests to exit 1 and `kilo serve` readiness tests to time out.

Make the extracted package consumable from the CLI process without relying on the consumer's current working directory for JSX runtime setup. Add a subprocess smoke test that imports/starts the CLI from `packages/opencode` under the production conditions.

### High: Dismissed-question rendering was partially deleted and its marker block is invalid

The base `Question` renderer showed dismissed and answered question content behind a collapsible one-line summary, and recognized dismissal represented either by metadata or an error containing `dismissed`. Current `packages/tui/src/routes/session/index.tsx:2816-2858`:

- Recognizes only `props.metadata.dismissed === true` at line 2820.
- Computes `title` and `subtitle` at lines 2829-2834 but never uses either.
- Renders a detail block only when `answers()` is present, so dismissed/error states without answers fall through to `Asked N questions` and lose the questions and `Dismissed` status.
- Removed the expand/collapse state and click behavior.

Restore the base dismissed/error detection and collapsible detail behavior around the upstream parser changes. The block has two orphaned closing markers at lines 2835 and 2853. Across the whole changed-file set, the marker-balance scan found only four unequal files; the other three (`packages/opencode/src/provider/provider.ts`, `packages/opencode/src/session/message-v2.ts`, and `packages/opencode/src/tool/read.ts`) already had their same imbalance in the base, while this TUI file changed from balanced `33/33` to `23/26` and is a merge-introduced defect.

### Medium: Kilo process/run correlation metadata was dropped from the CLI and TUI worker

The base main entrypoint called `ensureProcessMetadata("main")`, logged `process_role`/`run_id`, and the TUI worker called `ensureProcessMetadata("worker")`. The base worker spawn also used `sanitizedProcessEnv` to set `KILO_PROCESS_ROLE=worker` and propagate a stable `KILO_RUN_ID`.

Current code has no call sites for `ensureProcessMetadata` or `ensureRunID`; only the unused definitions remain. `packages/opencode/src/cli/cmd/tui.ts:169-175` copies `process.env` but does not assign either metadata variable, `packages/opencode/src/cli/tui/worker.ts:1-16` initializes logging without worker metadata, and `packages/opencode/src/index.ts:34-81` no longer initializes or reports main-process metadata. `packages/core/src/util/log.ts` still reads `KILO_RUN_ID`, so compatibility logs lose cross-process correlation and worker role attribution.

Restore metadata initialization and explicit worker overrides, or document and test a deliberate replacement based on the new observability `runID`. Human verification is needed to decide whether upstream's new per-process observability ID intentionally supersedes Kilo's shared parent/worker run ID; the current retained helper and logger dependency indicate the removal is incomplete.

### Medium: The Darwin Kilo test profile still names a deleted test directory

`packages/opencode/script/kilocode/test-profile.ts:25` includes `reference/*.test.ts`, but this merge deletes `packages/opencode/test/reference/reference.test.ts` and leaves no matching directory. The macOS CI job exits before running tests with `Invalid test profile "darwin": Unmatched patterns: reference/*.test.ts`; the profile self-tests fail for the same reason.

Remove or migrate the stale profile entry to the replacement reference coverage. This is a Kilo-owned merge-follow-up missed when upstream moved/replaced reference tests.

### Medium: OpenRouter variant semantics disagree with the merged tests

Linux CI reports three failures in `packages/opencode/test/provider/transform.test.ts:2961-3030`. The tests require generic OpenRouter reasoning models and Gemini 3 to expose `low/medium/high`, and `openai/o3-mini` to expose the OpenAI effort set. Current `packages/opencode/src/provider/transform.ts:776-787` returns `{}` for generic models, uses the full `OPENAI_EFFORTS` for non-GPT Gemini models, and gates OpenAI effort resolution on `id.includes("gpt")`, excluding `o3-mini`.

Reconcile the implementation with the updated expected behavior and rerun the targeted provider transform suite. The switch shares a Kilo Gateway case and contains Kilo markers, so the semantic mismatch is relevant to this upstream-merge audit even though some surrounding changes originated upstream.

## Notable Non-Findings

- The post-merge fix correctly moved Kilo internal TUI plugin registration into `packages/opencode/src/kilocode/plugins/internal.ts` and retained a narrow marked hook in `packages/opencode/src/plugin/tui/internal.ts`; all 15 Kilo plugins from the base registry remain registered before upstream built-ins.
- Dedicated Kilo renderers for `background_process`, `interactive_terminal`, and `semantic_search` were restored in `packages/tui/src/routes/session/index.tsx`, with focused tests in `packages/tui/test/cli/tui/inline-tool-wrap-snapshot.test.tsx`.
- Kilo branding/config integrations, custom Kilo themes, terminal title effects, daemon attach, cloud-session import, authenticated worker transport, config warnings, workspace re-bootstrap, Kilo event synchronization, Kilo exit epilogue, and reactive slot fallback behavior were found at their replacement locations.
- Marker removal in deleted reference/account/ripgrep code generally tracks upstream subsystem replacement, with Kilo credential migration moved to `packages/core/src/kilocode/credential-migration.ts` and reference hooks moved to Kilo-owned code. No additional definite Kilo behavior loss was identified there.
- The 100% theme-asset and utility renames preserved content; no marker loss was found in those pure moves.
- No broad whole-file `kilocode_change - new file` annotation was found masking the extracted `packages/tui` package. Most retained Kilo deltas there remain narrowly marked.

## Commands And Results

- `git rev-parse HEAD` -> `472247daa9063cf7dfea423bec64c46cea44ba36`.
- `git diff --name-only c49560af0f94459015d3fa4e1efa23ad9b291955...HEAD | wc -l` -> `972`.
- Name/status classification -> `170 A`, `545 M`, `60 D`, `197 R`.
- `git diff --find-renames --name-status -Gkilocode_change ...` plus deduplication -> marker text changed in `95` paths.
- Full `git diff --stat`, `--numstat`, `--summary`, `--name-status`, rename-aware targeted diffs, and base/current `git grep` marker inventories were reviewed. Aggregate diff: `40,251 insertions`, `26,427 deletions`.
- Changed-file marker-balance scan -> four unequal files; only `packages/tui/src/routes/session/index.tsx` newly became imbalanced (`33/33` at base, `23/26` at HEAD).
- `bun run script/upstream/fix-kilocode-markers.ts packages/tui/src/routes/session/index.tsx --dry-run` -> would update the file and warns of two upstream-only deleted lines.
- `bun run script/check-opencode-annotations.ts --base c49560af0f94459015d3fa4e1efa23ad9b291955` -> `Skipping shared upstream annotation check — upstream merge detected.`
- `gh pr checks 12204` / `gh pr view 12204 --json ...` -> annotation check and typechecks pass, but the PR is blocked by Linux, macOS, and Windows unit failures.
- Annotation CI job `29360349174/87178528632` -> the nominally passing annotation step printed the same upstream-merge skip; it audited no annotations. Other guards in that job passed.
- Linux unit logs `29360349529/87178926358` and `.../87178926404` -> OpenRouter variant failures, TUI `react/jsx-dev-runtime` import failures, stale Darwin profile, and additional unrelated/secondary failures including `AppRuntime.dispose` test cleanup and a Bun crash.
- macOS unit log `29360349529/87178926380` -> stopped on unmatched `reference/*.test.ts` in the Darwin profile.
- `git diff --check ...` -> two trailing-whitespace errors in `patches/@ff-labs%2Ffff-bun@0.9.3.patch` (lines 7 and 29); noted as non-marker hygiene, not a marker finding.
- Local TUI typecheck could not run because `tsgo` is unavailable in this checkout environment. Focused local TUI tests could not start because `@opentui/solid/preload` is unavailable locally. GitHub `typecheck-js` passed, but runtime subprocess tests failed as described above.

## Limitations

- This was a static/CI-log upstream-merge audit, not an interactive TUI run. The prompt arbitration and dismissed-question findings are direct base/current control-flow differences with unused retained state, but final UX should be manually verified after repair.
- The repository checker intentionally skips upstream merges, and the green GitHub annotation check is therefore not evidence of marker completeness. Marker validity was assessed with custom revision-aware inventories, balance checks, rename/deletion tracing, semantic comparisons, and the marker fixer dry run.
- Generated SDK/OpenAPI files, lockfiles, binary/theme assets, bulk upstream tests, and pure renames were audited by provenance, status, marker inventory, and semantic linkage rather than line-by-line prose inspection.
- Existing untracked reports from other agents were not read, modified, deleted, staged, or cleaned.
