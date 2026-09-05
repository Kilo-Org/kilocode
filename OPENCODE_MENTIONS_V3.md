# OpenCode Mentions Review v3

**Verdict: safe — zero new user-facing OpenCode mentions across the full round-3 fix range `cbbbd7217f..3003a302bc` (two fix commits, 22 file-deltas total); all v2 item statuses carry over unchanged, re-verified at the final v3 head.**

## Scope and Method

Round-3 reviewed head is `3003a302bc65a4ce0df7c544303c0898db5406e3` (verified direct child of `af6d1ded6d`, itself direct child of the v2 head `cbbbd7217f`). The round-3 range was audited as two deltas:

- **Delta 1** `cbbbd7217f940b59b1b29964264536c567065327..af6d1ded6d0c42f31b2cea2b84e478f6ac10445a`: exactly the 8 expected files, `34 insertions(+), 10 deletions(-)` — `.github/workflows/test.yml`, root `package.json`, `packages/opencode/src/provider/transform.ts`, `packages/opencode/test/kilocode/provider/kimi-adaptive-effort.test.ts`, `packages/sdk-next/package.json`, `script/check-test-ci.ts`, `script/upstream/transforms/transform-package-json.ts` + its test. Full-diff read, emptiness checks on every v2-fixed path, grep sweep of added/removed lines for OpenCode and translate literals, live run of the modified guard.
- **Delta 2** `af6d1ded6d0c42f31b2cea2b84e478f6ac10445a..3003a302bc65a4ce0df7c544303c0898db5406e3`: exactly the 14 expected files, `236 insertions(+), 94 deletions(-)` — `bun.lock`, root `package.json`, `packages/opencode/package.json`, `packages/tui/package.json`, `packages/tui/src/component/register-spinner.ts` (+139), `packages/tui/src/ui/spinner.ts`, new `packages/tui/test/kilocode/spinner-runtime.test.ts`, `packages/ui/src/i18n/it.ts`, `packages/ui/src/i18n/nl.ts`, `script/upstream/transforms/transform-i18n.{ts,test.ts}`, `script/upstream/transforms/transform-package-json.{ts,test.ts}`, `script/upstream/utils/upstream.ts`. Full-diff read, case-insensitive `opencode` sweep of added and removed lines with per-hit intent judgment, full-file grep of the touched i18n/TUI files at head, upstream comparison against tag `v1.18.0`, and live runs of the three modified/new test files.

Confirmed the worktree source tree (`6f676b6dbb` = v3 head + two docs-only report commits) matches the reviewed head exactly (`git diff 3003a302bc..6f676b6dbb -- . ':(exclude)*.md'` is empty).

## v2 Item Status (re-verified at final v3 head 3003a302bc)

1. **P2 meta.txt Muse Spark identity: still FIXED.** `git diff cbbbd7217f..3003a302bc -- packages/opencode/src/session/prompt/meta.txt` is empty; live file still reads `You are Kilo...` / `identify yourself as Kilo powered by Meta Muse Spark`; `rg -ic opencode meta.txt` → no matches (exit 1).
2. **P2 OpenCode-branded `translate:app`: still FIXED.** Diff on the three deleted paths is empty; `ls script/translate-app*` → no matches found; neither delta's added lines contain `translate` literals (delta 1's root `package.json` hunk only adds `test:script:ci`).
3. **P3 `artifacts/glm52-rise-video/` OpenCode Go media: HUMAN-VERIFICATION OPEN, unchanged.** `git diff --stat cbbbd7217f..3003a302bc -- artifacts/` is empty; the retain/omit/rebrand decision remains a pending human call, not a new defect.
4. **20 i18n `kilocode_change` markers: unchanged.** Delta 1 did not touch `packages/ui/src/i18n/`; delta 2 rewrote translated values in `it.ts`/`nl.ts` but stripped no markers — `rg -c kilocode_change packages/ui/src/i18n/ | wc -l` still → 20, and both files retain their `// kilocode_change - new file` headers and block markers.
5. **Changeset: untouched by both deltas** (`git diff cbbbd7217f..3003a302bc -- .changeset/` empty).

