# Unnecessary `kilocode_change` Markers — V3

## Scope And Method

Delta-focused re-review of PR #12901 covering the full round-3 range `cbbbd7217f..3003a302bc` in two increments. Round-3 reviewed head is now `3003a302bc65a4ce0df7c544303c0898db5406e3`, verified direct child of `af6d1ded6d0c42f31b2cea2b84e478f6ac10445a` (`git rev-parse 3003a302bc^` = `af6d1ded6d`), which is itself the verified direct child of v2 head `cbbbd7217f940b59b1b29964264536c567065327`. Merge base `b135b4e10a9028983497bf69cded47b6ce4572ff`, pristine upstream v1.18.0 `32696c425fc0fa1ec285389346cfa1fbe22b670a`. Worktree HEAD is docs-only `6f676b6dbb`; `git diff 3003a302bc..HEAD -- packages/ script/ .github/` is empty (HEAD adds 14 root report `.md` files only), so working-tree tools measure the reviewed head exactly. Part 1 reviews the first increment (`cbbbd7217f..af6d1ded6d`, 8 files); Part 2 reviews the newly landed increment (`af6d1ded6d..3003a302bc`, 14 files). `UNNECESSARY_MARKERS_V2.md` was read first; v2's method was reused (same `classifyDrift()` import from `script/upstream/utils/reset.ts`, same review limit 5, same PR∩marker∩shared intersection). The known-hanging full finder was re-run for Part 2 and hung again identically (documented below), so the scoped method remains the primary evidence. Dry-run only; no real reset, no source edits.

# Part 1: `af6d1ded6d` Increment (8-File Delta)

Reviewed when `af6d1ded6d` was the round-3 head, against the pre-rebase local checkout `6d6c4eb730` (superseded by `6f676b6dbb` after rebase). `6d6c4eb730` is still present locally and `git diff af6d1ded6d..6d6c4eb730 -- packages/ script/ .github/` is empty (re-verified), so Part 1's working-tree measurements of the `af6d1ded6d` head remain exact. All Part 1 conclusions were re-validated against the new head in Part 2's scoped classification.

## Task 1: Marker Audit Of The 8-File Delta

Per-file marker counts (`git grep -c kilocode_change <head> -- <file>`) are identical at both heads for all 8 files; every changed line sits inside pre-existing marked regions or in marker-exempt paths:

- `packages/opencode/src/provider/transform.ts` (59=59): the null-guard fix changes exactly 2 lines — `id?.toLowerCase() ?? ""` and `model.api.url?.toLowerCase() ?? ""` — both inside the existing `// kilocode_change start` (L1313) / `// kilocode_change end` (L1325) block wrapping `isKimiFamily`. The `end` marker is trailing context in the delta hunk itself; the block was not broadened and no marker lines moved. Upstream has zero `isKimiFamily` occurrences (`git show 32696c425f:...transform.ts | grep -c isKimiFamily` → 0), so the guarded code is entirely Kilo-added — real Kilo delta.
- `script/check-test-ci.ts` (1=1): `// kilocode_change - new file` at line 1 is untouched; the 15-line change's first hunk starts at line 2. Marker still accurate: the file remains `upstream-missing` at the new head (per-file finder dry-run below).
- `.github/workflows/test.yml` (49=49): the new `Run root tooling unit tests` step lands inside the existing `# kilocode_change start - test non-CLI packages separately from sharded CLI tests` block (L144–L158, verified by viewing the head blob); the two junit `report_paths`/`path` edits land inside the existing L177–L201 block. No markers added, removed, or relocated.
- `script/upstream/transforms/transform-package-json.ts` (4=4): delta adds `"test:script:ci"` to `PRESERVE_SCRIPTS` only; the 4 `kilocode_change` occurrences are pre-existing comment/warn strings about marker handling (L485, L487, L920, L930), not markers. Kilo-owned path (`script/upstream/`), exempt regardless.
- `package.json`, `packages/sdk-next/package.json` (0=0): JSON, no markers possible; script/timeout edits only.
- `packages/opencode/test/kilocode/provider/kimi-adaptive-effort.test.ts` (0=0) and `script/upstream/transforms/transform-package-json.test.ts` (0=0): `/kilocode/` and `script/upstream/` paths — marker-exempt.

