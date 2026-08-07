# Config Regression Review V3 (Delta)

safe to merge

## Scope And Provenance

Delta review of PR #12901 across the full round-3 range: v2-reviewed head `cbbbd7217f940b59b1b29964264536c567065327` -> v3-reviewed head `3003a302bc65a4ce0df7c544303c0898db5406e3` (two fix commits, `af6d1ded6d` + `3003a302bc`). The review worktree HEAD `6f676b6dbb` is the v3 head plus two docs-only report commits; `git diff --name-only 3003a302bc..HEAD` returns only root report `.md` files, so the checked-out source tree is identical to the reviewed head. `CONFIG_REGRESSION_V2.md` (verdict: safe, no delta findings; pre-existing VS Code picker item unchanged) was read first. Round 3 proceeded in two passes, one per fix commit; both sections are below.

Config scopes used in both passes: `packages/opencode/src/config`, `packages/core/src/config.ts`, `packages/core/src/global.ts`, `packages/core/src/flag`, `packages/opencode/src/config/tui.ts`, `packages/kilo-vscode/src/kilo-provider`, `packages/kilo-i18n`.

## Delta 1: cbbbd7217f..af6d1ded6d (8 files)

The delta was exactly 8 files: `.github/workflows/test.yml`, root `package.json`, `provider/transform.ts`, `kimi-adaptive-effort.test.ts`, `sdk-next/package.json`, `script/check-test-ci.ts`, `transform-package-json.ts` + test.

Method: confirm zero runtime config-path files in the delta, classify the root `package.json` addition, classify the `check-test-ci.ts` change, re-run the fast config control, and confirm the v2 picker item status.

### Findings

No delta-introduced config regression.

### v2 Pre-Existing Item Status

Unchanged. The VS Code **Open config file** picker discrepancy (picker enumerates `~/.opencode` / project `.opencode` while the backend ignores them) is untouched: `git diff --name-only cbbbd7217f..af6d1ded6d -- packages/kilo-vscode/` is empty. It remains a pre-existing Kilo inconsistency, not a PR regression.

### Notable Non-Findings

