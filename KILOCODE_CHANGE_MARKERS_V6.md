# kilocode_change Marker Review V6 — upstream v1.18.13 merge (round 6, LIGHT)

**Reviewed HEAD:** 77246a52cb · **Round-5 HEAD:** 4bb1c2a45b · **PR base:** 4f59fcb666 (unchanged) · **Upstream tag:** v1.18.13 (a105350812)

## Scope & Methodology

Light round. Covers (a) marker hygiene of the round-5-fix commit `77246a52cb` ("fix(core): address round 5 review findings", 6 files) and (b) fast re-verification of the round-5 open carried findings. **The full-PR sweep is skipped this round** (see Limitations).

Method: full patch read of the fix commit; per-file marker counts 4bb1c2a45b vs 77246a52cb (`git show <head>:<path> | grep -c kilocode_change`); shared-vs-Kilo-owned classification via upstream existence (`git cat-file -e a105350812:<path>`); upstream-divergence shape via `git diff a105350812..77246a52cb -- <path>`; URL archaeology at base 4f59fcb666; carried findings re-verified by blob-identity between heads plus targeted greps.

## Fix-commit marker hygiene (77246a52cb)

**Verdict: clean.** All 6 files correctly marked or correctly unmarked; the round-5 marker-inversion finding is resolved.

| File | Path class | Markers 4bb1c2a45b→77246a52cb | Verdict |
|---|---|---|---|
| `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` | shared (exists upstream) | 2→0 | **FIXED** — see below |
| `packages/ui/vite.config.ts` | shared | 2→3 | clean |
| `packages/llm/script/recording-cost-report.ts` | shared | 0→1 | clean |
| `packages/core/src/repository-cache.ts` | shared | 2→5 (start/end 1/1, balanced) | clean |
| `packages/opencode/src/kilocode/kilo-commands.tsx` | kilocode path (marker-exempt) | 0→0 | clean |
| `packages/kilo-vscode/src/agent-manager/GitOps.ts` | kilo-vscode (markers forbidden) | 0→0 | clean |

- **diff-viewer-file-tree.test.tsx — V5 New finding 1 / UNNECESSARY_MARKERS R5-F1 FIXED.** The fix drops the `kilocode_change start/end` pair wrapping the two upstream-verbatim assertions (−2 lines, exactly the marker comments). Verified: `git diff a105350812..77246a52cb` for this file is **empty** — the file is now byte-identical to upstream, with 0 markers, matching its base-branch state (0 markers at 4f59fcb666). This adopts precisely the remedy both round-5 reports recommended (unmarked restore; same class as round 1's three upstream-identity files). No residual marker drift; the file will also drop out of the `markers-only` reset-candidate bucket.
- **vite.config.ts (+1 inline, correct):** restores base's deliberate `https://models.dev` default on the `fetchProviderIcons` url line (the merge had flipped it to upstream's `models.opencode.ai`). Upstream's line is `process.env.OPENCODE_MODELS_URL || "https://models.opencode.ai"` (a105350812:48), so the Kilo line genuinely diverges; the inline `// kilocode_change` sits exactly on the divergent line. Base carried the line unmarked (correct then); against v1.18.13 the marker is owed. Same shape as round 5's models-dev.ts restoration.
- **recording-cost-report.ts (+1 inline, correct):** restores base's `https://models.dev/api.json` (base 4f59fcb666, unmarked; upstream a105350812 has `models.opencode.ai/api.json`). The file was **byte-identical to upstream at the round-5 head** (verified `git diff --quiet a105350812..4bb1c2a45b`) and now diverges by exactly the one marked line. Marker owed and correctly placed.
- **repository-cache.ts (+3, well-formed):** the new `match` canonicalization block (`fs.resolve` comparison for file remotes rewritten by Git on Windows) is wrapped in `// kilocode_change start - canonicalize file remotes rewritten by Git on Windows` / `end`; the `root &&` and `match,` lines inside `reuse` carry inline markers. Upstream diff confirms the entire marked region is genuine Kilo divergence (upstream uses a `worktree`-based comparison; none of the marked lines exist upstream). Start/end counts balanced (1/1); file total 5 markers.
- **kilo-commands.tsx (kilocode path):** the `/privacy` toggle rework (unset project-level `privacy_mode` when disabling) owes no marker under the kilocode-path exemption and adds none. Correct.
- **GitOps.ts (kilo-vscode path):** +2 `delete env.*` lines (`GIT_EXEC_PATH`, `PREFIX`), 0 markers as required for the forbidden path.

