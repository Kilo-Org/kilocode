# kilocode_change Marker Review V5 — upstream v1.18.13 merge (round 5)

**Reviewed HEAD:** 4bb1c2a45b · **Round-4 HEAD:** b793883de6 · **PR base (merge-base with origin/main):** 4f59fcb666 (unchanged) · **Upstream tag:** v1.18.13 (a105350812)

## Scope & Methodology

Round 5 covers (a) marker hygiene of the round-4-fix commit `4bb1c2a45b` ("fix(core): address round 4 review findings", 5 files), (b) re-verification of every open round-4 finding at the new head, (c) stability of the 8 intentional i18n demarkings adjudicated in round 4, and (d) a fresh full-PR sweep at the unchanged base `git diff 4f59fcb666...4bb1c2a45b` (422 files — same set as round 4).

The 4 commits on top of the reviewed head in this worktree are report-only (28 `.md` files, +2545/−0); all non-report blobs equal the reviewed head, so no artifact exclusion was needed.

Approach:

1. **Fix-commit audit** — full patch read; per-file marker counts b793883de6 vs 4bb1c2a45b; shared-vs-Kilo-owned classification via upstream existence (`git cat-file -e a105350812:<path>`); upstream-divergence shape via `git diff a105350812..4bb1c2a45b`; base-line archaeology at 4f59fcb666 and b135b4e10a for the models-dev.ts URL history.
2. **Open-finding re-verification** — per-file greps and upstream diffs for each round-4 open item.
3. **Demarking stability** — counts at both heads plus upstream diff shape for az/fi/hi/id/pa/sv/ur/vi.
4. **Full-PR count sweep** — base vs head counts for all 422 files, computed at **both** heads so the round-4 and round-5 sweeps can be diffed under identical methodology; block balance (`start` vs `end`) re-checked for all 422 files at head: **all balanced**; count-stable marker files re-verified by sorted marker-text comparison.
5. **Zero-marker divergence sweep** — PR files outside kilo-owned paths with 0 markers at head that diverge from upstream a105350812, computed at both heads and diffed; every entry classified against prior adjudications.
6. **Forbidden-path check** — `git grep kilocode_change 4bb1c2a45b -- packages/kilo-vscode packages/kilo-ui`: kilo-ui 0 hits; kilo-vscode only the previously adjudicated excluded references (AGENTS.md, the `check-kilocode-change` script name in package.json, backtick-quoted references in `tests/unit/kilo-ui-contract.test.ts`).
7. Ran the restored test: `bun test test/cli/tui/diff-viewer-file-tree.test.tsx` (packages/tui) → **3 pass, 1 pre-existing skip, 0 fail**.

## Fix-commit marker hygiene (4bb1c2a45b)

**Verdict: clean.** Each of the 5 files maps to a round-4 sibling-report finding; the Kilo-owned-path files are correctly marker-free, and every shared-file change is marked.

| File | Path class | Markers | Verdict |
|---|---|---|---|
| `packages/core/src/models-dev.ts` | shared (exists at a105350812) | 7→9 | clean |
| `packages/opencode/src/config/config.ts` | shared | 115→115 | clean |
| `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` | shared | 0→2 | clean; see New finding 1 |
| `packages/opencode/script/kilocode/test-cli.ts` | kilocode path (marker-exempt) | 1→1 | clean |
| `packages/kilo-vscode/src/agent-manager/GitOps.ts` | kilo-vscode (markers forbidden) | 0→0 | clean |