## Findings — Delta 2 (`af6d1ded6d..3003a302bc`, commit `3003a302bc` "fix: address pull request review comments")

**No user-facing findings.** Zero new user-facing OpenCode mentions and zero links to OpenCode web properties in any added line. One tooling change flagged for human awareness:

- **P3 human-verification (future-merge tooling, not a leak): `transformI18nContent` marker default flip.** `script/upstream/transforms/transform-i18n.ts` adds a `markers = false` parameter; the `// kilocode_change` suffix on branding-rewritten lines is now emitted only when `markers` is true. Callers: `transformI18nFile` passes `true` (locale-file behavior unchanged), and `translate()` in `script/upstream/utils/upstream.ts` now passes `isI18nFile(file)` where `i18nPatterns: ["packages/*/src/i18n/*.ts"]` (`script/upstream/utils/config.ts:241`). The branding rewrite itself is **unchanged and test-proven in both modes**: new tests assert `transformI18nContent("OpenCode uses opencode serve")` → `"Kilo uses kilo serve"` and `translate("packages/opencode/src/session/prompt/meta.txt", "OpenCode uses opencode serve")` → `"Kilo uses kilo serve"` with no marker. So this cannot cause future merges to leak OpenCode mentions — it only removes marker breadcrumbs from non-locale files (an intentional fix: previously marker text could be injected into non-source content such as LLM prompt files). Residual human check, adjacent to the markers lens: branding lines that future merges rewrite inside shared non-locale source files will now lack `kilocode_change` markers, which may interact with the `check-opencode-annotations.ts` CI guard — confirm that guard's expectations with the markers-lens reviewer.

### Notable Non-Findings (delta 2)

- **TUI spinner rework (`register-spinner.ts` +139, `spinner.ts`, `spinner-runtime.test.ts`):** replaces the `opentui-spinner` dependency (which dragged a nested OpenTUI 0.3 runtime) with a local `SpinnerRenderable` on Kilo's active OpenTUI runtime, wrapped in `kilocode_change start/end` markers. Contains **no user-facing text at all** — default frames are braille glyphs (`["⠋"]`), no strings, no URLs. The exported name `registerOpencodeSpinner` is verbatim upstream naming (`git show v1.18.0:packages/tui/src/component/register-spinner.ts` has the identical function), a code identifier never rendered to users; pre-existing call site `packages/tui/src/app.tsx:96` untouched by this delta. The marker comment's reference to `opentui-spinner` is an npm package name, intentional.
- **i18n `it.ts`/`nl.ts` (40 changed lines each):** the changed lines are Italian/Dutch translations of upstream's `ui.sessionReviewV2.*` diff-viewer strings plus `ui.lineComment.cancel`, `ui.sessionTurn.diffs.changed.one/other`, and `ui.common.showMore` — replacing English fallback values. **No product name appears in any removed or added line**; full-file `grep -ic opencode` on both files at head → 0. `it.ts`/`nl.ts` are Kilo-added locale files (absent from upstream `v1.18.0`, which ships 18 other locales; the 16 `sessionReviewV2` keys exist verbatim in upstream `en.ts`). The "Kilo Go" subscription strings (`it.ts:78`, `nl.ts:79`) are pre-existing context lines, untouched by this delta.
- **Merge tooling (`transform-package-json.ts`, `upstream.ts`):** `opentui-spinner` added to `DELETE_UPSTREAM_CATALOG` and a new `DELETE_UPSTREAM_DEPENDENCIES` set; the emitted change message `opentui-spinner: removed (incompatible OpenTUI runtime)` is developer-facing merge-log output naming a package, not product branding. `transformDependencies` is newly exported for testing only.
- **Manifests (`package.json` ×3, `bun.lock`):** dependency removals only (`opentui-spinner` catalog entry and lock entries); no `name`/`description`/user-facing fields touched. Context-line deps `opencode-gitlab-auth` / `opencode-poe-auth` are pre-existing third-party npm package names, unchanged.
- **Test fixtures containing OpenCode literals are intentional:** `transform-i18n.test.ts` feeds `'  "product": "OpenCode",\n  "docs": "https://opencode.ai/docs",\n  "legacy": ".opencode/opencode.json",'` as transform **input** and asserts the Kilo-rewritten output (legacy `.opencode/opencode.json` config path preserved by design); `transform-package-json.test.ts`'s `fixMetadata preserves opencode publish metadata` case (pre-existing) guards the npm package rename metadata. These assert the anti-leak automation; they never ship to users.
- **Removed-line sweep:** the only case-insensitive `opencode` hit in removed lines (excluding `@opencode-ai/` scope and diff headers) is a reformatted test call referencing the repo path `packages/opencode/script/dev-local.ts` — path, not content.

