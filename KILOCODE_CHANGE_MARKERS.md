# KILOCODE_CHANGE_MARKERS.md — PR #10790 (OpenCode v1.14.42 upstream merge)

## Methodology

The review branch `review/pr-10790-reviews` is identical to its base `trial/kilo-opencode-v1.14.42` (`git diff trial...HEAD` is empty), so the PR diff is effectively `origin/main...HEAD`. For each **modified** (non-new) shared file in scope, I:

1. Counted `kilocode_change` markers in `HEAD` vs `origin/main` with `git grep -c`.
2. Confirmed each file's existence in `origin/main` (so the counts are real before/after comparisons, not artifacts of the v1.14.42 directory restructure).
3. Inspected `git diff origin/main...HEAD -- <file>` for any removed (`-`) marker lines or relocations.

**Files checked:** 12 modified shared files. `packages/llm/` and `packages/http-recorder/` are entirely new (no prior markers to lose) and were skipped. `packages/kilo-*` paths are Kilo-owned and out of scope.

Marker counts (HEAD vs main): `test.yml` 9/9, `flag.ts` 3/3, `global.ts` 15/14, `global.test.ts` 1/0, `effect-flock.test.ts` 3/0, `flock.test.ts` 4/0, `cross-spawn-spawner.test.ts` 0/0, and `.gitignore`/`.opencode-version`/`.opencode/tui.json`/`.opencode/plugins/tui-smoke.tsx`/`package.json` 0/0.

## Findings

**No markers were removed in any in-scope file.** All marker-count deltas are additions:

- `packages/core/src/global.ts` (14 → 15): the new `repos` path adds one annotated line `ensureRealDir(Path.repos) // kilocode_change`. Existing markers are intact.
- `packages/core/test/global.test.ts` (0 → 1): adds `kilocode_change` annotating the `kilo` tmp dir assertion (was `opencode`). Correct Kilo behavior.
- `packages/core/test/util/flock.test.ts` (0 → 4) and `effect-flock.test.ts` (0 → 3): add a wrapped `kilocode_change start/end` block making worker finalization await process `close` (Windows race fix) plus inline markers. Purely additive Kilo hardening.
- `packages/core/src/flag/flag.ts` (3/3): the diff removes the `KILO_EXPERIMENTAL_HTTPAPI` flag and its `HTTPAPI_DEFAULT_ON_CHANNELS` helper, but **those lines carried no `kilocode_change` marker**, so no marker was lost. The 3 existing markers are unchanged.

## ⚠️ Out-of-scope observation (flagged for awareness)

The full `origin/main...HEAD` diff shows a large number of removed `kilocode_change` lines, but they all reside in **`packages/opencode/**`** files (e.g. `session/prompt.ts` ~34, `server/routes/instance/experimental.ts` ~21, `cli/cmd/run.ts` ~10, plus many server route and TUI files) — none of which are in this task's stated file list. These removals correspond to the v1.14.42 restructure (opencode being split into `packages/core` / `packages/llm` etc.) and need a separate review to confirm each marker was relocated rather than genuinely dropped. They are **not** part of the scoped files reviewed here.

## No findings (clean)

- `.github/workflows/test.yml` — markers unchanged (9/9); only adds an `HttpApi exerciser gates` step.
- `.gitignore` — adds `.env.local`; no markers.
- `.opencode-version` — version bump `v1.14.41 → v1.14.42`; no markers.
- `.opencode/tui.json` — plugin config simplified; no markers.
- `.opencode/plugins/tui-smoke.tsx` — opentui keymap API migration; no markers.
- `package.json` — opentui bump to `0.2.6`, `test:ci` script replaced by `upgrade-opentui`; no markers.
- `packages/core/test/effect/cross-spawn-spawner.test.ts` — cwd realpath normalization only; no markers.