No new markers on upstream-identical code anywhere in the delta.

## Task 2: Scoped Classification At The af6d1ded6d Head

Same scoped fallback as v2, HEAD bumped to `af6d1ded6d` (probe script mirrored v2's exactly otherwise):

```text
PR_CHANGED=270
MARKED_SHARED=80
BUCKET small-diff=6
  CANDIDATE packages/codemode/tsconfig.json (4)
  CANDIDATE packages/core/src/session/compaction.ts (1)
  CANDIDATE packages/core/src/session/runner/llm.ts (4)
  CANDIDATE packages/opencode/src/effect/runtime-flags.ts (5)
  CANDIDATE packages/tui/src/ui/dialog.tsx (2)
  CANDIDATE packages/ui/src/styles/theme.css (4)
BUCKET large-diff=69
BUCKET upstream-missing=5
```

`markers-only`=0 and `cosmetic-only`=0 (buckets absent from output = empty), matching v2. Bucket counts and the six small-diff files with their line counts are byte-identical to v2. The marked set itself was unchanged at `af6d1ded6d`: a rebuilt 80-file list `diff`ed empty against v2's saved `marked-v2.txt` (`MARKED_SET_IDENTICAL`). No transitions: `check-test-ci.ts` kept its marker and stays in the set; the six small-diff files were untouched by that delta (`git diff cbbbd7217f..af6d1ded6d -- <six files>` empty).

Per-file finder dry-runs for the delta's in-set files:

```text
$ bun run script/upstream/find-reset-candidates.ts packages/opencode/src/provider/transform.ts --dry-run
| large-diff | 1 | skipped |   (149 lines)
$ bun run script/upstream/find-reset-candidates.ts script/check-test-ci.ts --dry-run
| upstream-missing | 1 | skipped |
$ bun run script/upstream/find-reset-candidates.ts .github/workflows/test.yml --dry-run
| large-diff | 1 | skipped |   (246 lines)
```

`test.yml`'s cleaned diff grew 240 → 246 lines (the delta's added step and multi-line junit lists) — still `large-diff`, still a non-candidate; a size change within a bucket, not a transition.

## Task 3: transform.ts Null-Guard And Reset Candidacy

No candidacy change. `transform.ts` was and remains `large-diff` (149 cleaned non-marker lines at review limit 5) — far above the reset threshold before and after the guard. The guard edits 2 lines inside an already Kilo-only function, so the file is a real Kilo delta either way; marker necessity is unaffected. Repo-wide confirmation: the bucket profile at `af6d1ded6d` was identical to v2, so no file's classification moved because of that delta.

## Part 1 Findings

None. Zero unnecessary markers in the 8-file delta; zero `markers-only`/`cosmetic-only` candidates in the PR∩marker set at the `af6d1ded6d` head.

## Part 1 Notable Non-Findings

- All 8 delta files have identical marker counts at the v2 and `af6d1ded6d` heads; all changed lines are inside pre-existing marked blocks or in marker-exempt paths.
- The null-guard did not broaden the `isKimiFamily` block (`start` L1313 / `end` L1325 unchanged) and did not alter reset candidacy (`large-diff (149)` both rounds).
- `check-test-ci.ts`'s new-file marker survived the 15-line change untouched and remains truthful (`upstream-missing`).
- The scoped classification at `af6d1ded6d` was byte-identical to v2 (270/80, same six small-diff candidates, 69 large-diff, 5 upstream-missing) — the delta introduced no marker drift.
- `test.yml` 240→246 cleaned lines is intra-bucket growth, not a bucket transition.

# Part 2: `3003a302bc` Increment (14-File Delta)

