# kilocode_change Marker Review V4 — upstream v1.18.13 merge (round 4)

**Reviewed HEAD:** b793883de6 · **Round-3 HEAD:** b6505b164b · **New PR base (merge-base with origin/main):** 4f59fcb666 · **Upstream tag:** v1.18.13 (a105350812)

## Scope & Methodology

Round 4 covers (a) re-verification of every open round-3 finding at the new head, (b) an audit of annotation commit `3b2686af84`, (c) marker hygiene of the delta `git diff b6505b164b..b793883de6` (151 files — a main-merge plus branch fix `6d331a726f`), and (d) a fresh full-PR sweep at the new base `git diff 4f59fcb666...b793883de6` (422 files; base moved forward, so main-lineage files such as `cli/cmd/web.ts` and `packages/client/src/generated/*` dropped out of the PR diff).

Approach:

1. **Round-3 re-verification** — per-file greps and `git diff a105350812..b793883de6` for each open finding, plus blame for the fixed one.
2. **Delta count sweep** — markers at b6505b164b vs head for all 151 delta files. Result: **26 files with count changes: 18 gains, 8 drops**. Every drop diff-inspected; every gain diff-inspected for well-formedness and genuine Kilo divergence. Block balance re-checked for **all 422 PR files** at head: **all balanced**.
3. **Full-PR count sweep at new base** — 4f59fcb666 vs head across all 422 changed files: 68 files with count changes. Count-stable marker files re-verified by sorted marker-text comparison: 3 text changes, all adjudicated below.
4. **Zero-marker divergence sweep at new base** — PR files outside kilo-owned paths with 0 markers at head that still diverge from upstream a105350812: **57 diverging + 4 upstream-missing**; each classified against `script/upstream/` transform coverage (config read first; `reset-to-upstream.ts --dry-run` executed for the demarked i18n files).
5. **Forbidden-path check** — 0 `kilocode_change` hits in `packages/kilo-ui/` and `packages/kilo-vscode/` sources at head.

Unlike rounds 1–3, the round-1–3 review-report `.md` files are **not** on the PR branch anymore (they live on the report-only commits above the reviewed head), so no artifact exclusion was needed in the sweeps.

## Round-3 finding verification status

### R3-F1 (marked-code-span.ts + marked-code-span.test.ts missing `- new file` headers) — FIXED

Both files now carry `// kilocode_change - new file` at line 1 (`packages/ui/src/context/marked-code-span.ts:1`, `marked-code-span.test.ts:1`), blamed to branch fix commit **6d331a726f**. Marker counts 0→1 each in the delta. Note the fix is complete per convention: `.ts` files are not covered by the `takeTheirsAndTransform` glob (`packages/ui/src/context/**/*.tsx`, config.ts:187), so the header is the right discoverability mechanism.

### R3-F2 (diff-viewer-file-tree.test.tsx deleted upstream assertions) — STILL OPEN, unchanged

`packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`: 0 markers at base and head; the file's only divergence from upstream remains the unmarked deletion of the two `expect(...line.includes("*")).toBe(false)` assertions (0+/2−, hunk at line 109). The component under test (`packages/tui/src/feature-plugins/system/diff-viewer-file-tree.tsx`) is still **byte-identical to upstream** at b793883de6, so round 3's concern stands unaddressed: the weakening is undocumented, unmarked, and will be silently reintroduced by any future upstream refresh of the test. Human verification still required.

### R3-F3 (reference.test.ts unmarked dead-import deletion) — STILL OPEN, unchanged

`packages/core/test/reference.test.ts`: 0 markers; the sole divergence is the deleted `import { LayerNode }` line (0+/1− vs upstream). Trivial stakes; flagged for completeness.

### Carried items — ALL STILL OPEN, unchanged

- **R2-N2** `packages/opencode/test/cli/import.test.ts` — 0 markers at base and head; 51+/8− divergence (Kilo share-URL tests + Kilo-only ingest tests) unchanged.
- **R2-N3** `packages/protocol/src/groups/pty.ts` — 0 markers; `PTY_REPLAY_EXITED_QUERY = "replayExited"` (line 12) and its allowlist entry (line 139) remain an unmarked Kilo-only functional addition.
- **R2-N4 cluster** — `packages/core/test/tool-read.test.ts` (0 markers, `inspect` mock shape), `packages/storybook/.storybook/main.ts` (0 markers, removed `@` alias), `packages/ui/src/components/tabs.css` (0 markers, `gap: 2px` at line 577): all unchanged.
- **R1-F4 residual** — the four Kilo-only keys remain unmarked at `en.ts:86-87,101-102`, `da.ts:81-82,104-105`, `br.ts:83-84,109-110`. en/da/br each carry 7 markers elsewhere in the file; the residual keys sit outside every marked block.

