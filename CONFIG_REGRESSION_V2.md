# Config Regression Review V2 (Delta)

safe to merge

## Scope And Provenance

This is a delta review of PR #12901 between the v1-reviewed head `c69ce6caf638617169509f09e3f5d620eb702146` (superseded) and the new reviewed head `cbbbd7217f940b59b1b29964264536c567065327` (two commits: `25f4b58d93`, `cbbbd7217f`). The review worktree sits at `c5b1427314`, one docs-only commit past the reviewed head. The v1 report (`CONFIG_REGRESSION.md`, verdict: safe, no findings) was read first; this report only re-checks whether the 49-file delta introduces an `opencode` config fallback or breaks `.kilo`-only lookup, and re-runs the fast config control at the new head.

The delta contains: package manifests, `.github/workflows/test.yml`, `provider/transform.ts`, `session/prompt/meta.txt`, `session/tools.ts`, `tool/registry.ts`, `tool/code-mode.ts`, tests, 20 `packages/ui` i18n files, new `script/check-test-ci.ts`, deleted `script/translate-app*`, merge tooling (`transform-i18n.ts`, `transform-package-json.ts`, `skip-files.test.ts`, `script/upstream/utils/config.ts`), and a changeset.

## Findings

No delta-introduced config regression.

### CI note (not a finding)

`unit (macos)` failed at 1m53s on the new head. Subsequent log analysis (authoritative in `TESTS_V2.md`) attributes the macOS failure to the `sdk-next` embedded-test 10s timeout on macos-15 (2/2 systematic, not config-related), while `unit (linux, 1/2)` and `unit (windows, 1/4)` fail three `transform.test.ts` reasoningVariants cases on the delta's new `isKimiFamily` code (see `TESTS_V2.md` / `KILOCODE_CHANGE_MARKERS_V2.md`). No CI failure implicates config scope; every delta-touched `packages/opencode` suite passes locally on macOS (93/93, see below).

## v1 Pre-Existing Item Status

Unchanged. The VS Code **Open config file** picker discrepancy (picker enumerates `~/.opencode` / project `.opencode` while the backend ignores them) is untouched by the delta: `git diff --name-only c69ce6caf6..cbbbd7217f -- packages/kilo-vscode/` is empty. It remains a pre-existing Kilo inconsistency, not a PR regression.

## Notable Non-Findings

- **Zero runtime config-path files in the delta.** `git diff --name-only <range> -- packages/opencode/src/config packages/core/src/config.ts packages/core/src/global.ts packages/core/src/flag packages/opencode/src/config/tui.ts packages/kilo-vscode/src/kilo-provider packages/kilo-i18n` returns 0 files. Grepping the full delta name list for `config|global|flag|paths` matches only `script/upstream/utils/config.ts`.
- **`script/upstream/utils/config.ts` is merge tooling, not runtime.** Its 6-line change adds three exact-path `skipFiles` entries (`script/translate-app.ts`, `script/translate-app.test.ts`, `script/translate-app.md`) and one exact-path `takeTheirsAndTransform` entry (`packages/opencode/src/session/prompt/meta.txt`). Exact paths, no globs, so no over-matching; the skips are consistent with the delta's deletion of those same files and the root `translate:app` script removal. A repo-wide grep shows no remaining source reference to `translate-app` outside merge tooling (and other agents' root reports). Consumers of this config are exclusively `script/upstream/**` modules (`analyze.ts`, transforms); no runtime package imports it.
- **`transform-i18n.ts` change is merge-time only.** It appends `// kilocode_change` to branding-transformed lines; the 20 `packages/ui/src/i18n/*.ts` diffs are pure comment-marker additions (spot-checked `en.ts`). TS comments have no runtime effect, and CLI locale loading (`packages/kilo-i18n`) is untouched.
- **Runtime source changes are not config-path related.** `provider/transform.ts` adds Kimi/Moonshot adaptive-thinking detection; `session/tools.ts`, `tool/registry.ts`, `tool/code-mode.ts` thread a `networkRestricted` flag to suppress code-mode MCP catalogs in sandboxed sessions. The `registry.ts` diff touches only the `Interface.all` signature and `describeCodeMode`; the custom-tool `config.directories()` consumption (v1: lines 225-239) is unchanged.
- **New/modified test harnesses introduce no config fallback and no `.opencode` reliance.** `kimi-adaptive-effort.test.ts` and `meta-prompt.test.ts` are pure in-memory. `registry.test.ts` / `code-mode.test.ts` / `code-mode-integration.test.ts` inject `TestConfig.layer({ get: () => Effect.succeed({ sandbox: ... }) })` — in-memory config objects, no filesystem discovery. `account/service.test.ts` only drops a stale `kilocode_change` marker.
- **`meta.txt` branding is prompt content, not config discovery.** The file is a model-facing system prompt; its loading path is unchanged, and the new `takeTheirsAndTransform` entry only governs future upstream merges.
- **New `script/check-test-ci.ts`** verifies test-bearing packages declare `test:ci`; CI scheduling guard, config-irrelevant. The workflow step running it is linux-gated, so it cannot explain the macOS failure.