Reviewed at the current round-3 head `3003a302bc65a4ce0df7c544303c0898db5406e3` (delta `af6d1ded6d..3003a302bc`, 14 files, +236/-94: `bun.lock`, `package.json`, `packages/opencode/package.json`, `packages/tui/package.json`, `packages/tui/src/component/register-spinner.ts`, `packages/tui/src/ui/spinner.ts`, `packages/tui/test/kilocode/spinner-runtime.test.ts`, `packages/ui/src/i18n/it.ts`, `packages/ui/src/i18n/nl.ts`, `script/upstream/transforms/transform-i18n.{ts,test.ts}`, `script/upstream/transforms/transform-package-json.{ts,test.ts}`, `script/upstream/utils/upstream.ts`).

## Task 1: Marker Audit Of The 14-File Delta

Marker counts at both heads (`git grep -c kilocode_change <head> -- <file>`) and upstream comparison for every shared-path delta file:

- `packages/tui/src/component/register-spinner.ts` (0→2 markers): was **byte-identical to upstream** at `af6d1ded6d` (`diff <(git show 32696c425f:...) <(git show af6d1ded6d:...)` → IDENTICAL) and carried no markers — correct then. The delta replaces the 6-line `opentui-spinner/solid` registration with a 139-line local `SpinnerRenderable` against Kilo's active OpenTUI runtime, wrapped in a new `// kilocode_change start - register against Kilo's active OpenTUI runtime instead of opentui-spinner's nested 0.3 runtime` / `end` block. Markers wrap a real, large Kilo delta — necessary, not unnecessary.
- `packages/tui/src/ui/spinner.ts` (0→2 markers): also **byte-identical to upstream** at `af6d1ded6d`, marker-free then. The full head-vs-upstream diff is exactly one hunk: upstream's `import type { ColorGenerator } from "opentui-spinner"` replaced by a blank line plus the marked block (`start` / `export type ColorGenerator = ...` / `end`). The remaining diff is NOT only marker comments — it contains a real functional line (the local type) whose upstream import source was deleted from `package.json`/`bun.lock` in the same commit. Markers wrap exactly the delta — necessary.
- `packages/ui/src/i18n/it.ts` (6=6), `packages/ui/src/i18n/nl.ts` (10=10): both files are **upstream-missing** (upstream v1.18.0 ships 18 locales under `packages/ui/src/i18n/`, no `it.ts`/`nl.ts`) and carry `// kilocode_change - new file` at line 1 plus pre-existing inline markers on Kilo-only lines (Kilo Go, SWE-Pruner, deleteQueued, question.dismissed; counts unchanged by the delta). The 40 changed lines per file translate Kilo-only keys (`ui.sessionReviewV2.*`, `ui.lineComment.cancel`, `ui.sessionTurn.diffs.changed.one/other`, `ui.common.showMore`) from English placeholders into Italian/Dutch. No markers added or removed; per-line markers are not required inside an entirely Kilo-owned file, so the translations being unmarked is consistent. No unmarked drift in upstream-existing files is involved because the files do not exist upstream at all.
- `packages/tui/test/kilocode/spinner-runtime.test.ts` (0, new file): `/kilocode/` path — marker-exempt.
- `bun.lock`, `package.json`, `packages/opencode/package.json`, `packages/tui/package.json` (0=0): JSON/lockfile, no markers possible. The `opentui-spinner` removal (plus its nested `@opentui/*` 0.3 runtime, `cli-spinners` 3.4.0, `yoga-layout`) leaves unmarkable JSON drift vs upstream that is now covered by the updated transform (Task 3), so no marker solution is needed or possible.
- `script/upstream/transforms/transform-i18n.ts` (9=9), `transform-package-json.ts` (4=4), `transform-i18n.test.ts`, `transform-package-json.test.ts`, `script/upstream/utils/upstream.ts` (0=0): Kilo-owned path, marker-exempt; the counted occurrences are marker-handling string literals, not markers on upstream code.

All four added marker lines repo-wide (`git diff af6d1ded6d..3003a302bc | grep '^+.*kilocode_change'`) are the two `start`/`end` pairs above. **No file became byte-identical to upstream while carrying markers, and no file's remaining diff is marker-comments-only.**

## Task 2: Required Finder Runs And Scoped Classification At The New Head

Full repository finder, re-run as required (hang reproduced, matching v1/v2):

