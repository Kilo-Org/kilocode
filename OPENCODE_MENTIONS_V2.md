# OpenCode Mentions Review v2

**Verdict: safe after fixes — both P2 findings are fixed; the P3 artifact decision remains open for a human.**

## Scope and Method

Re-verified my three v1 findings (`OPENCODE_MENTIONS.md`) at the new reviewed head `cbbbd7217f940b59b1b29964264536c567065327`, and scanned the full 49-file delta `c69ce6caf638617169509f09e3f5d620eb702146..cbbbd7217f940b59b1b29964264536c567065327` (282 insertions, 756 deletions) for newly introduced user-facing OpenCode mentions. The worktree HEAD `c5b1427314` is the reviewed head plus a docs-only commit adding the seven v1 reports (`git show --stat c5b1427314`: 7 report files, nothing else), so the source tree matches the reviewed head. Read the new `meta.txt` in full, the new test, the `system.ts` selector, the merge-transform deltas, and the changeset; ran the new prompt test; swept the worktree for residual identity/docs literals.

## v1 Finding Status

### 1. P2 — Muse Spark prompt identified Kilo as OpenCode: FIXED

- `packages/opencode/src/session/prompt/meta.txt` now reads `You are Kilo, the best coding agent on the planet.` (line 1), retains the vendor attribution `based on a large language model trained by Meta MSL named Muse Spark` (line 2), and says `identify yourself as Kilo powered by Meta Muse Spark by name` (line 3). Product questions now say "asks about Kilo ... use the WebFetch tool ... from Kilo docs. The list of available docs is available at https://kilo.ai/docs" (line 10); the objectivity section now says Kilo (line 17). The already-correct feedback URL `https://github.com/Kilo-Org/kilocode` (line 9) is preserved. `rg -i "opencode"` on the file returns zero matches.
- `packages/opencode/src/session/system.ts` is not in the delta and is unchanged/consistent: line 76 still routes `model.api.id.includes("muse-spark")` to `[PROMPT_META]` (imported line 14); the `kilocode_change` `prompt()` switch (lines 51-71) has no meta/muse case, so muse-spark models still reach meta.txt.
- New test `packages/opencode/test/kilocode/session/meta-prompt.test.ts` exercises the real selector via `SystemPrompt.provider({ api: { id: "meta/muse-spark-preview" } })` and asserts all four invariants: contains `Kilo powered by Meta Muse Spark`, contains `https://kilo.ai/docs`, does not contain `identify yourself as OpenCode`, does not contain `https://opencode.ai/docs`. `bun test ./test/kilocode/session/meta-prompt.test.ts` from `packages/opencode/`: **1 pass, 0 fail, 4 expect() calls [1.72s]**.
- Regression guard: `script/upstream/utils/config.ts` adds `packages/opencode/src/session/prompt/meta.txt` to `takeTheirsAndTransform`, so future upstream merges re-apply the Kilo branding transform instead of silently restoring the OpenCode identity.

### 2. P2 — OpenCode-branded broken `translate:app` command: FIXED

- All three files are deleted (`D` in delta): `script/translate-app.ts`, `script/translate-app.test.ts`, `script/translate-app.md`; `ls script/translate-app*` finds nothing.
- Root `package.json` no longer exposes `translate:app` (removed; the same hunk adds the unrelated `extension:isolated`/`extension:isolated:clean` scripts).
- Repo-wide `rg -i "translate[:.-]app"` (excluding `node_modules`, `bun.lock`, review reports) finds only merge tooling that actively prevents reintroduction: `DELETE_UPSTREAM_SCRIPTS` now strips `translate:app` (`script/upstream/transforms/transform-package-json.ts:323`), skip-files lists the three deleted paths (`script/upstream/utils/config.ts:141-143`), and two tests assert the removal (`transform-package-json.test.ts:82`, `skip-files.test.ts:26-28`). No remaining references in AGENTS.md, CONTRIBUTING.md, docs/, kilo-docs, `.github/workflows/`, or any help text.

### 3. P3 / human verification — `artifacts/glm52-rise-video/` OpenCode Go media: HUMAN-VERIFICATION OPEN

- The delta does not touch `artifacts/` (`git diff --stat ... -- artifacts/` is empty). The directory still contains all six source compositions and `out/` still holds `june-totals.png` (visibly `OPENCODE GO · JUNE 2026`, `opencode.ai/data`) plus the five MP4s (`flash-share.mp4`, `glm-52-broke-out.mp4`, `minimax-climb.mp4`, `novel-1984.mp4`, `nz-sheep.mp4`). The decision called for in v1 — retain, omit, or rebrand and regenerate — remains unmade at this head; that is a pending human call, not a new defect.

## New Findings

None. Every added line in the 49-file delta containing an OpenCode literal falls into an acceptable category:

