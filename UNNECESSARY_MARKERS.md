# Unnecessary `kilocode_change` Markers

## Scope And Method

Audited PR #12901 at exact head `c69ce6caf638617169509f09e3f5d620eb702146`, merge base `b135b4e10a9028983497bf69cded47b6ce4572ff`, and pristine upstream v1.18.0 commit `32696c425fc0fa1ec285389346cfa1fbe22b670a`. `HEAD` and `origin/johnnyeric/kilo-opencode-v1.18.0` both resolved to the requested head, `git merge-base` returned the supplied base, `v1.18.0^{commit}` resolved to the supplied upstream commit, and that commit is an ancestor of the head.

The PR changes 262 files (`93 A`, `167 M`, `2 D`; 169,695 insertions and 70,035 deletions). The exact PR diff contains 79 marker-bearing shared files after excluding Kilo-owned paths; 51 changed files are under `packages/opencode/`, of which 36 shared files contain `kilocode_change`. I ran the required repository-wide finder with `--dry-run`, intersected the exact PR files, fell back to the repository's own `classifyDrift()` implementation against the explicit upstream SHA when the full scan timed out, ran supported per-file finder dry runs for every resettable intersection result, ran `reset-to-upstream.ts --dry-run` for each, and independently inspected upstream/head diffs. No real reset or source edit was performed.

## Finding

### P3: stale marker on an upstream-identical test helper

- Path/marker: `packages/opencode/test/account/service.test.ts:39`, trailing `// kilocode_change` on `LayerNode.compile(Account.node, ...)`.
- Exact comparison: upstream and head differ by one removed and one added line, solely because head appends that marker. Upstream blob `672d54971623a641a55cba7d5e9007a450b25a67` and head blob `26e7a7a7b354238461de8b80a7ad100bd1fc0782` become byte-identical after the repository marker cleaner runs (`CLEAN_EQUAL=true`).
- Classifier/reset evidence: `find-reset-candidates.ts <file> --dry-run` reports `markers-only | 1 | would reset`; `reset-to-upstream.ts <file> --dry-run` reports `[DRY-RUN] Would reset packages/opencode/test/account/service.test.ts to transformed upstream v1.18.0`.
- Provenance: merge base line 39 already had the marker; pristine v1.18.0 now has the same unmarked expression. This is stale Kilo divergence exposed by the upstream merge, not behavior authored at the new head.
- Impact and fix: behavior is unchanged, but the false Kilo delta adds future merge noise. Remove the trailing marker, or separately review and apply the repository reset helper for this file; the resulting file should match transformed upstream.

## Notable Non-Findings

Scoped classification of all 79 PR-changed marker-bearing shared files produced exactly `1 markers-only`, `6 small-diff`, `4 upstream-missing`, and `68 large-diff`; there were no `cosmetic-only` results. Only the finding above proved marker-cleaned upstream identity.

The six `small-diff` results are finder candidates because the tool deliberately auto-selects up to five non-marker diff lines, not because their markers are stale. Independent upstream/head review found real Kilo deltas in each, so a real bulk reset would be wrong:

- `packages/codemode/tsconfig.json` (`4` classifier lines): adds Bun/DOM compiler types for Kilo's tsgo environment.
- `packages/core/src/session/compaction.ts` (`1`): emits the released-reader compatibility field `include`.
- `packages/core/src/session/runner/llm.ts` (`4`): passes expected `Location` to epoch initialization/preparation to detect concurrent moves.
- `packages/opencode/src/effect/runtime-flags.ts` (`5`): preserves Kilo-only flags including `disableChannelDb`, `disableSkillShell`, `skipMigrations`, `experimentalScout`, and `experimentalSessionSwitcher`.
- `packages/tui/src/ui/dialog.tsx` (`2`): centers the dialog instead of using upstream quarter-height padding.
- `packages/ui/src/styles/theme.css` (`4`): preserves Kilo's light/dark critical surface colors.

The four `upstream-missing` files cannot establish unnecessary upstream-identical markers: `packages/opencode/src/provider/models.ts`, `packages/ui/src/i18n/it.ts`, `packages/ui/src/i18n/nl.ts`, and `script/check-model-tool-network.ts`. The other 68 files retain more than five meaningful non-marker diff lines after marker cleaning and branding transforms.

## Exact Command Results

The required full-scope command ran without writes and timed out after 600,000 ms before its final report:

```text
$ bun run script/upstream/find-reset-candidates.ts --dry-run
[OK] Last merged upstream: v1.18.0 (32696c42)
[INFO] Scope: (all shared paths)
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 341 non-code asset(s)
[INFO] Skipping 2017 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 1231
[INFO] Checking upstream blob sizes...
[INFO] Pre-bucketed 375 (missing or too-large)
[INFO] Classifying 856 file(s)...
[INFO] Classified 856/856
shell tool terminated command after exceeding timeout 600000 ms
```

The fallback sequential invocation imported `script/upstream/utils/reset.ts` directly, passed upstream commit `32696c425fc0fa1ec285389346cfa1fbe22b670a`, and completed the exact PR/marker intersection:

```text
PR_CHANGED=262
MARKED_SHARED=79
BUCKET large-diff=68
BUCKET markers-only=1
BUCKET small-diff=6
BUCKET upstream-missing=4
```

Supported scoped finder dry runs returned `markers-only (1) | would reset` for `packages/opencode/test/account/service.test.ts`; they returned `small-diff (1) | would reset` with respective counts `4`, `1`, `4`, `5`, `2`, and `4` for the six files listed above. The corresponding seven `reset-to-upstream.ts --dry-run` commands all resolved `v1.18.0 (32696c42)` and emitted this exact result with the relevant path substituted:

```text
[INFO] [DRY-RUN] Would reset <path> to transformed upstream v1.18.0
```

Independent candidate comparison at the exact head:

```text
$ git diff --numstat 32696c425fc0fa1ec285389346cfa1fbe22b670a..c69ce6caf638617169509f09e3f5d620eb702146 -- packages/opencode/test/account/service.test.ts
1       1       packages/opencode/test/account/service.test.ts

-  LayerNode.compile(Account.node, [[httpClient, Layer.succeed(HttpClient.HttpClient, client)]])
+  LayerNode.compile(Account.node, [[httpClient, Layer.succeed(HttpClient.HttpClient, client)]]) // kilocode_change
```

## Limitations

- The full finder never emitted a global bucket report. Its `Classified 856/856` progress line is not completion proof because workers can remain outstanding after the highest-index item logs; no global bucket totals were inferred from it.
- The completed fallback is scoped to PR-changed marker-bearing shared files and uses the same repository `classifyDrift()` logic, but it intentionally does not claim to classify every file in the repository-wide candidate set.
- The supported finder excludes Kilo-owned paths, non-code assets, lockfiles, and merge-config-protected files. This report therefore addresses unnecessary markers in the assigned PR/shared-file intersection, not arbitrary drift in excluded files.
- Other untracked review reports were present and changed concurrently. They were not read or modified. Only `UNNECESSARY_MARKERS.md` was authored; no real reset, source edit, commit, push, or GitHub mutation occurred.
