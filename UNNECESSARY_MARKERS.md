# UNNECESSARY_MARKERS

## Result

**2 findings (3 stale inline annotations).** Both are pre-existing Kilo marker debt present at the supplied base, not newly introduced by this PR. No stale marker block was found.

Provenance reviewed:

- Base: `6175210c0fd0092a86aa475e4d8d7616711a1464`
- Head/checked-out `HEAD`: `5d120f0696a83b354804e0848f1c1af4b0088a4f`
- Pristine upstream `v1.18.18`: `31406ccc51b4bd2a4e1e086b2bcaa5f7f804f26d`
- Merge base: the supplied base
- PR scope: exactly 48 changed files; 17 contain `kilocode_change` at head (15 shared files and 2 Kilo-owned exempt files)

## Findings

### P3: Transformed upstream NVIDIA referer expectations retain stale markers

`packages/opencode/test/provider/provider.test.ts:1285` and `packages/opencode/test/provider/provider.test.ts:1298`

Both lines are:

```ts
"HTTP-Referer": "https://kilo.ai/", // kilocode_change
```

After applying the repository's upstream branding transform to pristine `v1.18.18`, the corresponding lines are already exactly `"HTTP-Referer": "https://kilo.ai/",`. Removing only the two inline annotations therefore leaves no Kilo-vs-transformed-upstream difference. The adjacent `X-Title` and `X-BILLING-INVOKE-ORIGIN` values remain real Kilo deltas and their markers are necessary.

Minimal fix: remove only the two `// kilocode_change` annotations from the `HTTP-Referer` lines.

Provenance: pre-existing Kilo; both annotations are already present at the supplied base.

### P3: Unchanged test timeout retains a stale marker

`packages/opencode/test/session/compaction.test.ts:1317`

The line is:

```ts
{ timeout: 10_000 }, // kilocode_change - snapshot is isolated above
```

Pristine transformed upstream already has `{ timeout: 10_000 },` for this test. The surrounding Kilo changes that inject the `snap` layer and remove the git fixture are substantive, but this timeout value is not different from upstream. Removing only the annotation leaves the line identical to upstream.

Minimal fix: remove only `// kilocode_change - snapshot is isolated above`.

Provenance: pre-existing Kilo; the annotation is already present at the supplied base.

## Dry-Run Evidence

Required global command executed:

```text
bun run script/upstream/find-reset-candidates.ts --dry-run
[OK] Last merged upstream: v1.18.18 (31406ccc)
[INFO] Scope: (all shared paths)
[INFO] Review limit: 5 non-marker diff line(s)
[INFO] Mode: dry-run
[INFO] Skipping 342 non-code asset(s)
[INFO] Skipping 2186 file(s) protected by keepOurs/skipFiles config
[INFO] Candidate files: 1372
[INFO] Pre-bucketed 399 (missing or too-large)
[INFO] Classifying 973 file(s)...
[INFO] Classified 973/973
```

The process did not emit its final markdown report before the shell timeout, including on a 600-second retry. I therefore constrained the same command to each potential `small-diff` path in the 48-file PR scope. Exact in-scope results were:

| File | `find-reset-candidates.ts --dry-run` | `reset-to-upstream.ts <file> --dry-run` | Interpretation |
|---|---|---|---|
| `artifacts/glm52-rise-video/package.json` | `small-diff` (4 lines), would reset | Would reset to transformed upstream `v1.18.18` | Kilo package release metadata; no marker, so not an unnecessary-marker finding. |
| `packages/core/src/session/compaction.ts` | `small-diff` (1 line), would reset | Would reset to transformed upstream `v1.18.18` | Necessary Kilo compatibility field: `include: selected.recent`; marker is normalized and required. |
| `packages/protocol/package.json` | `small-diff` (4 lines), would reset | Would reset to transformed upstream `v1.18.18` | Kilo package release metadata; no marker. |
| `packages/schema/package.json` | `small-diff` (4 lines), would reset | Would reset to transformed upstream `v1.18.18` | Kilo package release metadata; no marker. |
| `patches/@ai-sdk%2Fgroq@3.0.31.patch` | `small-diff` (5 lines), would reset | Would reset to transformed upstream `v1.18.18` | Patch-content delta, with no `kilocode_change` annotation. |

The actual supported per-file syntax was confirmed with `bun run script/upstream/reset-to-upstream.ts --help` as:

```text
bun run script/upstream/reset-to-upstream.ts <repo-relative-file> [--dry-run]
```

No reset was applied.

## Direct Region Audit

I stripped marker comments in memory, applied the repository's upstream branding transform, and compared every marked line/block in the 15 changed shared files to pristine upstream. This found the three stale inline annotations above and no wholly stale block. All other marked regions intersect real changed lines; notable necessary deltas include:

- Config warning/normalization logic added in `packages/opencode/src/config/config.ts`.
- Compaction prompt rerendering, payload recovery, compatibility events, and Kilo chunk handling in `packages/opencode/src/session/compaction.ts`.
- Kilo gateway, provider, retry, system-prompt, and corresponding test behavior absent from pristine upstream.
- `packages/core/src/session/compaction.ts`'s released-reader compatibility field, despite its whole-file `small-diff` classification.

The two marked Kilo-owned paths, `packages/opencode/src/kilocode/config-validation.ts` and `packages/opencode/test/kilocode/config-validation.test.ts`, do not exist upstream and are checker-exempt. They were classified separately as Kilo-owned rather than as stale no-difference regions; their new-file annotations are unnecessary under the exempt-path policy, but that is a marker-policy issue rather than a stale-upstream-difference finding in this lens.

All global candidates outside the 48 changed files were excluded from review. No source files were edited, no reset was applied, and no GitHub state was mutated.

## Limitations

- The required unscoped classifier reached `Classified 973/973` but timed out before printing bucket totals and the global file list. The five in-scope potential reset candidates were recovered with exact path-scoped runs and each was verified with the required per-file reset dry run.
- This lens checks marker necessity only. It does not assess behavioral correctness, missing markers, broad-but-still-valid marker placement, CI, or candidates outside the supplied 48-file PR scope.
