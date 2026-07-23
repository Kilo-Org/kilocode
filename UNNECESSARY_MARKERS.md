# Unnecessary `kilocode_change` Marker Review

## Scope and Method

- Reviewed PR #12460 at `origin/main...51d8031c9997bd5478bcde715562169f732d04d4` (208 changed paths).
- Compared shared files at `HEAD` with upstream `v1.17.9` (`5c23e88419c4743b9be42cea132f2fb1e6cb63ff`) after the same branding, package-name, extension, i18n, and web transforms used by `reset-to-upstream.ts`.
- Excluded Kilo-owned paths, generated artifacts as evidence of marker drift, and upstream-missing paths. Moved paths were evaluated at their current path against the v1.17.9 tree, rather than assuming the PR's rename metadata identifies upstream equivalence.
- Used line-level comparison after stripping marker syntax. A marker is a finding only where its annotated code is byte-identical to transformed upstream. This catches stale annotations in files that still have other legitimate Kilo changes, which the file-level reset detector intentionally cannot classify as `markers-only`.

## Findings

### P2, high confidence: 27 stale marker annotations remain in 11 changed shared files

The annotated code below is identical to transformed upstream v1.17.9. Removing only these annotations would not remove Kilo behavior. These are maintenance hazards because they create unnecessary upstream-merge conflict surfaces and obscure the actual Kilo delta.

| File | Stale marker references | Count |
|---|---|---|
| `packages/core/src/plugin/provider/llmgateway.ts` | `:20` | 1 |
| `packages/core/src/plugin/provider/openai-auth.ts` | `:261`, `:263` | 2 |
| `packages/core/test/plugin/provider-llmgateway.test.ts` | `:53` | 1 |
| `packages/opencode/src/provider/provider.ts` | `:476`, `:487`, `:497`, `:508`, `:614`, `:814`, `:872`, `:1080` | 8 |
| `packages/opencode/src/provider/transform.ts` | `:1278` | 1 |
| `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts` | `:174`, `:292` | 2 |
| `packages/opencode/src/session/prompt.ts` | `:757`, `:1089`, `:2052`, `:2182-2186` | 4 |
| `packages/opencode/test/share/share-next.test.ts` | `:20`, `:307`, `:313` | 3 |
| `packages/tui/src/context/data.tsx` | `:146`, `:458` | 2 |
| `packages/tui/src/routes/session/index.tsx` | `:1750`, `:1761` | 2 |
| `packages/ui/src/components/markdown.tsx` | `:763` | 1 |

The first row includes a transformed branding value (`https://kilo.ai/`), and the provider, prompt, TUI, and markdown rows likewise include values or text produced by the transform pipeline. They are still stale markers because the comparison baseline is the transformed upstream file that `reset-to-upstream.ts` would produce.

## Verified Reset Candidates

No changed PR file is a verified whole-file reset candidate. The required bulk detector found two `markers-only` files, but neither intersects `origin/main...HEAD`:

- `packages/opencode/src/cli/cmd/run/permission.shared.ts`
- `packages/sdk/js/src/error-interceptor.ts`

The 16 changed-path intersections were all `small-diff`, not `markers-only`. Each has non-marker drift after transforms, so resetting the entire file would discard legitimate Kilo behavior. The stale annotations above are therefore marker-removal candidates, not file-reset candidates.

## False Positives and Non-Findings

- All 16 detector intersections were individually verified with the supported `reset-to-upstream.ts <repo-relative-file> --dry-run` interface. Every command resolved v1.17.9 and printed `[DRY-RUN] Would reset <path> to transformed upstream v1.17.9`; no command reported `already matches`. The verified set was:
  `packages/core/src/plugin/boot.ts`, `packages/core/src/provider.ts`, `packages/core/src/session/runner/model.ts`, `packages/core/test/plugin/provider-llmgateway.test.ts`, `packages/core/test/session-runner.test.ts`, `packages/opencode/src/mcp/catalog.ts`, `packages/opencode/test/server/httpapi-v2-pty.test.ts`, `packages/opencode/test/tool/shell.test.ts`, `packages/server/src/api.ts`, `packages/server/src/cors.ts`, `packages/server/src/handlers.ts`, `packages/server/src/routes.ts`, `packages/storybook/.storybook/main.ts`, `packages/tui/test/cli/tui/inline-tool-wrap-snapshot.test.tsx`, `packages/ui/src/components/markdown-worker.ts`, and `packages/ui/src/pierre/index.ts`.
- Manual v1.17.9 comparisons confirm those 16 whole files contain actual non-marker differences, including Kilo provider behavior, server wiring, location migration coverage, Kilo-specific tool rendering, and Kilo themes. The detector's low line-count classification is not evidence that the files should be reset.
- Additional manual suspicious-file dry runs for `packages/core/src/plugin/provider/llmgateway.ts`, `packages/core/src/plugin/provider/openai-auth.ts`, `packages/opencode/src/provider/provider.ts`, `packages/opencode/src/provider/transform.ts`, `packages/opencode/src/server/routes/instance/httpapi/groups/experimental.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/test/share/share-next.test.ts`, and `packages/ui/src/components/markdown.tsx` produced the same exact result: `[DRY-RUN] Would reset <path> to transformed upstream v1.17.9`. Line-level comparison shows that each still has legitimate non-marker Kilo drift, alongside the stale markers reported above.
- `packages/opencode/src/pty-preparation.ts` is deleted locally, so it cannot retain a marker. `packages/ui/src/pierre/kilo-diff-theme.ts` is upstream-missing/Kilo-specific and is not a stale-marker finding.
- No finding was recorded for generated SDK/OpenAPI output, Kilo-owned paths, or move-only changes. In particular, `packages/opencode/test/server/httpapi-v2-pty.test.ts` exists in upstream v1.17.9 despite its PR-range add status and has real transformed-upstream drift.

## Exact Command Outcomes

`bun run script/upstream/find-reset-candidates.ts --dry-run` completed successfully with no writes:

- Last merged upstream: `v1.17.9` (`5c23e884`).
- Scope: all shared paths. Review limit: 5 non-marker diff lines. Candidate files: 1011.
- Skipped: 332 non-code assets and 1793 keep-ours/skip-files-protected paths.
- Buckets: `markers-only` 2, `cosmetic-only` 1, `small-diff` 198, `large-diff` 423, `identical` 145, `too-large` 1, `upstream-missing` 240, and `local-missing` 1.
- Both `markers-only` results were reported as `would reset`; neither was changed by this PR. The 16 relevant intersections were verified individually as described above, using only dry-run commands.

`bun run script/upstream/reset-to-upstream.ts --help` documented the supported interface as:

```text
bun run script/upstream/reset-to-upstream.ts <repo-relative-file> [--dry-run]
```

No reset, marker-fix, or source-edit command was run without `--dry-run`.

## Limitations

- This review establishes stale annotations relative to the repository's transformed upstream v1.17.9 baseline, not raw upstream bytes. That is the appropriate baseline for this fork and matches both required scripts.
- `find-reset-candidates.ts` is file-level and deliberately reports small non-marker diffs as reset candidates. It cannot identify stale annotations inside a file that retains unrelated drift; the 27 findings required the additional line-level comparison.
- The review does not attribute each pre-existing stale annotation to a particular commit in the PR. It establishes that the final merged files in the reviewed range retain the markers.

## Summary

No PR-changed file can be safely reset wholesale based only on markers. Eleven changed shared files retain 27 unnecessary `kilocode_change` annotations around code already identical to transformed upstream v1.17.9. Report: `UNNECESSARY_MARKERS.md`.