```text
$ bun run script/upstream/find-reset-candidates.ts --dry-run
[OK] Last merged upstream: v1.18.0 (32696c42)
[INFO] Scope: (all shared paths)
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 341 non-code asset(s)
[INFO] Skipping 2020 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 1247
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 391 (missing or too-large)
[INFO] Classifying 856 file(s)...
[INFO] Classified 856/856
(no final bucket report; still silent at 10m37s elapsed — process stopped)
```

Same post-classification stall as v1 (600s timeout) and v2 (10m14s); counts grew 1238→1247 candidates, 384→391 pre-bucketed, 854→856 classified. Scoped `classifyDrift()` fallback over the PR∩marker∩shared intersection at `3003a302bc` (same import and review limit 5):

```text
PR_CHANGED=273
INTERSECTION=82
BUCKET small-diff=7
  CANDIDATE packages/codemode/tsconfig.json (4)
  CANDIDATE packages/core/src/session/compaction.ts (1)
  CANDIDATE packages/core/src/session/runner/llm.ts (4)
  CANDIDATE packages/opencode/src/effect/runtime-flags.ts (5)
  CANDIDATE packages/tui/src/ui/dialog.tsx (2)
  CANDIDATE packages/tui/src/ui/spinner.ts (3)
  CANDIDATE packages/ui/src/styles/theme.css (4)
BUCKET large-diff=70
BUCKET upstream-missing=5
```

`markers-only`=0 and `cosmetic-only`=0. The intersection grew by exactly the two newly marked files — `comm` of the af6d1ded6d-era and current marked∩PR sets yields only `register-spinner.ts` (now `large-diff`) and `spinner.ts` (now `small-diff`); no file left the set, and the six pre-existing small-diff files are untouched by the delta (`git diff af6d1ded6d..3003a302bc -- <six files>` empty). (The raw string-match count `git grep -l kilocode_change <head> -- packages/ script/ .github/` is ~688–690 at all three heads — it includes docs/scripts mentioning the marker; the 80→82 figures are the PR∩marker∩shared intersection, consistent with Part 1.)

Per-file finder and reset dry-runs for the delta's shared files:

```text
$ bun run script/upstream/find-reset-candidates.ts packages/tui/src/component/register-spinner.ts --dry-run
| large-diff | 1 | skipped |   (137 lines)
$ bun run script/upstream/find-reset-candidates.ts packages/tui/src/ui/spinner.ts --dry-run
| small-diff | 1 | would reset |   (3 lines)
$ bun run script/upstream/find-reset-candidates.ts packages/ui/src/i18n/it.ts --dry-run
| upstream-missing | 1 | skipped |
$ bun run script/upstream/find-reset-candidates.ts packages/ui/src/i18n/nl.ts --dry-run
| upstream-missing | 1 | skipped |
$ bun run script/upstream/reset-to-upstream.ts packages/tui/src/ui/spinner.ts --dry-run
[INFO] [DRY-RUN] Would reset packages/tui/src/ui/spinner.ts to transformed upstream v1.18.0
$ bun run script/upstream/reset-to-upstream.ts packages/tui/src/component/register-spinner.ts --dry-run
[INFO] [DRY-RUN] Would reset packages/tui/src/component/register-spinner.ts to transformed upstream v1.18.0
```

## Task 3: Transform Behavior Changes — What Future Merges Auto-Generate

The delta deliberately changes auto-marking in two transforms (Kilo-owned `script/upstream/`, verified by reading the diff and probing `translate()` at the head):

1. **transform-i18n.ts** — `transformI18nContent` gains a `markers = false` parameter. The conflict path (`transformI18nFile`) passes `true`, so locale-file marking in merges is unchanged. `translate()` (used by `classifyDrift`/`resetFile`) now passes `isI18nFile(file)` (patterns `packages/*/src/i18n/*.ts`), so future merges auto-mark **fewer** lines than at v2: v2's `translate()` appended `// kilocode_change` to ANY shared file with i18n-pattern replacements (v2 documented e.g. a `packages/web/src/content/docs/cli.mdx` `kilo auth` line gaining a stray marker); that injection is gone. Probe at the head:

```text
=== en.ts translated:   "cmd": "run kilo serve here", // kilocode_change   (locale file: still marks)
=== cli.mdx translated: Run `kilo auth login` first                          (no marker; v2 appended one)
=== meta.txt translated: Kilo uses kilo serve                                (marker-free; asserted by new test)
```

Side effect for locale files: translated upstream now carries markers on i18n-transformed lines (e.g. command strings), aligning the reset target with what the conflict-path transform re-adds — this reduces the transform/reset fight v2 flagged for the 18 upstream-existing locales. `clean()` is marker-insensitive on both sides, so classifications are unaffected.

2. **transform-package-json.ts** — `opentui-spinner` added to `DELETE_UPSTREAM_CATALOG` and to a new `DELETE_UPSTREAM_DEPENDENCIES` set enforced by the now-exported `transformDependencies`; tests assert both. Future merges auto-remove the spinner dependency from catalog and dependency blocks, so the unmarkable JSON drift cannot silently regress.

3. Consequence verified by probe: a real reset of `spinner.ts` would write `import type { ColorGenerator } from "opentui-spinner"` back — the package this commit removes — see Findings.

## Part 2 Findings

- **P3 (flagged for human verification): `packages/tui/src/ui/spinner.ts` is a new `small-diff` reset candidate whose reset would break the build.** The file's markers are necessary and correct (they wrap the only real delta vs upstream), but it now classifies `small-diff (3)` → finder action `would reset`, and `reset-to-upstream.ts --dry-run` confirms it would be rewritten to transformed upstream, restoring `import type { ColorGenerator } from "opentui-spinner"` — a dependency removed from `package.json`/`bun.lock` in this same commit — leaving an unresolvable import. Same hazard pattern as v2's six stable small-diff candidates (documented there as "a real bulk reset would still be wrong"); the delta adds a seventh. Not an unnecessary-marker finding; a reset-tooling hazard to verify before any future bulk auto-reset (options: accept dry-run-only usage, or add the file to `keepOurs`/`skipFiles`).

## Part 2 Notable Non-Findings

- Zero unnecessary markers in the 14-file delta; both new marker blocks wrap real Kilo deltas (a 139-line runtime replacement; a type replacing a deleted dependency's import).
- No file became byte-identical to upstream while still carrying markers; no `markers-only`/`cosmetic-only` candidates in the PR∩marker set at `3003a302bc`.
- `register-spinner.ts` and `spinner.ts` were upstream-identical and marker-free at `af6d1ded6d` — no stale-marker case existed before the delta; markers arrived together with the deltas they describe.
- `it.ts`/`nl.ts` marker counts unchanged (6/10); both remain `upstream-missing` (skipped by the finder), so the 40-line translation rounds need no per-line markers and change no reset candidacy.
- The six v2 small-diff candidates are byte-stable through this delta; `test.yml` and `transform.ts` classifications unchanged (`large-diff`).
- The conditional-marking change eliminates v2's documented stray-marker blast radius on non-locale files (probe: `cli.mdx`, `meta.txt`) while keeping locale-file marking intact (probe: `en.ts`).

## Limitations

- The required full finder never emitted a global bucket report at this head either: it reached `Classified 856/856` and then hung silently past 10m37s (same post-classification stall as v1's 600s timeout and v2's 10m14s). The `856/856` progress line is not completion proof; no repo-wide bucket totals were inferred from it. Completed evidence is the scoped PR∩marker fallback, per-file finder/reset dry-runs, and targeted `translate()` probes.
- The scoped method covers PR-changed marker-bearing shared files only; files outside the PR intersection were not reclassified at `3003a302bc`.
- `it.ts`/`nl.ts` cannot be compared line-for-line to upstream (files absent there); marker sufficiency rests on file-level upstream absence plus the line-1 new-file marker.
- Working-tree-based commands measure the reviewed head only because the docs-only HEAD commits touch no code paths (verified empty diff at `6f676b6dbb`); if later docs commits add code changes this ceases to hold.
- Only `UNNECESSARY_MARKERS_V3.md` was authored/edited. No real reset, source edit, commit, push, or GitHub mutation occurred; v1/v2 reports and other agents' V3 files were not modified.