## Findings — Delta 1 (`cbbbd7217f..af6d1ded6d`)

None. The only OpenCode literals in the delta's added lines are the `+++ b/packages/opencode/...` diff-header paths (repository paths, not content). Content-level sweep: `git diff ... | grep '^+' | grep -iv '@opencode-ai/' | grep -i opencode` → file headers only; `grep -i translate` on added lines → nothing.

### Notable Non-Findings (delta 1, scope items 1 and 4)

- **CI-visible workflow strings:** new step name `Run root tooling unit tests` (`run: bun run test:script:ci`) and the added JUnit paths (`.artifacts/unit/junit.xml`) contain no product naming. Pre-existing `# kilocode_change end` marker context untouched.
- **New developer-facing root script:** `test:script:ci` → `mkdir -p .artifacts/unit && bun test ./script --timeout 30000 --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml` — clean name, no branding. The context-line `--sso-session=opencode` (AWS session name) is the pre-existing infrastructure identifier noted in v1/v2, not introduced here.
- **Guard output strings (`script/check-test-ci.ts`):** new/changed strings are `Test suites missing CI scheduling:`, `check-test-ci: ok (<n> test-bearing package(s), <m> root script test file(s))`, and `package.json#test:script:ci` — no OpenCode branding. Ran live from repo root: `bun run script/check-test-ci.ts` → `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))`, exit 0.
- **Test names/strings shown in CI logs:** new test `handles partial metadata from generic Anthropic providers` (in `test/kilocode/`) — clean.
- **transform.ts null-safety fix** (`id?.toLowerCase() ?? ""`, `model.api.url?.toLowerCase() ?? ""`) sits inside the existing `kilocode_change`-marked `isKimiFamily` block; no naming content.
- **sdk-next timeout bump** (10000→30000) and **`test:script:ci` added to `PRESERVE_SCRIPTS`** + transform test fixture — no naming content.
- The GitHub run name `OpenCode Merge v1.17.14...v1.18.0` is the pre-existing PR title (upstream-provenance reference), not introduced by this delta.

## Commands and Results

Round-3 range and ancestry:

- `git log --format='%H %P %s' -2 3003a302bc`: `3003a302bc...` parent `af6d1ded6d...`, parent `cbbbd7217f...` — linear chain confirmed.
- `git diff --name-status cbbbd7217f..af6d1ded6d`: 8 files, all `M`; `--stat`: 34+/10-. `git diff --name-status af6d1ded6d..3003a302bc`: 14 files (13 `M`, 1 `A` = `packages/tui/test/kilocode/spinner-runtime.test.ts`); `--stat`: 236+/94-.
- `git diff 3003a302bc..6f676b6dbb -- . ':(exclude)*.md' --stat` → empty; `git show --stat 668ad83055` / `6f676b6dbb` → 7 report `.md` files each, docs-only (post-rebase equivalents of the pre-rebase `a81260050e` / `6d6c4eb730`).

v2-item emptiness checks over the full round-3 range (all empty): `git diff cbbbd7217f..3003a302bc -- packages/opencode/src/session/prompt/meta.txt`, `-- .changeset/`, `--stat -- artifacts/`, `-- script/translate-app.ts script/translate-app.test.ts script/translate-app.md`. `head -3 meta.txt` → Kilo identity lines; `rg -c kilocode_change packages/ui/src/i18n/ | wc -l` → 20; `ls script/translate-app*` → no matches found.

