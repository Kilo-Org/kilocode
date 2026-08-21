# Unnecessary `kilocode_change` Markers — V2

## Scope And Method

Audited PR #12901 at the NEW exact reviewed head `cbbbd7217f940b59b1b29964264536c567065327`, merge base `b135b4e10a9028983497bf69cded47b6ce4572ff`, pristine upstream v1.18.0 `32696c425fc0fa1ec285389346cfa1fbe22b670a`, and delta `c69ce6caf638617169509f09e3f5d620eb702146..cbbbd7217f940b59b1b29964264536c567065327` (commits `25f4b58d93` + `cbbbd7217f`, 49 files). Worktree HEAD is docs-only commit `c5b1427314` on top of the reviewed head; `git diff cbbbd7217f..HEAD -- packages/ script/` is empty, so working-tree-based tools measure the reviewed head exactly. The PR now changes 270 files (`git diff --name-only b135b4e10a...cbbbd7217f`).

I re-ran the required repository-wide finder with `--dry-run`, and when it hung after classification exactly as in v1, used the same scoped fallback: `classifyDrift()` imported from `script/upstream/utils/reset.ts` against upstream `32696c425f` with review limit 5 over the intersection of PR-changed files, files containing `kilocode_change` at the reviewed head, and shared paths (excluding `packages/kilo-*`, `**/kilocode/**`, `script/upstream`, and any `*kilocode*` path). Every intersection candidate and new marked file was cross-checked with `find-reset-candidates.ts <file> --dry-run`, `reset-to-upstream.ts <file> --dry-run`, and independent upstream/head diffs. No real reset or source edit was performed.

## V1 Finding Status

### P3 (`packages/opencode/test/account/service.test.ts:39`) — FIXED

The delta (commit `25f4b58d93`) removed exactly the stale trailing marker. The file is now byte-identical to pristine upstream v1.18.0, which is stronger than the required "matches transformed upstream":

```text
$ git grep -n "kilocode_change" cbbbd7217f -- packages/opencode/test/account/service.test.ts
(no matches; exit 1)
$ git rev-parse 32696c425f:packages/opencode/test/account/service.test.ts cbbbd7217f:packages/opencode/test/account/service.test.ts
672d54971623a641a55cba7d5e9007a450b25a67
672d54971623a641a55cba7d5e9007a450b25a67
$ git diff --numstat 32696c425f..cbbbd7217f -- packages/opencode/test/account/service.test.ts
(empty)
$ bun run script/upstream/find-reset-candidates.ts packages/opencode/test/account/service.test.ts --dry-run
[OK] No code files differ from upstream in scope. Nothing to do.
```

The file dropped out of the PR∩marker set entirely (v1: 79 marked shared files → v2: 80, of which the transition is −`service.test.ts`, +`.github/workflows/test.yml`, +`script/check-test-ci.ts`).

## Scoped Candidate Flow At The New Head

Full-scan dry-run (documented, then fallback used):

```text
$ bun run script/upstream/find-reset-candidates.ts --dry-run
[OK] Last merged upstream: v1.18.0 (32696c42)
[INFO] Scope: (all shared paths)
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 341 non-code asset(s)
[INFO] Skipping 2020 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 1238
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 384 (missing or too-large)
[INFO] Classifying 854 file(s)...
[INFO] Classified 854/854
(no final bucket report; still silent at 10m14s elapsed — process stopped)
```

Scoped `classifyDrift()` fallback over the new PR∩marker intersection (same import and review limit as v1):

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

`markers-only` is now 0 (v1: 1 — the fixed finding); `cosmetic-only` remains 0. The six `small-diff` files and counts are identical to v1, the delta did not touch them (`git diff c69ce6caf6..cbbbd7217f -- <six files>` empty), and all six still report `[DRY-RUN] Would reset <path> to transformed upstream v1.18.0` from `reset-to-upstream.ts --dry-run`. Independent upstream/head diffs at the new head confirm real Kilo deltas, so a real bulk reset would still be wrong: `runtime-flags.ts` keeps Kilo-only flags (`disableChannelDb` with marker, `KILO_*` env renames) and `compaction.ts` keeps the marked `include` compatibility field. Verdict unchanged from v1: not unnecessary markers.

Two files entered the marked shared set; both are non-candidates, verified with per-file finder dry-runs:

```text
$ bun run script/upstream/find-reset-candidates.ts .github/workflows/test.yml --dry-run
| large-diff | 1 | skipped |   (240 lines)
$ bun run script/upstream/find-reset-candidates.ts script/check-test-ci.ts --dry-run
| upstream-missing | 1 | skipped |
```