## Carried findings re-verification

All 9 carried files are **blob-identical between 4bb1c2a45b and 77246a52cb** (the fix commit touched none of them); targeted greps confirm the flagged content persists. All remain **OPEN, unchanged**:

| Finding | File | State at 77246a52cb | Evidence |
|---|---|---|---|
| R3-F3 | `packages/core/test/reference.test.ts` | OPEN, unchanged | 0 markers; upstream diff still the single deleted `import { LayerNode }` line |
| R2-N2 | `packages/opencode/test/cli/import.test.ts` | OPEN, unchanged | 0 markers; blob-identical to round-5 head |
| R2-N3 | `packages/protocol/src/groups/pty.ts` | OPEN, unchanged | 0 markers; `PTY_REPLAY_EXITED_QUERY` still at lines 12 (def) and 139 (allowlist) |
| R2-N4 | `packages/core/test/tool-read.test.ts` | OPEN, unchanged | 0 markers; blob-identical |
| R2-N4 | `packages/storybook/.storybook/main.ts` | OPEN, unchanged | 0 markers; blob-identical |
| R2-N4 | `packages/ui/src/components/tabs.css` | OPEN, unchanged | 0 markers; blob-identical |
| R1-F4 residual | `packages/ui/src/i18n/{en,da,br}.ts` | OPEN, unchanged | 7 markers each (as adjudicated); blobs identical → the four Kilo-only keys remain unmarked |
| V4-F1 | `packages/opencode/script/build.ts` | OPEN, unchanged | 47→47 markers; nested anonymous `start` blocks (lines 22/54/289) still present |
| V4-F1 | `packages/opencode/script/test-runner.ts` | OPEN, unchanged | 4→4 markers; blob-identical |

(V4-F1 paths corrected to the `packages/opencode/script/` location; round 5's shorthand `script/...` referred to the same files. Still an observation for human decision, no correctness risk.)

## New findings

**None.** Every fix-commit change is either genuine marked divergence in a shared file or correctly unmarked in a marker-exempt/forbidden path; the one convention question outstanding from round 5 (marked-restore inversion) was resolved in the recommended direction.

## Notable non-findings

- The two `models.dev` URL restores (vite.config.ts, recording-cost-report.ts) mirror round 5's models-dev.ts restoration: all three were base-branch-deliberate defaults flipped by the merge, now restored with owed markers. Product intent (which endpoint serves Kilo today) remains the config-regression review's domain, not marker hygiene.
- Forbidden-path check by construction: the fix commit's only kilo-vscode/kilo-ui touch is GitOps.ts (0 markers); no new `kilocode_change` can have entered the forbidden paths via this delta.

## Limitations

- **Full-PR sweep skipped this round** (per light-round scope): no recomputation of the 422-file base-vs-head counts, block-balance sweep, or zero-marker divergence sweep at 77246a52cb. The fix commit touches 6 files, all individually audited above; sweep-level drift beyond these files is not expected but not verified.
- Carried findings were re-verified via blob-identity between heads plus spot greps, not full re-derivation of their upstream-diff shapes (unchanged since round 5 by construction).
- `reset-to-upstream.ts --dry-run` was not re-run; diff-viewer's exit from the `markers-only` bucket is inferred from byte-identity to upstream, not from a fresh scan.
