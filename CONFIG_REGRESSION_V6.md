# Config Regression Review V6 — upstream opencode v1.18.13 merge (round 6, LIGHT)

- **Reviewed HEAD:** `77246a52cb` (= worktree `HEAD~5`; top 5 commits are report-only `.md` additions)
- **Previous:** `4bb1c2a45b` — 5 clean rounds, 0 findings (see `CONFIG_REGRESSION_V5.md`)
- **Delta under scrutiny:** `git diff 4bb1c2a45b..77246a52cb` — single commit `77246a52cb` "fix(core): address round 5 review findings", 6 files (+29/−12): `packages/core/src/repository-cache.ts`, `packages/kilo-vscode/src/agent-manager/GitOps.ts`, `packages/llm/script/recording-cost-report.ts`, `packages/opencode/src/kilocode/kilo-commands.tsx`, `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx`, `packages/ui/vite.config.ts`
- **PR base:** `4f59fcb666`; upstream v1.18.13 = `a105350812`
- **Question (unchanged):** does this delta (re)introduce `opencode` config fallback or break `.kilo`-only config lookup?

## Scope (LIGHT round)

Per assignment: quick diff read of the 6 delta files for config-path relevance, structural spot-checks only, no full grep sweep, no test runs.

## Verification results

### 1. Delta files — config-path relevance

| File | Delta content | Config-path verdict |
|---|---|---|
| `packages/core/src/repository-cache.ts` | Restores `fs.resolve` canonicalization when comparing file-protocol git remotes (`kilocode_change start/end` block); cache reuse match logic only | Cache lives under `Global.Path.cache` (kilo-rooted via `app = "kilo"`). Delta changes remote-URL equality semantics, not cache/config directory locations. No opencode-path read. |
| `packages/kilo-vscode/src/agent-manager/GitOps.ts` | `nonInteractiveEnv()` additionally deletes `GIT_EXEC_PATH` and `PREFIX` | Same class as round 5: scrubs **git's own** env vars for subprocess hermeticity. No kilo/opencode config path touched. |
| `packages/llm/script/recording-cost-report.ts` | `https://models.opencode.ai/api.json` → `https://models.dev/api.json` (`kilocode_change`) | Dev script URL constant, consistent with round-5 `models-dev.ts` fix. No config paths. |
| `packages/opencode/src/kilocode/kilo-commands.tsx` | `/privacy` command: when disabling, additionally issues `config.overlayUpdate({scope: "project", unset: ["privacy_mode"]})` alongside the global set | Goes through the SDK overlay API (server-side writer chain verified kilo-only in V4/V5 — `kilocode/config/overlay.ts` + `writer.ts`, untouched by this delta). No direct file-path access in the delta; **no `.kilo/command` discovery logic touched** (the file contains no command-directory path code; hits for "kilo" are `sdk.client.kilo.*` API calls and `app.kilo.ai` URLs). File is in `src/kilocode/` — Kilo-owned, marker-exempt. |
| `packages/tui/test/cli/tui/diff-viewer-file-tree.test.tsx` | Removes the `kilocode_change start/end` marker pair around two restored upstream assertions (assertions themselves unchanged) | Test-only. Marker removal in a test file under `packages/tui/test/` — annotation-check coverage is for `packages/opencode/`; no config access. |
| `packages/ui/vite.config.ts` | `KILO_MODELS_URL \|\| "https://models.opencode.ai"` → `\|\| "https://models.dev"` (`kilocode_change`) | Build-time provider-icon fetch URL, consistent with round-5 fix. `KILO_MODELS_URL` override retained. No config discovery. |

### 2. Structural spot-checks (at `77246a52cb`)

- `packages/core/src/global.ts:12` — `const app = "kilo" // kilocode_change` — **intact** (no `packages/opencode/src/global/index.ts`; `Global.Path` lives in `packages/core/src/global.ts`).
- `packages/opencode/src/config/paths.ts:29,35` — `targets: [".kilocode", ".kilo"] // kilocode_change` — **intact**, kilo-only directory candidates, no reordering.
- `git diff 4bb1c2a45b..77246a52cb -- config/config.ts config/paths.ts config/managed.ts core/src/global.ts` — **empty (0 lines)**: all structural config files untouched by the delta.
- `config.ts` `.kilo`-token hits (lines 335-336, 375, 395, 610) are `https://app.kilo.ai/config.json` `$schema` URLs — unchanged, expected.
- No `.opencode` / `opencode.json` tokens added anywhere in the delta (grep over all 6 files: only pre-existing `sdk.client.kilo.*` / `app.kilo.ai` hits in kilo-commands.tsx, none path-related).

## New findings

**None — 0 config regressions at `77246a52cb`.** The delta adds no opencode-path reads, no config candidate-list or ordering changes, and leaves every structural config file byte-identical to the 5×-clean `4bb1c2a45b`.

## Limitations

- LIGHT round: the full prescribed grep sweep (`opencode.json|.opencode|config/opencode|OPENCODE_CONFIG` over the three runtime trees) was **not re-run**; last full sweep was V5 (60 hits/30 files, all classified, 0 findings). The delta touches none of the 30 sweep-hit files except `kilo-commands.tsx` (Kilo-owned, verified above).
- Tests **not run** this round; V5 evidence stands: 113 pass / 2 skip / 0 fail across `test/kilocode/config/`, `config-overlay.test.ts`, `shell-env.test.ts` at `4bb1c2a45b`. No delta file is covered by those suites except indirectly (kilo-commands.tsx overlay calls rely on the server writer chain whose tests passed in V5).
- The `diff-viewer-file-tree.test.tsx` marker removal is noted for the annotations track: file is outside `packages/opencode/`, so `check-opencode-annotations.ts` does not govern it; judged intentional (assertions now byte-match upstream, so no marker needed).