No new unnecessary-marker findings in the intersection.

## Task 2: 20 i18n `Kilo Go` Markers And The transform-i18n Change

The delta adds exactly one `// kilocode_change` per file across all 20 `packages/ui/src/i18n/*.ts` files (41 total delta-added marker lines repo-wide; 20 are these), each on the `dialog.usageExceeded.freeTier.description` line, and changes nothing else in those lines:

```text
-    "Subscribe to Kilo Go for reliable access to the best open-source models, starting at $5/month.",
+    "Subscribe to Kilo Go for reliable access to the best open-source models, starting at $5/month.", // kilocode_change
```

**All 20 markers are on genuinely Kilo-differing lines — legitimate, not unnecessary.** For the 18 locales that exist upstream, upstream's corresponding line is the same translation with `OpenCode Go` where head has `Kilo Go` (verified per file against `32696c425f`; e.g. en `"Subscribe to OpenCode Go ..."`, pl `"Subskrybuj OpenCode Go ..."`, zh `"订阅 OpenCode Go，..."`). `it.ts` and `nl.ts` do not exist upstream at all (`git cat-file -e` fails; both were already in v1's `upstream-missing` bucket with other markers), so their marked `Kilo Go` lines are Kilo-only lines in Kilo-only locale files — consistent with the set.

**transform-i18n.ts vs future resets.** The delta changes `transformI18nContent` to append ` // kilocode_change` to every line it modifies (`transform-i18n.ts:203-204`), and the new `transform-i18n.test.ts` asserts this intentionally. Two distinct behaviors result:

1. In the merge-conflict path (`transformConflictedI18n` runs the transform on raw upstream text), the transform now intentionally re-adds markers on branded lines. Additionally, that path already flags any file whose OURS version has markers for manual resolution (`transform-i18n.ts:302-306`), so all 20 now-marked files will be flagged manual in future i18n conflicts rather than auto-transformed.
2. In the `translate()` pipeline used by `classifyDrift`/`resetFile`, `applyBrandingTransforms` runs BEFORE `transformI18nContent` and pre-empts the `OpenCode`→`Kilo` replacement, leaving the i18n patterns nothing to replace on those lines — so translated upstream does NOT carry the appended marker. Probe evidence:

```text
packages/ui/src/i18n/en.ts translated-upstream Kilo-Go line:
  "Subscribe to Kilo Go for reliable access to the best open-source models, starting at $5/month.",
packages/ui/src/i18n/en.ts head Kilo-Go line:
  "Subscribe to Kilo Go for reliable access to the best open-source models, starting at $5/month.", // kilocode_change
(same shape for pl.ts and zh.ts)
```

Consequences, verified by dry-run: `reset-to-upstream.ts packages/ui/src/i18n/en.ts --dry-run` reports `[DRY-RUN] Would reset ... to transformed upstream v1.18.0` — a real reset would strip the transform-added markers, i.e. reset-to-upstream DOES fight the transform's intent for these files. But `classifyDrift`'s `clean()` strips markers on both sides, so marker presence alone cannot create a bulk-reset candidate: all 18 upstream-existing i18n files classify `large-diff` today (e.g. `en.ts` = 20 cleaned diff lines via per-file finder) and `it.ts`/`nl.ts` are `upstream-missing`; none are reset candidates now. The fight only materializes if the real deltas shrink to ≤5 cleaned lines in a future release, at which point a bulk auto-apply would strip markers the next conflicted-merge transform re-adds — future churn risk to be aware of, not a current incorrectness.

**Extended blast radius of the translate() change.** Because `translate()` runs `transformI18nContent` on every shared file, v2 also appends markers to lines containing `opencode dev|serve|auth` — the three command patterns covered only by the i18n transform, not by `applyBrandingTransforms` (probe: translated `packages/web/src/content/docs/cli.mdx` line is now `kilo auth [command] // kilocode_change`). I classified all 107 upstream shared files containing those strings at the reviewed head: `92 local-missing`, `13 large-diff`, `2 small-diff`, and zero `markers-only`/`identical` flips. The two small-diff files (`packages/opencode/test/cli/serve/serve-process.test.ts` (4), `packages/opencode/test/session/llm-native.test.ts` (2)) are raw-identical to upstream (`git diff 32696c425f..cbbbd7217f` empty for both), not PR-changed, and marker-free at head — their small-diff bucket comes from the branding transform alone and is unchanged from v1 because `clean()` is marker-insensitive. They sit outside the PR∩marker scope, but note that a future full-scan bulk reset would rewrite them to translated upstream, which now also injects markers into them.

