# Kilo Test Coverage Preservation Audit

## Scope And Methodology

- Reviewed Kilo-Org/kilocode PR #12695 at exact head `054ee594915b93546d0613a45e0671edd43905ee` against base and merge base `0b8f749ae13388cf7a38ea7fb9183acaac99eef8` on macOS, branch `johnnyeric/kilo-opencode-v1.17.13`.
- Read root `AGENTS.md`, `REVIEW.md`, `packages/opencode/AGENTS.md`, `packages/opencode/test/AGENTS.md`, relevant package guidance for `packages/llm`, `packages/schema`, and `packages/kilo-vscode`, plus `kilo-steer` and the read-only review procedure.
- Inventoried test/spec paths, test directories, fixtures, recordings, snapshots, package scripts, Turbo scheduling, and `.github/workflows/test.yml` with Git rename/copy detection. Compared deleted files, removed declarations/assertions, and Kilo-related concepts between base and final head.
- Treated paths containing `kilo`/`kilocode` as Kilo-owned, then searched changed shared tests for `kilocode_change`, `KILO_*`, Kilo branding, `@kilocode`, `api.kilo`, providers, Kilo APIs, and Kilo fixtures.
- Compared extracted test names in Kilo-owned suites at both revisions and traced unmatched names and assertions into final-head tests and implementations. Running tests was limited to targeted controls because this is a coverage-preservation audit.

## Findings

### P3: Direct coverage for replacing stale Kilo references was removed

- **Old path/test:** `packages/core/test/reference.test.ts`, `replaces sources without a scoped transform`.
- **Removed Kilo invariant:** `Reference.Service.replace(...)`, a Kilo-specific API, must remove stale effective references and install the new set without relying on a request-scoped transform slot.
- **Equivalent final-head coverage:** No. `packages/opencode/test/kilocode/reference.test.ts` still exercises `KiloReference.sync(...)` and proves metadata is installed from an initially empty service, but it does not seed a stale source and prove it is removed. The final-head test `sync does not publish an update for equivalent references` covers the no-op branch, not replacement of a differing set.
- **Evidence:** Final head still declares the Kilo-only API at `packages/core/src/reference.ts:38` and implements it at lines 116-124. Its production caller remains `packages/opencode/src/kilocode/reference.ts:153-190`, ending in `yield* service.replace(sources)`. The base test seeded `stale`, invoked `replace([["current", current]])`, and asserted that only `current` remained; that test block is absent at head. A concept search found no other final-head test of `Reference.Service.replace`.
- **Direction:** Restore a focused Kilo test, preferably under `packages/core/test/kilocode/` or `packages/opencode/test/kilocode/`, that seeds stale and retained/replacement entries, invokes the real `replace` or `KiloReference.sync` path, and asserts the exact final list. Human verification should also confirm that repeated reconciliation cannot retain references removed from effective Kilo config.

### P3: OpenAI OAuth page branding coverage was weakened from rendered output to source text

- **Old path/test:** `packages/opencode/test/kilocode/oauth-branding.test.ts`, `extracted core OAuth browser flow uses Kilo branding` (renamed at head to `core OAuth browser flow uses Kilo branding`).
- **Removed Kilo invariant:** The HTML actually served by the OpenAI OAuth callback must contain Kilo branding and no OpenCode branding, including the document title.
- **Equivalent final-head coverage:** Partial only. The renamed test checks that `openai.ts` mentions `KiloOauthCallbackPage` and that the wrapper source contains `.replaceAll("OpenCode", "Kilo")`; it no longer calls the wrapper or asserts rendered HTML. `packages/core/test/oauth-page.test.ts` executes only the unbranded upstream `OauthCallbackPage.bootstrap` escaping path.
- **Evidence:** Base assertions required `<title>Kilo</title>` and rejected `<title>OpenCode</title>`. Head replaced them with source-text assertions. `git grep` found no test invoking `KiloOauthCallbackPage.success` or `.error`. A diagnostic execution at the pinned head currently produced `Authorization successful · Kilo` and `Authorization failed · Kilo`, with `hasOpenCode: false`, so this is lost regression detection rather than a current runtime defect.
- **Direction:** Execute `KiloOauthCallbackPage.success()` and `.error()` in the Kilo branding test and assert representative visible text/title contains `Kilo` and excludes `OpenCode`. Retain the OpenAI call-site assertion if desired, but do not use source inspection as the only branding contract.

## Notable Non-Findings