## Delta hygiene (b6505b164b..b793883de6)

**Verdict: clean.** The only drops are the 8 intentional i18n demarkings (below); every gain is a well-formed marker on a genuine Kilo divergence.

**Drops (8, all adjudicated — intentional):** `packages/ui/src/i18n/{az,fi,hi,id,pa,sv,ur,vi}.ts` each 1→0. Branch fix `6d331a726f` removed the trailing `// kilocode_change` from the `dialog.usageExceeded.freeTier.description` branding line, implementing UNNECESSARY_MARKERS_V3's recommendation. Verified pipeline-stable with the repo's own tooling: `reset-to-upstream.ts --dry-run packages/ui/src/i18n/az.ts` reports **"already matches transformed upstream v1.18.13"** — the branding transform reproduces the Kilo Go text and neither transform re-appends the marker, so the removal will not be undone by the next merge.

**Gains (18, all inspected, well-formed):**

- From the main-merge (credential-sanitization work, e.g. `4e36297668`): `format/index.ts` +3, `lsp/launch.ts` +3, `util/process.ts` +3, `mcp/index.ts` +3, `tool/shell.ts` +2 — all `modelEnv(...)` / `extendEnv: false` divergences with descriptive inline markers or start/end blocks; `core/src/pty.ts` +2 and `schema/src/pty.ts` +2 (marked "spawn with initial terminal dimensions" blocks); test-side markers in `test/lsp/launch.test.ts` +2, `test/util/process.test.ts` +2, `test/server/httpapi-pty.test.ts` +2, `test/server/httpapi-exercise/backend.ts` +2.
- From branch fix `6d331a726f`: `session/session.ts` +1 (`platform: KiloSession.resolvePlatform(original.id), // kilocode_change - inherit platform telemetry attribution`, session.ts:873), plus the two marked-code-span headers.
- From `3b2686af84` (in the delta via the main-merge; now in the PR **base**): `script/build.ts` +2, `script/test-runner.ts` +2 — see New finding 1.
- `script/check-architecture.ts` 0→1 (correct `- new file` header on a Kilo-new file in a shared path), `script/kilocode/test-cli.ts` 0→1 (header inside a kilocode path — unnecessary but harmless).

**Count-stable task-listed files, diff-inspected:** `command/index.ts` 30→30 (two `legacyReviewCommand` lines removed *inside* the existing marked block; the import at line 10 stays marked and is still used at line 199 — no dead import), `config/config.ts` 115→115 (all three `properties: { sandbox: ... }` hunks and the new `sandboxChanged` local sit inside pre-existing marked blocks — first hunk inside the `start - delegate Kilo project config update behavior` block at line 1005). Both clean.

**kilo-ui:** 6 delta files (`basic-tool.css/.tsx`, `message-part.tsx`, `tool-approval.tsx`, `lucide.ts`) — 0 markers, as required. Forbidden-path check passes.

**`packages/client/src/generated/{client,types}.ts`:** in the delta but **not** in the PR diff at the new base (main-lineage generated code); 0 markers, diverges from upstream — same generated-file class as `sdk/js/src/v2/gen/*.gen.ts`, no markers owed.

## Full-PR sweep at base 4f59fcb666 (422 files)

**Count drops — no new adjudications needed.** Every drop matches round-1/2/3 adjudications: i18n consolidation (17 locales 6/5/8→3, uk 28→3), `models-dev.ts` 10→7, `processor.ts` 98→97, `marked.tsx` 33→31, and the 3 upstream-identity files (`account/service.test.ts` 1→0, `oauth-browser.test.ts` 2→0, session-ui `markdown-worker.ts` 2→0). The 4 PR deletions (`markdown-preload.test.ts`, 3 patches) carried 0 markers at base. `task.ts` reads 50→53 at this base; the text diff shows only previously adjudicated content (the R1-adjudicated `subagent_depth` rewording, the R2-adjudicated ancestor-walk block).

**Count-stable text changes (3):** `mcp/index.ts` (block description reworded around the R1-adjudicated authority wrapping), `transform.ts` (texts now match the R2-fixed state — `include Kilo Claude aliases` block at :685, restored grok-4.5 guard; 14/14 balanced at head), `transform.test.ts` (description reworded). All previously adjudicated shapes; balance intact (mcp 8/8, test 11/11).

**Zero-marker divergence sweep:** 57 diverging + 4 upstream-missing, all classified:

- *Transform/tooling-covered (no marker owed):* 13 package.json files (transform-package-json rules), `bun.lock`, `types.gen.ts` + `openapi.json` (generated / keepOurs + regenerate), `meta.txt` (takeTheirsAndTransform), the 8 demarked i18n locales (verified transform-identical), 13 session-ui/ui files with pure `@opencode-ai/* → @kilocode/*` / `"OpenCode" → "Kilo"` renames (spot-checked `session-diff.ts`, `marked-theme.tsx`), 5 core files with `OPENCODE_* → KILO_*` renames (spot-checked `watcher.ts`), 5 LFS `.mp4` pointers, patch files (no marker convention), `.changeset/*` + `.opencode-version` (Kilo data files).
- *Pre-existing observation:* `packages/ui/src/components/provider-icons/sprite.svg` (Kilo brand icons in a shared SVG asset; no asset-marker convention).
- *The 7 open findings above* — no **new** unmarked divergences surfaced at this base.

## New findings

### 1. OBSERVATION (needs human verification) — `3b2686af84` adds only redundant markers

The annotation commit (authored on main, pulled into the delta by the main-merge; **already inside PR base 4f59fcb666**, so not part of the PR diff itself) touches two files:

- **`packages/opencode/script/build.ts` (+2):** wraps `isKiloConsoleUpToDate`/`buildKiloConsole` in `// kilocode_change start` (build.ts:54) / `end` (:106). That region was **already fully covered** by the pre-existing outer block `// kilocode_change start - codebase indexing` (:35) … `end` (:170 pre-commit numbering) — the commit nests a second anonymous block inside it. The same commit also moved upstream's `await $`rm -rf dist`` line into the marked `Promise.all` block (:260-267); that one is legitimate (the marker covers Kilo's reordering of the clean step). Verified nothing upstream is mis-marked as Kilo: both wrapped functions are Kilo-only.
- **`packages/opencode/script/test-runner.ts` (+2):** adds a `start`/`end` block around the `supplied`/`built`/`cleanBinary` lines inside a file that already carries `// kilocode_change - new file` at line 1 — the entire 648-line file is Kilo-owned (confirmed absent at a105350812), so the inner block marks a subset of an already wholly-marked file.

Neither addition is *incorrect* (no upstream code is claimed as Kilo), but both are redundant given existing coverage, and the nesting/inconsistent granularity adds noise for future merges. Flagged for human verification: either simplify (drop the inner blocks) or confirm the extra granularity is wanted. Risk: none to correctness; balance checks still pass (build.ts 19/19, test-runner.ts 2/2).

## Cross-report consistency note (i18n)

For the UNNECESSARY_MARKERS round-4 reviewer: the 8 flagged markers (`az,fi,hi,id,pa,sv,ur,vi`) are **removed** at this head (by `6d331a726f`), verified transform-stable. Residual state to re-assess: `uk.ts:80` and the 19 round-2 locales (en, da, br, ar, bs, de, es, fr, it, ja, ko, nl, no, pl, ru, th, tr, zh, zht) still carry the same branding-line `// kilocode_change` — by the V3 logic those markers are equally transform-reproducible, but those files also carry other real Kilo drift, so they were never `markers-only`. `transform-i18n.ts` is unchanged by the delta. This report takes no position; noted so both reviews describe the same tree.

## Notable non-findings

- **All round-1/2/3 full-PR adjudications re-verified at the new base:** every count drop and text change matches a prior adjudication; no new drop appeared despite the base moving from 6fce4e2564 to 4f59fcb666.
- **`cli/cmd/web.ts` removal is now base state:** absent at both 4f59fcb666 and head, so it no longer appears as a PR-delta item; `index.ts` keeps its marked omission comments (17→17, spot-checked).
- **`packages/client/src/generated/*`:** main-lineage generated files, out of the PR diff at this base; 0 markers, diverge from upstream as generated code — same class as `sdk/js/src/v2/gen/*`.
- **Gains from the main-merge are Kilo's own recent feature work** (sandbox credential sanitization, PTY initial dimensions), marked at the same standard as the branch's own annotations.

## Limitations

- Count/text comparison cannot detect a marker moved far from its code when count and text are unchanged (inherited from rounds 1–3).
- The zero-marker sweep covers only files in the 422-file PR diff; main-lineage unmarked divergences outside it (e.g. `footer.ts`, `plugin/src/tui.ts`, `client/src/generated/*`) are out of scope by construction.
- The i18n demarking verdict relies on `reset-to-upstream.ts --dry-run` output ("already matches transformed upstream") for az.ts plus the identical single-line diff shape of the other 7; not all 8 were individually dry-run.
- "Intentional" judgments for delta commits are inferred from code shape, commit messages, and tooling wiring, not from the committer's intent.
- Finding 1's redundancy call assumes the `- new file` header and outer blocks are considered sufficient coverage by convention; if the project wants inner granularity regardless, the finding is moot.