## Task 3: New Markers Introduced In The Delta

All 41 delta-added marker lines were enumerated; the non-i18n, non-Kilo-owned ones are all on real Kilo deltas vs upstream, not upstream-identical code:

- `packages/opencode/src/provider/transform.ts` (4 added): the `kilocode_change start - Kimi Anthropic endpoints require adaptive thinking summaries...` block wraps `isKimiFamily(model)` and the `anthropicEffort` early-return — entirely Kilo-added code (upstream has no `isKimiFamily`; the upstream/head diff shows the whole function plus Kilo's `anthropicClaude5` rewrite). Real delta.
- `packages/opencode/src/session/tools.ts` (2 added): the delta hoists the existing marked `const restricted = yield* SandboxPolicy.networkRestricted(input.session.id)` earlier and adds `networkRestricted: restricted, // kilocode_change - let the registry suppress code-mode in restricted sessions`. `SandboxPolicy` is `@/kilocode/sandbox/policy` — Kilo-only module; upstream lacks both lines. Real delta.
- `packages/opencode/src/tool/registry.ts` (3 added): `networkRestricted?: boolean` params and `if (input.networkRestricted) return` — same Kilo-only feature. Real delta.
- `packages/opencode/src/tool/code-mode.ts` (2 added): `bridge.run(SandboxPolicy.networkRestricted(ctx.sessionID))` and the `restricted ? {} : Permission.visibleTools(...)` gate — Kilo-only. Real delta.
- `packages/opencode/test/tool/registry.test.ts` (4 added): block markers around the restricted-session execute-catalog suppression tests; the file has a 273-line upstream/head diff. Real delta.
- `packages/opencode/test/tool/code-mode.test.ts` (1 changed): the existing block marker's description was updated to `code-mode must not advertise remote MCP tools in a network-restricted sandbox`, wrapping the new `SandboxNetwork.remote` test (75-line upstream diff). Real delta.
- `packages/opencode/test/tool/code-mode-integration.test.ts` (1 added, beyond the assigned list): modifies an already-marked `TestConfig.layer()` line to inject sandbox-deny config, marker retained (23-line upstream diff). Real delta.
- `script/check-test-ci.ts` (1): new Kilo-only script, `upstream-missing`; marker consistent with repo practice for Kilo files in shared paths.
- `script/upstream/transforms/transform-i18n.ts` + its test (3): Kilo-owned path, exempt from marking rules.

No unnecessary new markers found in the delta.

## Notable Non-Findings

- Zero `markers-only` and zero `cosmetic-only` candidates in the PR∩marker intersection at the new head (v1's single `markers-only` was the fixed P3).
- The six `small-diff` candidates are byte-stable between the two heads and remain real Kilo deltas per independent diff review; none became unnecessary.
- `.github/workflows/test.yml` (new to the marked set) is `large-diff (240)` — real workflow divergence, not a marker issue.
- The 20 i18n markers are individually legitimate and currently reset-inert (all `large-diff`/`upstream-missing`); the only forward concern is the transform/reset target mismatch documented above, which is intentional on the transform side.
- No previously-`identical` shared file flipped to `markers-only` because of the transform change (0 of 107 command-string files).

## Limitations

- The full finder again never emitted a global bucket report: it reached `Classified 854/854` and then hung silently past 10m14s (same post-classification stall as v1, which timed out at 600s). The `854/854` progress line is not completion proof; no repo-wide bucket totals were inferred from it. The completed evidence is the scoped PR∩marker fallback plus bounded targeted probes.
- The scoped fallback covers PR-changed marker-bearing shared files only, matching the assigned intersection; it does not classify the full 1238-file candidate set. The 107-file `opencode dev|serve|auth` probe is a bounded supplement, not a substitute for the full scan.
- `it.ts`/`nl.ts` cannot be compared line-for-line to upstream (files absent there); marker legitimacy rests on file-level upstream absence and consistency with the branded set.
- Bucket continuity for files outside the PR intersection (e.g. `serve-process.test.ts` between v1 and v2) is inferred from `clean()`'s documented marker-stripping, not from a completed v1 full scan.
- Only `UNNECESSARY_MARKERS_V2.md` was authored. No real reset, source edit, commit, push, or GitHub mutation occurred; v1 reports and other agents' V2 files were not read or modified.
