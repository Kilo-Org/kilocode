# kilocode_change Marker Review V2 — upstream v1.18.13 merge (round 2)

**Reviewed HEAD:** 37a5cbf5db · **Round-1 HEAD:** cce22e608f · **Pre-merge Kilo base:** b135b4e10a · **Upstream tag:** v1.18.13 (a105350812)

## Scope & Methodology

Round 2 covers (a) re-verification of every round-1 finding at the new head, (b) marker hygiene of the 4 fix commits (`git diff cce22e608f..37a5cbf5db`, 65 files: 45 with marker-count changes, 20 without), and (c) a fresh full-PR sweep designed to catch what round 1's methodology structurally missed.

Approach:

1. **Round-1 re-verification** — re-ran every check from KILOCODE_CHANGE_MARKERS.md at 37a5cbf5db and blamed each fix.
2. **Delta count sweep** — for each of the 65 delta files: markers at cce22e608f vs HEAD. Result: **0 files lost markers, 45 gained, 20 unchanged**. Every gain was diff-inspected for well-formedness; every unchanged-count file with content changes was diff-inspected for unmarked Kilo additions. Block balance (`start` vs `end`) re-checked for all delta files: all balanced.
3. **Full-PR count sweep at new head** — 406 paths (390 modified + deletions + rename pairs). 128 carry markers: **8 loss entries (all already adjudicated in round 1), ~60 gains, 60 count-stable**. Count-stable files re-verified by sorted marker-text comparison: only 2 text changes (`mcp/index.ts`, `transform.ts`), both adjudicated in round 1.
4. **NEW: zero-marker divergence sweep** (round 1's blind spot) — for every changed file outside kilo-named paths with **0 markers at base and head**, checked whether it still diverges from upstream (`git diff a105350812..HEAD`). 66 hits; each was classified by upstream existence and diff content. This is where the new findings come from.
5. **Empty-block scan** — no real empty `start`/`end` blocks anywhere in `packages/` (only literal test fixtures in `packages/script/tests/check-opencode-annotations.test.ts`).
6. **Forbidden-path check** — no `kilocode_change` markers in `packages/kilo-vscode/` or `packages/kilo-ui/` sources.

The 7 review-report `.md` files on this branch (round-1 reports) contain the literal string `kilocode_change` and appear in the raw sweep as 0→N "gains"; they are review artifacts, excluded from all conclusions.

## Round-1 finding verification status

### Finding 1 (unmarked `anthropicClaude5` in `anthropicAdaptiveEfforts`) — FIXED

`packages/opencode/src/provider/transform.ts:685-689` now wraps the modified condition in `// kilocode_change start - include Kilo Claude aliases` / `end`. Fixed in **a4d86f117f** (blame). Regression test added: `packages/opencode/test/kilocode/provider/kimi-adaptive-effort.test.ts` (new in delta).

### Finding 2 (deleted grok reasoning-variant suppression) — FIXED

The guard is restored at `transform.ts:836-838` in its original pre-npm-switch position with original semantics, wrapped in `// kilocode_change start - only grok-4.5 supports generic reasoning effort variants` / `end`. Fixed in **a4d86f117f**. The unmarked grok-3-mini block at line 823 is upstream-native (a105350812:788), so no marker is owed there. Regression tests: `packages/opencode/test/kilocode/provider/grok-reasoning-variants.test.ts` (new) plus a re-marked test in `test/provider/transform.test.ts` ("grok-4 suppresses generic provider efforts").

### Finding 3 (unbalanced marker block in `provider.ts`) — FIXED

`packages/opencode/src/provider/provider.ts` now has 13 `start` / 13 `end` (was 13/12 at base and round-1 head). The missing `// kilocode_change end` was added at line 1573, closing the "load auths before env" block, in **a4d86f117f**. Total markers 69 → 70.

### Finding 4 (i18n en/da/br unmarked Kilo lines) — PARTIALLY FIXED, residual open

The fix commits added an inline `// kilocode_change` to the `dialog.usageExceeded.freeTier.description` Kilo Go branding line in **19 locales** (en, da, br + ar, bs, de, es, fr, it, ja, ko, nl, no, pl, ru, th, tr, zh, zht), and extended `script/upstream/transforms/transform-i18n.ts` so future branding transforms append the marker automatically (`transform-i18n.ts`: `${transformedLine} // kilocode_change` when replacements > 0, covered by new `transform-i18n.test.ts`).

Residual, still open: the four Kilo-only keys (`ui.sessionTurn.status.delegatingWaitingPermission/Question`, `ui.messagePart.mcp.input/output`) in `en.ts:86-87,101-102`, `da.ts:81-82,104-105`, `br.ts:83-84,109-110` remain unmarked — verified absent from upstream's dictionary (a105350812 en.ts has 0 matches). See also **New finding 1**, which is the same remedy applied incompletely.

### Finding 5 (kilo-gateway condition line lost inline marker) — FIXED

The standalone `if (model.api.npm === "@kilocode/kilo-gateway") {` block at `transform.ts:1650-1654` now opens with a dedicated `// kilocode_change` line (1651), added in **37a5cbf5db**. The block is unambiguously marked.

## Delta hygiene (fix commits cbbbd7217f..37a5cbf5db)

**Verdict: clean.** No file lost markers in the delta (0 count drops). Every Kilo-specific addition to a shared file in the fix commits carries a marker; all inspected blocks are well-formed and balanced. Highlights:

- New markers restore/annotate Kilo behavior in: `transform.ts` (+6), `provider.ts` (+1, the F3 `end`), `task.ts` (+3, NotFound-tolerant ancestor walk), `cli/cmd/run/footer.command.tsx` (+6, ctrl+p up-binding), `plugin/modal/modal.ts` (+5) and `models.ts` (+3) (discovery-failure catalog preservation, `reasoning_text` field), `llm/src/provider-error.ts` (+2, token-throttle retry exclusion), `session-ui` prompt-input v2 files (+21 across 6 files, object-URL ownership/duplicate detection), `ui/src/components/scroll-view.tsx` (+1), `ui/src/v2/components/toast-v2.tsx` (+1), plus their test files.
- `.github/workflows/test.yml` and `.github/actions/setup-bun/action.yml`: additions/removals landed **inside** existing marked blocks; counts and balance unchanged.
- `script/check-test-ci.ts` (new file in a shared path) carries the correct `// kilocode_change - new file` header.
- Deleted delta files (`script/translate-app.{ts,test.ts,md}`, `patches/@dnd-kit%2Fdom@0.5.0.patch`) carried 0 markers; translate-app paths were also added to `skipFiles` in `script/upstream/utils/config.ts` so they stay deleted on future merges. No stale markers left behind.
- The 3 new regression test files live in `test/kilocode/` (marker-exempt). The 2 `kilo-vscode` delta files remain marker-free as required.

## New findings

### 1. SUSPICIOUS — i18n branding markers applied inconsistently: 9 of 28 "Kilo Go" locales still unmarked

The fix commits marked the `dialog.usageExceeded.freeTier.description` branding line in 19 locales (Finding 4 remedy), but **9 locale files still carry the Kilo Go line with no marker**: `packages/ui/src/i18n/{az,fi,hi,id,pa,sv,uk,ur,vi}.ts` (verified by per-file grep; e.g. `az.ts:72`, `sv.ts:72`, `uk.ts:80`).

Evidence and mechanism:

- **az, fi, hi, id, pa, sv, ur, vi are NEW upstream locales** — absent from b135b4e10a, added by upstream v1.18.13 with "OpenCode Go" text, branded to "Kilo Go" during this merge (`git diff a105350812..HEAD` shows exactly the branding line, 4 changed lines each). They were branded before `transform-i18n.ts` gained its marker-appending behavior and were never retro-marked.
- **uk.ts is pre-existing**: its branding line was unmarked at base too, but round 1's consolidation moved uk's other Kilo keys into a trailing block (lines 229-249) that does **not** cover line 80, and the fix commits gave 19 sibling locales the inline marker while skipping uk.
- The current `transform-i18n.ts` cannot self-heal these files: it only appends the marker to lines it re-brands (`lineReplacements > 0`), and these lines already read "Kilo Go", so a re-run is a no-op. They will stay unmarked until the next upstream dictionary refresh re-takes the files, or someone fixes them by hand.

Risk is low (the divergence is a single branding string per file, and `transform-i18n` re-brands correctly from upstream content), but the tree is currently in an inconsistent state where identical Kilo modifications are marked in 19 locales and unmarked in 9 — flagged for human fix.

### 2. NEEDS HUMAN VERIFICATION (pre-existing, round-1 miss) — `packages/opencode/test/cli/import.test.ts`: unmarked Kilo test replacements in a shared file

The file has **0 markers at base and at head**, yet diverges from upstream by 61 changed lines: Kilo replaced upstream's share-URL tests with `app.kilo.ai/s/...` cases and added Kilo-only tests for `bootstrapImportedSessionIngest` / `ingestBootstrapWarning` (verified: base already contained all of these, so the divergence is pre-existing; the merge touched the file, 38 changed lines, and preserved the Kilo tests unmarked). Round 1's count-based sweep structurally could not see 0→0 files; the new zero-marker divergence sweep caught it. The neighboring convention in this repo would mark these test blocks (`// kilocode_change start/end`) — recommend a human confirm and mark.

### 3. NEEDS HUMAN VERIFICATION (pre-existing, round-1 miss) — `packages/protocol/src/groups/pty.ts`: unmarked Kilo functional addition

`export const PTY_REPLAY_EXITED_QUERY = "replayExited"` plus its entry in the query-param allowlist is a Kilo-only functional addition to a shared upstream file (absent at a105350812, present at base b135b4e10a — pre-existing). Unlike the mechanical `x-opencode-ticket → x-kilo-ticket` rename in the same file (tooling-managed convention), this is new logic with no marker and no merge-transform coverage. Flagged for a human to decide whether to mark it.

### 4. OBSERVATION (pre-existing hygiene cluster, round-1 miss) — more unmarked 0→0 divergences

Same structural blind spot as findings 2-3, smaller stakes, all verified pre-existing at base (unmarked before and after):

- `packages/core/test/tool-read.test.ts` — Kilo's `inspect` mock returns a different shape (`{ path, type, dev: 0, ino: 0 }`) than upstream's (`resolvedType`); 11 changed lines vs upstream, unmarked.
- `packages/storybook/.storybook/main.ts` — Kilo removed the `{ find: "@", replacement: app }` alias; unmarked.
- `packages/ui/src/components/tabs.css` — `gap: 2px` vs upstream `gap: 0`; unmarked (while sibling `select.css`/`theme.css` in the same directory do carry markers).

None are merge regressions, but a future upstream refresh could silently overwrite them. Flagged for completeness.

## Notable non-findings

- **`packages/opencode/src/session/prompt/meta.txt` (unmarked Kilo branding, merge-introduced):** verified **safe by construction** — running the current `applyBrandingTransforms` on upstream's meta.txt reproduces Kilo's branded file **byte-identically** (5 replacements: "You are Kilo", "Kilo Specifics", kilo.ai/docs, Kilo-Org/kilocode). The fix commits added the file to `takeTheirsAndTransform` in `script/upstream/utils/config.ts` and added `test/kilocode/session/meta-prompt.test.ts`. Prompt `.txt` files carry no markers anywhere in the repo (model-facing text), so this follows convention. No action needed.
- **`packages/core/src/fs-util.ts` delta revert:** 37a5cbf5db removed upstream's EEXIST `catchIf` wrapper that the merge had placed around Kilo's `ensureDirectory(fs, path)` call, restoring base form with its marker intact. Verified safe: Kilo's `ensureDirectory` (`packages/kilo-sandbox/src/filesystem.ts:15-22`) already swallows `AlreadyExists` internally. Only upstream's extra not-a-directory re-check is dropped — pre-merge Kilo semantics. Marker hygiene unaffected.
- **Zero-marker mechanical renames:** all `@opencode-ai/* → @kilocode/*` imports (9 session-ui/ui files, `github-copilot.ts`, `customize-opencode.md`), `OPENCODE_* → KILO_*` env/flag renames (`watcher.ts`, `instruction-context.ts`, `repository.ts`), and `x-kilo-ticket` are the pre-existing tooling-managed rename convention (transforms: package-names, take-theirs), identical in kind to base. Not marker candidates.
- **`packages/sdk/js/src/v2/gen/types.gen.ts` / `openapi.json`:** 18k-line generated divergence reflecting Kilo server endpoints; generated files can't hold durable markers and are regenerated by `script/generate.ts`. Out of marker scope by design.
- **All round-1 non-findings re-verified at new head:** models-dev.ts 10→7, processor.ts 98→97, marked.tsx 33→31, the 3 upstream-identity files (account/service.test.ts, oauth-browser.test.ts, markdown-worker.ts), and the i18n consolidation counts (now 6→3 / 8→3 / 5→3 after the +1 branding marker; uk still 28→2) are unchanged in substance.
- **Fix-commit marker additions outside opencode/src** (`llm/`, `session-ui/`, `ui/`, `script/`) are all well-formed with descriptive comments; several were direct remedies for round-1 sibling-report findings.

## Limitations

- The zero-marker divergence sweep judges divergence *content* by diff inspection; it cannot distinguish "intentionally unmarked per unwritten convention" from "forgot to mark" — findings 2-4 are therefore framed as human-verification items, and there may be more pre-existing unmarked divergences in files the PR did not touch (out of scope).
- Count/text comparison still cannot detect a marker moved far from its code when count and text are unchanged (inherited from round 1).
- "Intentional" judgments for the delta commits are inferred from code shape, tests, and tooling wiring, not from the committer's intent; the commit messages ("address merge review findings") corroborate but do not prove intent for each hunk.
- The transform-i18n self-heal prediction in finding 1 assumes future merges process locale files through `takeTheirsAndTransform`/transform-i18n; a manual future merge could carry the unmarked lines forward indefinitely.