Delta-1 sweeps: `git diff cbbbd7217f..af6d1ded6d | grep '^+' | grep -iv '@opencode-ai/' | grep -i opencode` → only `+++ b/packages/opencode/src/provider/transform.ts` and `+++ b/packages/opencode/test/kilocode/provider/kimi-adaptive-effort.test.ts` (headers); removed-line sweep → headers only. `bun run script/check-test-ci.ts` → `check-test-ci: ok (25 test-bearing package(s), 10 root script test file(s))`, exit 0.

Delta-2 sweeps and checks:

- `git diff af6d1ded6d..3003a302bc | grep -in opencode | grep -v '@opencode-ai/'` → only: `bun.lock`/manifest context lines for npm packages `opencode-gitlab-auth`/`opencode-poe-auth` (unchanged context), diff headers, the `registerOpencodeSpinner` identifier (verbatim upstream), intentional transform-test fixtures asserting OpenCode→Kilo rewrites, and the pre-existing `fixMetadata preserves opencode publish metadata` test name. Removed-line sweep → one reformatted test line containing repo path `packages/opencode/script/dev-local.ts`.
- `grep -ic opencode packages/ui/src/i18n/it.ts packages/ui/src/i18n/nl.ts` → 0, 0 (full files at head).
- `git show v1.18.0:packages/tui/src/component/register-spinner.ts` → identical `registerOpencodeSpinner` function name upstream. `git ls-tree v1.18.0 packages/ui/src/i18n/` → 18 locale files, no `it.ts`/`nl.ts` (Kilo-added); upstream `en.ts` contains the same 16 `sessionReviewV2` keys, all product-name-free.
- `script/upstream/utils/config.ts:241` → `i18nPatterns: ["packages/*/src/i18n/*.ts"]`; callers of `transformI18nContent`: `transformI18nFile` (markers `true`) and `upstream.ts:194 translate()` (markers `isI18nFile(file)`).
- Live tests at head: `bun test ./script/upstream/transforms/transform-i18n.test.ts ./script/upstream/transforms/transform-package-json.test.ts` → 25 pass / 0 fail; `bun test ./packages/tui/test/kilocode/spinner-runtime.test.ts` → 1 pass / 0 fail.

## Limitations

- Branding-only delta audits; I did not run the full TUI/opencode test suites, typecheck, or the new `test:script:ci` suite, and did not re-run the meta-prompt test (unchanged paths; test execution belongs to TESTS_V3). MP4 contents not re-inspected — the artifacts delta is empty, so the v1/v2 human-verification item carries over verbatim.
- The P3 `transform-i18n` marker-default note is flagged from code/test read-through only; its interaction with the annotations guard on future merges belongs to the markers lens and was not exercised end-to-end here.
- Only `OPENCODE_MENTIONS_V3.md` was authored by this reviewer; no source, v1/v2 reports, other agents' files, GitHub state, or user data was modified.

## Final CI State (delta-1 head `af6d1ded6d`: run queued 2026-08-05T23:09Z; rechecked 23:24Z — all complete)

All 9 workflow runs green: `test` (12m14s — all 14 jobs including `unit (linux, 1/2)` with the new `Run root tooling unit tests` step, the previously failing `unit (macos)` sdk-next-timeout shard, and all four windows shards), typecheck, test-vscode, Visual Regression Tests, CodeQL Advanced, Check shared upstream annotations, Check forbidden strings, Check Source Links, Check markdown table padding. The prior v2-head `test` failure (22:31Z run) is resolved by delta 1's fixes; neither it nor either delta is branding-related. CI for the final v3 head `3003a302bc` was not re-queried under this lens (no GitHub access from this environment); the delta-2 changes are dependency-removal, translation, and merge-tooling changes whose branding content is fully covered by the local sweeps and tests above.