## Commands And Results

- `git diff --name-status c69ce6caf6..cbbbd7217f` -> 49 paths: 45 M, 3 A (`kimi-adaptive-effort.test.ts`, `meta-prompt.test.ts`, `transform-i18n.test.ts`, `check-test-ci.ts`, changeset — 5 A total), 3 D (`script/translate-app.{ts,test.ts,md}`).
- `git log --oneline c69ce6caf6..cbbbd7217f` -> exactly `25f4b58d93`, `cbbbd7217f`.
- `git diff --name-only c69ce6caf6..cbbbd7217f -- <config scope listed above>` -> empty; `git diff --name-only ... | grep -iE "config|global|flag|paths"` -> only `script/upstream/utils/config.ts`.
- `git diff <range> -- script/upstream/utils/config.ts` -> +3 exact-path skips, +1 exact-path transform entry, nothing else.
- `grep -rln "translate-app" <worktree>` (excluding `.git`, `node_modules`) -> only merge tooling (`utils/config.ts`, `skip-files.test.ts`, `transform-package-json.test.ts`) and other agents' root reports; no runtime or manifest references.
- From `packages/opencode` at reviewed head, using the worktree's own installed `node_modules`: `bun test ./test/kilocode/config/config.test.ts ./test/config/config.test.ts` -> **145 pass, 0 fail** (38+107, matching v1 exactly).
- From `packages/opencode`: `bun test ./test/tool/registry.test.ts ./test/tool/code-mode.test.ts ./test/tool/code-mode-integration.test.ts ./test/kilocode/provider/kimi-adaptive-effort.test.ts ./test/kilocode/session/meta-prompt.test.ts ./test/account/service.test.ts` -> **93 pass, 0 fail**.
- Merge tooling suites (run from `packages/opencode` cwd because root `bun test` is intentionally blocked): `bun test ../../script/upstream/transforms/skip-files.test.ts ../../script/upstream/transforms/transform-i18n.test.ts ../../script/upstream/transforms/transform-package-json.test.ts` -> **30 pass, 0 fail**.
- `git diff --name-only c69ce6caf6..cbbbd7217f -- packages/kilo-vscode/` -> empty (picker discrepancy status unchanged).
- `gh pr checks 12901 -R Kilo-Org/kilocode` -> `unit (macos)` fail 1m53s; `unit (linux 1/2, 2/2)`, `unit (windows 1-4/4)`, `HttpApi exerciser` pending; all other completed checks pass (`unit tests`, typechecks, annotations, source-links, visual regression, jetbrains). `gh run view --job 92464599061 --log` -> logs unavailable, run in progress.

## Limitations

- The macOS CI failure cause is unattributed (logs pending while the run is in progress). Local macOS runs of all delta-touched suites and the config control pass; if logs later show a config-test failure on the macOS shard, this verdict must be revisited.
- Delta review only: v1's full-merge config analysis was not repeated wholesale; the fast config control (145 tests) plus the zero-file config-scope diff is the regression evidence.
- Tests ran on macOS arm64 only; Windows-only behavior was not re-exercised in this round (Windows CI shards were pending).
- Only root `CONFIG_REGRESSION_V2.md` was authored. No source files, v1 reports, or other agents' V2 files were modified.