- **models-dev.ts (+2, well-formed):** restores the base branch's deliberate `"https://models.dev"` default on the `source` line and its cache-key comparison (the merge had flipped it to upstream v1.18.13's `models.opencode.ai` — CONFIG_REGRESSION_V4's flagged observation). Both changed lines now carry inline `// kilocode_change`. Archaeology: at base 4f59fcb666 (and pre-merge base b135b4e10a) these lines read `models.dev` **unmarked** — correct then, because then-upstream matched; against v1.18.13 the lines genuinely diverge, so the new markers are owed and correctly placed on exactly the divergent lines. The full-PR count for this file is now 10→9 (was 10→7): the round-1-adjudicated retirement of the 3 `reasoning_options` markers (upstream adopted the schema) stands, partially offset by these 2 new markers.
- **config.ts (115→115; no marker or Kilo hunk removed):** both changed regions remain inside their marked coverage. Hunk 1 (`ensureGitignore`'s `fs.ensureDir`): the `start`/`end` pair is retained; the `start` text was extended ("…or read-only locations") to match the broadened behavior (`catchReason` PermissionDenied+NotFound → `catchTag("PlatformError")`, now also covering EROFS — BROKEN_PIPELINE_CHAINS_V4 finding 4's remedy). Hunk 2 (gitignore write): the inline marker on the removed `catchIf` predicate was replaced 1-for-1 by an inline marker on the new `catchTag` line ("optional gitignore write failure must not fail config load"). Net count unchanged; the 2 reworded marker texts ride along with the file's count-changed entry (base 113→head 115) and accurately describe the broadened catch. Behavior-broadening correctness is the sibling reviewer's domain; marker hygiene is intact.
- **diff-viewer-file-tree.test.tsx (0→2):** restores the two upstream `expect(...line.includes("*")).toBe(false)` assertions byte-identically, wrapped in `// kilocode_change start - restore upstream absence assertions` / `end`. The file now diverges from upstream by **exactly the 2 marker lines** (verified: upstream diff is 2+/0−, assertions appear as context); the component under test remains byte-identical to upstream, and the restored assertions pass. Resolves R3-F2 — with a convention caveat recorded as New finding 1.
- **test-cli.ts (kilocode path):** the empty-catch fix (`catch (err) { console.warn(...) }` — INFRASTRUCTURE_CHANGE_V4's V4-1) owes no marker and adds none. The pre-existing `// kilocode_change - new file` header (1→1) remains; round 4 called it unnecessary-but-harmless and it was never a finding.
- **GitOps.ts (kilo-vscode path):** +12 `delete env.*` lines (the BROKEN_PIPELINE_CHAINS_V4 env-gap remedy), 0 markers as required for the forbidden path.

## Prior-findings verification status

### R3-F2 (diff-viewer-file-tree.test.tsx deleted upstream assertions) — FIXED

See above: assertions restored, passing, file's only upstream divergence is the self-describing marker pair. Convention caveat in New finding 1.

### Carried items — ALL STILL OPEN, unchanged at 4bb1c2a45b

- **R3-F3** `packages/core/test/reference.test.ts` — 0 markers; sole divergence remains the deleted `import { LayerNode }` line.
- **R2-N2** `packages/opencode/test/cli/import.test.ts` — 0 markers; 51+/8− Kilo test divergence unchanged.
- **R2-N3** `packages/protocol/src/groups/pty.ts` — 0 markers; `PTY_REPLAY_EXITED_QUERY` (line 12) + allowlist entry (line 139) unchanged.
- **R2-N4 cluster** — `packages/core/test/tool-read.test.ts` (0 markers, 6+/3− `inspect` mock shape), `packages/storybook/.storybook/main.ts` (0 markers, removed `@` alias), `packages/ui/src/components/tabs.css` (0 markers, `gap: 2px` at line 577): all unchanged.
- **R1-F4 residual** — the four Kilo-only keys remain unmarked at `en.ts:86-87,101-102`, `da.ts:81-82,104-105`, `br.ts:83-84,109-110`; each file still carries 7 markers elsewhere.
- **V4-F1 (redundant markers from `3b2686af84`)** — not cleaned: `script/build.ts` 47→47 (nested anonymous block inside the pre-existing `codebase indexing` block; start=19/end=19 balanced) and `script/test-runner.ts` 4→4 (inner block inside a wholly-marked Kilo-new file) are untouched by the fix commit. Remains an observation for human decision (drop the inner blocks or confirm the granularity is wanted); no correctness risk.

## i18n demarking stability (round-4 cross-report item)

The 8 intentionally demarked locales are **stable, no regression**: `az, fi, hi, id, pa, sv, ur, vi` each read 0→0 markers across the fix commit, and each still diverges from upstream a105350812 by exactly the single `OpenCode Go → Kilo Go` branding line (verified identical 1-line diff shape for all 8; content spot-checked on az.ts). Round 4's tooling verdict (`reset-to-upstream.ts --dry-run` → transform-identical) is therefore still descriptive of the tree. The 19 marker-carrying sibling locales are unchanged (en/da/br verified directly at 7 each; the other 16 sit at their adjudicated consolidation counts in the sweep below).

## Full-PR sweep at base 4f59fcb666 (422 files)

**Count changes: 69 files (round 4: 68).** The inter-head diff of the two sweeps is exactly two entries, both from the fix commit and adjudicated above: `models-dev.ts` 10→7→**9** and `diff-viewer-file-tree.test.tsx` 0→0→**2**. All other entries reproduce round 4 verbatim.

**Drops — no new adjudications needed.** Every base→head drop matches round-1/2/3/4 adjudications: i18n consolidation (17 locales 6/5/8→3, uk 28→3), `models-dev.ts` 10→9 (round-1 `reasoning_options` retirement, offset by the 2 new owed markers), `processor.ts` 98→97, `marked.tsx` 33→31, the 3 upstream-identity files (`account/service.test.ts` 1→0, `oauth-browser.test.ts` 2→0, session-ui `markdown-worker.ts` 2→0). The 4 PR deletions (`markdown-preload.test.ts` + 3 patches) carried 0 markers at base.

**Count-stable text changes: 4.** `mcp/index.ts` (29), `transform.ts` (60), `transform.test.ts` (24) — all round-4-adjudicated shapes, identical between the two heads. **New to this round's detection:** `experimental.ts` (30) — a whitespace-only re-indent of one existing `start`/`end` pair (6→8 spaces); the marked `worktreeDiff*` handler block moved with its code during an upstream chain refactor, coverage unchanged, texts identical between the two heads. Round 4's comparison missed the indent shift; substance is benign (see Notable non-findings).

**Zero-marker divergence sweep:** identical-methodology inter-head diff is exactly one entry — `diff-viewer-file-tree.test.tsx` drops out (now marked). Result at head: **56 diverging + 12 upstream-missing**. Every entry matches a prior classification: 13 package.json (transform-package-json), `bun.lock`, `types.gen.ts` + `openapi.json` (generated), `meta.txt` (takeTheirsAndTransform), the 8 demarked i18n locales (transform-identical), 13 session-ui/ui rename files (`@opencode-ai/* → @kilocode/*` / branding), 5 core `OPENCODE_* → KILO_*` rename files, 5 LFS `.mp4` pointers, patch files (no marker convention), `.changeset/*` + `.opencode-version` (Kilo data files), 5 `script/upstream/*` tooling files (Kilo-owned per `config.ts` kiloDirectories), the `markdown-preload.test.ts` PR deletion, `sprite.svg` (pre-existing observation), and the 6 still-open divergence findings above. Reconciliation with round 4's "57 diverging + 4 upstream-missing" prose: identical diverging count at the round-4 head (57 = 56 + diff-viewer); the upstream-missing raw-count delta (12 vs 4) is scope definition — this sweep includes the 5 Kilo-owned `script/upstream` files, the PR deletion, and 2 deleted patches that round 4 counted elsewhere. **No new unmarked divergences surfaced.**

## New findings

### 1. OBSERVATION (needs human verification) — restored upstream assertions wrapped in a `kilocode_change` block

The R3-F2 fix restores upstream's two asterisk-absence assertions **byte-identically** and wraps them in `// kilocode_change start - restore upstream absence assertions` / `end` (`diff-viewer-file-tree.test.tsx:112-115`). The marker convention normally annotates Kilo *divergences* from upstream; here the marked content is upstream-native and the file's only divergence is the marker pair itself. This is defensible — the block is self-describing, and it pins the assertions against the exact failure mode that occurred (a silent branch-side deletion, `cb44dd327c`) — but it inverts the usual semantics: a future upstream *modification* of these assertions could be resisted by the marked block and fossilize stale expectations. The alternative remedy was an unmarked restore (file byte-identical to upstream, same class as round 1's three upstream-identity files). Risk: none today (test passes; component upstream-identical). Flagged for human confirmation that the marked-restore granularity — rather than byte-identical restore — is the wanted end state.

## Notable non-findings

- **All round-1/2/3/4 full-PR adjudications re-verified at the same base:** with the base unchanged at 4f59fcb666, the sweep reproduces round 4 exactly except the two fix-commit entries; no new drop, gain, or text change appeared.
- **`experimental.ts` text-change detection (report correction):** the round-4 report listed 3 count-stable text changes; the correct count at that head was 4. The missed entry is whitespace-only (marker pair re-indented with its code), identical at both heads — a detection gap in round 4's comparison, not a tree regression and not an action item.
- **GitOps.ts env-scrub and test-cli.ts catch fix are marker-neutral:** both live in Kilo-owned paths (kilo-vscode markers forbidden; kilocode path marker-exempt). The completeness of the env-var list (e.g. `GIT_EXEC_PATH`/`PREFIX` not stripped) is the sibling pipeline reviewer's domain, not marker hygiene.
- **Block balance:** all 422 PR files have matched `start`/`end` counts at head, including the fix-commit files (diff-viewer 1/1; config.ts unchanged; models-dev inline-only).
- **Restored assertions pass:** the diff-viewer suite is green at head (3 pass, 1 pre-existing skip), confirming TESTS_V4's prediction that the component renders no `*`.

## Limitations

- Count/text comparison cannot detect a marker moved far from its code when count and text are unchanged (inherited from rounds 1–4). Round 5 additionally showed the sorted-text comparison is whitespace-sensitive in a way that can desync rounds (experimental.ts) — benign here, but cross-round text diffs should normalize indentation.
- The zero-marker sweep covers only files in the 422-file PR diff; main-lineage unmarked divergences outside it (e.g. `footer.ts`, `plugin/src/tui.ts`, `client/src/generated/*`) are out of scope by construction.
- The i18n demarking stability check re-verified counts and diff shape for all 8 locales plus content for az.ts; it did not re-run `reset-to-upstream.ts --dry-run` (round 4's tooling verdict, files unchanged since).
- The models-dev.ts `models.dev` restoration is verified as base-branch-intentional by git archaeology (and CONFIG_REGRESSION_V4's analysis), not by testing which endpoint serves Kilo today; product intent confirmation remains with the config-regression review.
- New finding 1's convention call assumes the project treats markers as divergence annotations; if marked-restores are an accepted documentation pattern, the finding is moot.