- **Zero runtime config-path files in the delta.** The config-scope diff (scopes listed above) is empty, and grepping the delta name list for `config|global|flag|paths` matches nothing (v2's `script/upstream/utils/config.ts` is not re-touched).
- **Root `package.json` +1 line is a new CI script, no shadowing.** The addition is `"test:script:ci": "mkdir -p .artifacts/unit && bun test ./script --timeout 30000 --reporter=junit --reporter-outfile=.artifacts/unit/junit.xml"` (line 20). The name occurs exactly once; the diff touches nothing else in the file, so `dev-setup`, `extension`, `extension:isolated`, `extension:isolated:clean`, and the changeset tooling entries are byte-identical. The script only runs the `script/` test tree for CI; no config-related command is created, renamed, or altered.
- **`script/check-test-ci.ts` remains a CI scheduling guard.** The 15-line change widens `git ls-files packages` to `packages script`, anchors the package filter to `^packages/.*\.test\.tsx?$`, and adds one rule: if any `script/*.test.ts(x)` files exist, root `package.json` must declare `test:script:ci` containing `bun test ./script`. It reads only the root manifest's `scripts` field — no Config service, no config-file discovery, no `.kilo`/`.opencode` paths. Error/log strings updated to match the widened scope. No runtime config interaction.
- **Remaining delta files are config-irrelevant.** `provider/transform.ts` + `kimi-adaptive-effort.test.ts` iterate on the v2 Kimi adaptive-thinking detection (model/provider logic, in-memory test). `sdk-next/package.json` and `transform-package-json.ts` (+ test) are manifest/merge tooling. The workflow change schedules the new `test:script:ci` script.

### Commands And Results

- `git diff --name-only af6d1ded6d..HEAD` -> only root report `.md` files (historical, at delta-1 pass time; source tree was then identical to the delta-1 head).
- `git diff --name-status cbbbd7217f..af6d1ded6d` -> exactly the 8 files listed above, all `M`.
- `git diff --name-only cbbbd7217f..af6d1ded6d -- <config scopes listed above>` -> empty (exit 0, no output).
- `git diff --name-only cbbbd7217f..af6d1ded6d | grep -iE "config|global|flag|paths"` -> no matches (exit 1).
- `git diff cbbbd7217f..af6d1ded6d -- package.json` -> single added line, `test:script:ci`; `grep -n "test:script:ci" package.json` -> one occurrence (line 20); `dev-setup` intact at line 24.
- `git diff cbbbd7217f..af6d1ded6d -- script/check-test-ci.ts` -> as summarized above.
- From `packages/opencode` at the delta-1 head: `bun test ./test/kilocode/config/config.test.ts` -> **38 pass, 0 fail** (matches v1/v2 exactly).
- `git diff --name-only cbbbd7217f..af6d1ded6d -- packages/kilo-vscode/` -> empty.

### Limitations

- Delta review only: v1/v2 full-merge config analysis was not repeated; the zero-file config-scope diff plus the 38-test fast control is the regression evidence for this pass.
- The newly added `test:script:ci` script and the updated guard were verified by inspection, not executed; both are CI-scheduling concerns outside config scope.
- Tests ran on macOS arm64 only; no CI check status was re-queried in this pass.

## Delta 2: af6d1ded6d..3003a302bc (14 files)

The delta is exactly 14 files (13 `M`, 1 `A`): `bun.lock`, root `package.json`, `packages/opencode/package.json`, `packages/tui/package.json`, `packages/tui/src/component/register-spinner.ts` (+139), `packages/tui/src/ui/spinner.ts`, `packages/tui/test/kilocode/spinner-runtime.test.ts` (new), `packages/ui/src/i18n/it.ts`, `packages/ui/src/i18n/nl.ts`, `script/upstream/transforms/transform-i18n.ts` + test, `script/upstream/transforms/transform-package-json.ts` + test, `script/upstream/utils/upstream.ts` (+4). Theme: replace the removed `opentui-spinner` dependency with a vendored TUI spinner, teach the merge transforms to prune it, and scope `kilocode_change` source-marker injection to locale files only.

Method: confirm zero runtime config-path files in the delta, classify the `upstream.ts` +4 (the obvious suspect), grep the full delta for `opencode.json` / `.opencode` / `opencode.jsonc` / config-path constants, verify merge tooling has no runtime consumers, re-run the fast config control, and confirm the v2 picker item status.

### Findings

No delta-introduced config regression. Nothing in the delta adds or restores `opencode` config-path fallback candidates, and nothing touches, removes, or reorders `.kilo`-only config lookup.

### v2 Pre-Existing Item Status

Unchanged. `git diff --name-only af6d1ded6d..3003a302bc -- packages/kilo-vscode/` is empty; the VS Code picker discrepancy remains a pre-existing Kilo inconsistency, not a PR regression.

### Notable Non-Findings

- **Zero runtime config-path files in the delta.** The config-scope diff (scopes listed in the header) is empty, so `packages/opencode/src/config/config.ts` and the Global/path module it uses are byte-identical between `af6d1ded6d` and `3003a302bc` — the state the delta-1 pass verified still holds at the v3 head.
- **`script/upstream/utils/upstream.ts` (+4) is merge tooling with no runtime consumers.** The change threads an `isI18nFile(file)` flag into `transformI18nContent` so `// kilocode_change` source markers are injected only into locale files, not into arbitrary upstream text (e.g. prompt `.txt` files). `translate(` is called exclusively from `script/upstream/fix-kilocode-markers.ts` and `script/upstream/utils/reset.ts`; grepping `packages/` for imports of `script/upstream` or `upstream/utils/upstream` returns nothing. It does not feed runtime config discovery.
- **The only `.opencode` / `opencode.json` hits in the delta are test fixtures.** `transform-i18n.test.ts` (2 hits: `".opencode/opencode.json"`) asserts the i18n transform *preserves* legacy config names inside locale strings instead of rewriting them — intentional behavior for user-facing doc text, not config-path code. No `opencode.jsonc` or config-directory constants appear anywhere in the delta.
- **Manifest and lockfile changes only remove `opentui-spinner`.** Root `package.json` (catalog), `packages/opencode/package.json`, `packages/tui/package.json`, and `bun.lock` each drop `opentui-spinner` entries and nothing else. `transform-package-json.ts` (+ test) adds `opentui-spinner` to the merge transform's catalog/dependency prune lists and exports `transformDependencies`. No config-related script, key, or path is created, renamed, or altered; no new runtime dependency is introduced.
- **Spinner files are TUI rendering only.** `register-spinner.ts` (+139) vendors a local spinner component (imports only `@opentui/solid` component APIs and a local color type) to replace the removed package; the sole `opencode` occurrence is the upstream-named export `registerOpencodeSpinner`. No config reads, no path resolution.
- **i18n locale edits (`it.ts`, `nl.ts`) contain no config-path strings** — grep for `config|\.kilo|\.opencode|opencode\.json` over their diff returns no matches (exit 1).

### Commands And Results

- `git diff --name-only 3003a302bc..HEAD` -> only root report `.md` files (source tree == v3 head).
- `git diff --name-status af6d1ded6d..3003a302bc` -> exactly the 14 files listed above; 13 `M` + 1 `A`.
- `git diff --name-only af6d1ded6d..3003a302bc -- <config scopes listed in header>` -> empty (exit 0, no output).
- `git diff af6d1ded6d..3003a302bc | grep -inE "opencode\.json|\.opencode|opencode\.jsonc|config.*dir|Global\.Path|path.*config"` -> 2 hits, both `".opencode/opencode.json"` fixtures in `transform-i18n.test.ts` (see non-findings).
- `git grep "from \"script/upstream" -- packages/` and `git grep -l "upstream/utils/upstream" -- packages/` -> no matches; `git grep "translate(" -- script/upstream/` -> callers only in `fix-kilocode-markers.ts` and `utils/reset.ts`.
- `git diff af6d1ded6d..3003a302bc -- bun.lock | grep -inE "config|opentui-spinner"` -> only removed `opentui-spinner` lock entries.
- From `packages/opencode` at the v3 head: `bun test ./test/kilocode/config/config.test.ts` -> **38 pass, 0 fail** (matches v1/v2/delta-1 exactly).
- `git diff --name-only af6d1ded6d..3003a302bc -- packages/kilo-vscode/` -> empty.

### Limitations

- Delta review only: v1/v2 full-merge config analysis was not repeated; the zero-file config-scope diff plus the 38-test fast control is the regression evidence for this pass.
- The new/changed merge-transform tests (`transform-i18n.test.ts`, `transform-package-json.test.ts`) and the new spinner runtime test were verified by inspection, not executed (root-level `bun test` is out of bounds for this review); all three are TUI/merge-tooling concerns outside config scope.
- Tests ran on macOS arm64 only; no CI check status was queried in this pass.

## Document History

Only root `CONFIG_REGRESSION_V3.md` was authored/updated. No source files, v1/v2 reports, or other agents' V3 files were modified. Delta-1 section recorded at worktree HEAD `6d6c4eb730`; delta-2 section and full-range re-scope recorded at worktree HEAD `6f676b6dbb` (post-rebase).