- `.changeset/opencode-v1-18-0.md`: frontmatter correctly targets Kilo packages (`@kilocode/cli`, `kilo-code`); the body "Adopt OpenCode v1.18.0 improvements..." is an accurate upstream-provenance reference in release notes, not product misbranding. Optional polish would be "upstream OpenCode v1.18.0", but this is not a defect.
- `meta-prompt.test.ts`: negative assertions (`not.toContain` OpenCode identity/docs).
- `script/upstream/transforms/transform-i18n.test.ts:6`: a fixture string simulating upstream package extras; the test asserts the transform rewrites `product`/`docs` and only the legacy `.opencode/opencode.json` line survives.
- `packages/opencode/test/tool/registry.test.ts`: `ProviderV2.ID.opencode` — the genuine retained upstream provider ID, test-only.
- Merge-config path lists referencing `packages/opencode/...` repository paths.

## Notable Non-Findings

- The 20 changed `packages/ui/src/i18n/*.ts` files contain exactly 20 added lines, each appending ` // kilocode_change` to an already-Kilo-branded "Kilo Go" free-tier string; the removed lines are the identical strings without the marker. String content is unchanged, and the markers are TypeScript comments — nothing user-facing. `transform-i18n.ts` now auto-appends the marker to transformed lines on future merges.
- `script/check-test-ci.ts` (new, headed `// kilocode_change - new file`) and the new `Verify package test scheduling` step in `.github/workflows/test.yml` contain no OpenCode product naming.
- A worktree sweep for `identify yourself as OpenCode` and `opencode.ai/docs` found only pre-existing intentional references outside the delta: kilo-docs pages deliberately citing upstream config/plugin docs, generated `packages/sdk/js/src/gen/types.gen.ts` doc comments, `session-ui` URL-classification test fixtures, `models-api.json` Zen fixtures, and a commented-out entry in `script/check-forbidden-strings.ts`. Nothing new.
- The root `sso` script's `--sso-session=opencode` (AWS session name) and `@opencode-ai/*` workspace identifiers are pre-existing infrastructure/provenance identifiers, untouched by the delta.

## Commands and Results

- `git log --oneline -5`: HEAD `c5b1427314` over `cbbbd7217f` → `25f4b58d93`; `git show --stat c5b1427314`: 7 v1 report files only.
- `git diff --name-status c69ce6ca... cbbbd7217f...`: 49 files (20 i18n `M`, 3 translate-app `D`, 4 `A` incl. changeset, meta-prompt test, kimi test, check-test-ci.ts); `--stat` tail: `282 insertions(+), 756 deletions(-)`.
- `git diff ... -- packages/opencode/src/session/prompt/meta.txt`: 8-line hunk replacing OpenCode identity/docs with Kilo identity and `https://kilo.ai/docs`; `rg -i opencode meta.txt`: no matches.
- `bun test ./test/kilocode/session/meta-prompt.test.ts` (from `packages/opencode/`): 1 pass, 0 fail, 4 expect() calls, 1.72s.
- `ls script/ | grep -i translate`: exit 1; `ls script/translate-app*`: no matches found. `git diff ... -- package.json`: `translate:app` line removed.
- `rg -in "translate[:.-]app"` repo-wide: only merge-transform config/tests and v1 reports; zero hits in `.github/`, `docs/`, `AGENTS.md`, `CONTRIBUTING.md`, `packages/kilo-docs/`.
- `git diff --stat ... -- artifacts/`: empty; `ls artifacts/glm52-rise-video/out/`: `june-totals.png` + 5 MP4s still tracked.
- `git diff ... | grep '^+' | grep -i opencode | grep -v '@opencode-ai/'`: only the changeset line, test fixtures/negative assertions, config path lists, and `ProviderV2.ID.opencode` in a test.
- i18n: `git diff ... -- packages/ui/src/i18n/ | grep '^+' | grep -v kilocode_change | wc -l` → 0 non-marker added lines (20 marker lines total); removed lines identical minus marker.

## Limitations

- Static branding audit plus one targeted test run; I did not run the full suite or reproduce CI. The `unit (macos)` 1m53s failure on this head is attributed in `TESTS_V2.md` to the `sdk-next` embedded-test timeout (not branding-related); linux/windows shard failures are the `isKimiFamily` product-code issue tracked in `TESTS_V2.md` / `KILOCODE_CHANGE_MARKERS_V2.md`, also outside branding scope.
- MP4 contents were not re-inspected frame by frame; v1 established file validity and the delta leaves the directory untouched, so the v1 human-verification item carries over unchanged.
- Only `OPENCODE_MENTIONS_V2.md` was authored in this round; no source, v1 reports, other agents' files, GitHub state, or user data was modified.