- No Kilo-owned test file was deleted or renamed. Across `packages/opencode/test/kilocode` and `packages/core/test/kilocode`, the reviewed diff contains 127 changed files: 124 modified and 3 added, with 1,746 added and 1,528 deleted lines. Test-name extraction found 3,017 distinct names at base and 3,021 at head; the only unmatched Kilo-suite name was the OAuth test renamed above. The apparent removed compaction and `maxOutputTokens` declarations were formatting changes; their cases and assertions remain.
- The seven deleted test files are shared upstream architecture tests, not Kilo-specific files: `packages/core/test/model-request.test.ts`, `packages/core/test/plugin/provider-helper.ts`, `packages/core/test/public-opencode.test.ts`, `packages/core/test/public-tool.test.ts`, `packages/core/test/session-logging.test.ts`, `packages/opencode/test/effect/app-graph-types.test.ts`, and `packages/opencode/test/effect/app-graph.test.ts`. No file contains Kilo branding, Kilo providers, custom Kilo APIs, or `kilocode_change` markers at base.
- The deleted app-graph tests moved conceptually to final-head layer-node tests in `packages/core/test/effect/layer-node/`; replacement propagation, unused replacements, dependency replacement, graph compilation, and type exploration remain covered. The old public API was replaced by the Protocol/Client/SDK Next architecture, with real embedded session/tool coverage in `packages/sdk-next/test/embedded.test.ts` and contract identity/generation coverage in `packages/client/test/contract-identity.test.ts`. `ModelRequest.normalizeAiSdkOptions` and its source module no longer exist, so its dedicated tests are obsolete rather than silently dropped.
- The base Kilo assertions that interruption did not create a durable `session.next.interrupt.requested` record became obsolete with the upstream architecture. Head removed that event contract and sequence-aware coordinator API and directly delegates process-local interruption; `packages/core/test/session-prompt.test.ts` retains delegation and empty-transcript checks. There is no final-head interrupt event to preserve coverage for.
- The removed direct reference replacement case is the only Kilo-specific shared test block found without equivalent final-head coverage. Renamed RuntimeFlags cases retain the same `KILO_*` inputs and assertions. The modified TUI prompt, ACP resume, location-event, provider, config, compaction, and Kilo fixture cases retain or strengthen their applicable invariants.
- No deleted or renamed fixture, recording, cassette, snapshot, or other coverage-data file was found. Modified Kilo recordings preserve Kilo system branding and update request shape for `strict: false`; no scenario interaction was removed.
- Test scheduling was not reduced. The non-CLI and sharded CLI commands in `.github/workflows/test.yml` are unchanged, including the Darwin Kilo profile gate and `KILO_TEST_SHARD`. The PR adds a generated-client check, adds `packages/sdk/js`'s `test` script, and adds Turbo test dependencies for Core and Session UI. No package or Kilo test path was newly excluded.

## Commands And Results

- `git rev-parse HEAD`, base/head validation, and `git merge-base BASE HEAD` returned head `054ee594915b93546d0613a45e0671edd43905ee`, base `0b8f749ae13388cf7a38ea7fb9183acaac99eef8`, and merge base `0b8f749ae13388cf7a38ea7fb9183acaac99eef8`.
- `git diff --shortstat BASE HEAD` returned `1237 files changed, 101898 insertions(+), 41085 deletions(-)`.
- `git diff --name-status --find-renames=40% BASE HEAD -- <test patterns> | cut -f1 | sort | uniq -c` returned `65 A`, `7 D`, `405 M`, and no rename status.
- `git diff --name-only --diff-filter=D BASE HEAD -- <test patterns>` returned exactly the seven shared deleted files listed above.
- `git diff --name-status --find-renames=1% BASE HEAD -- <fixture/snapshot patterns> | rg '^(D|R)'` and the deleted fixture/recording concept search returned no output.
- Kilo-owned test diff aggregation returned `files=127 added=1746 deleted=1528` and statuses `3 A`, `124 M`.
- The base/head Kilo test-name comparison returned `base test names 3017 head test names 3021` and one unmatched name: `extracted core OAuth browser flow uses Kilo branding` in `packages/opencode/test/kilocode/oauth-branding.test.ts`; final head contains its renamed partial replacement.
- `bun test test/kilocode/oauth-branding.test.ts test/kilocode/compaction-payload-recovery.test.ts` from `packages/opencode` returned `6 pass`, `0 fail`, `33 expect() calls`, across 2 files in 5.33s.
- `bun test test/kilocode/reference.test.ts` from `packages/opencode` returned `4 pass`, `0 fail`, `5 expect() calls`, in 1.475s. This confirms retained tests pass but does not fill the stale-source replacement gap.
- `bun test test/reference.test.ts test/oauth-page.test.ts` from `packages/core` returned `4 pass`, `0 fail`, `7 expect() calls`, across 2 files in 354ms.
- Direct final-head evaluation of `KiloOauthCallbackPage.success/error` returned titles `Authorization successful · Kilo` and `Authorization failed · Kilo`; both had `hasKilo: true` and `hasOpenCode: false`.
- `git status --short` before report writing showed only the pre-existing untracked `vscode-self-test.config.json`. Final verification also showed the parallel reviewers' report files; this audit did not modify those files or the pre-existing config.

## Limitations

- This audit did not execute all 405 modified test files or the full package/CI matrix. It used static base/head comparison, declaration/assertion and concept searches, architecture tracing, and targeted controls.
- Test-name extraction is regex-based and can miss dynamically generated names; removed assertions and Kilo concepts were searched separately to reduce that risk.
- Git similarity-based rename detection is unreliable for heavily rewritten files. Low-threshold results produced false pairings among unrelated small tests, so conclusions about moved coverage are based on symbols, invariants, implementation removal, and final-head concept searches rather than rename scores alone.
- No GitHub state was read or mutated for this coverage audit, and no commit or push was performed.
