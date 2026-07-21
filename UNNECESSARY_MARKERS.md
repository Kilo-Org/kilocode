# Unnecessary `kilocode_change` Marker Review

## Scope and Methodology

Reviewed Kilo's OpenCode v1.17.5 merge branch (`marius-kilocode/review-opencode-v1.17.5`, `HEAD` `06d871409b`) against `origin/main` and the supplied pristine upstream v1.17.5 worktree at `.worktrees/opencode-merge/opencode` (`8d78715d64d6f2401e5dfcd93745d082aaa1d163`). The PR range contains 194 paths.

This was dry-run and report-only work. No source file was reset, edited, committed, or pushed.

Primary commands run from the repository root:

```sh
git diff --name-only origin/main...HEAD
git diff --name-only origin/main...HEAD | wc -l
bun run script/upstream/find-reset-candidates.ts --help
bun run script/upstream/find-reset-candidates.ts --dry-run
bun run script/upstream/reset-to-upstream.ts --help
bun run script/upstream/reset-to-upstream.ts <repo-relative-file> --dry-run
grep -rn "kilocode_change" <repo-relative-file>
git diff --no-index --unified=0 -- <repo-relative-file> .worktrees/opencode-merge/opencode/<repo-relative-file>
```

Additional read-only cross-checks:

```sh
git diff --name-only origin/main...HEAD | while IFS= read -r f; do test -f "$f" && test -f ".worktrees/opencode-merge/opencode/$f" && cmp -s "$f" ".worktrees/opencode-merge/opencode/$f" && printf '%s\n' "$f"; done
git diff --name-only origin/main...HEAD | while IFS= read -r f; do test -f "$f" || continue; test -f ".worktrees/opencode-merge/opencode/$f" || continue; grep -q "kilocode_change" "$f" || continue; git diff --no-index --unified=0 -- "$f" ".worktrees/opencode-merge/opencode/$f" 2>/dev/null | grep -E '^[+-].*kilocode_change' || true; done
```

I also used a read-only `bun -e` checker based on `script/upstream/utils/markers.ts` to remove marker syntax from each changed marked file, compare the remaining regions with pristine v1.17.5, and identify marked regions whose code is already equal to upstream. This check intentionally compares raw pristine upstream for marker necessity. The reset scripts compare Kilo's transformed upstream output, which includes package-name and branding transforms.

## Findings

### Confirmed stale markers in PR-changed files

These marker annotations do not mark a code difference from pristine v1.17.5. Their surrounding files still have other Kilo changes, so remove only the listed marker annotations, not the full files.

| File | Stale marker location | Evidence | `reset-to-upstream.ts --dry-run` |
|---|---|---|---|
| `packages/opencode/src/session/prompt.ts` | 757 | `const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()` equals upstream after removing the inline marker. | Would reset the entire file. Do not use that as the fix because the file has 691 other non-marker diff lines. |
| `packages/opencode/src/session/prompt.ts` | 1089 | `const exit = yield* execRead(args).pipe(Effect.exit)` equals upstream after removing the inline marker. | Would reset the entire file. |
| `packages/opencode/src/session/prompt.ts` | 1471-1475 | The marker block around `MessageV2.filterCompactedEffect(sessionID).pipe(Effect.provideService(Database.Service, database))` equals upstream. | Would reset the entire file. |
| `packages/opencode/src/session/prompt.ts` | 2074 | `const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()` equals upstream after removing the inline marker. | Would reset the entire file. |
| `packages/opencode/src/session/prompt.ts` | 2176 | `Layer.provide(Image.defaultLayer)` equals upstream after removing the inline marker. | Would reset the entire file. |
| `packages/opencode/src/session/prompt.ts` | 2204-2208 | The marker block around the upstream `format`, `system`, and `variant` input fields equals upstream. | Would reset the entire file. |
| `packages/tui/src/routes/session/index.tsx` | 1758 | The marker on the `AssistantMessage` closing brace marks no difference. | Would reset the entire file. Do not use that as the fix because the file has 402 other non-marker diff lines. |
| `packages/tui/src/routes/session/index.tsx` | 1769 | `const INLINE_TOOL_ICON_WIDTH = 2` equals upstream after removing the inline marker. | Would reset the entire file. |

The direct, minimal cleanup for these findings is marker removal only. The `--dry-run` reset result is intentionally not a recommended whole-file operation for either file.

### Whole-file reset candidates within the PR

The full candidate tool classified the 194 PR paths as 66 `identical`, 16 `small-diff`, 36 `large-diff`, and 76 `upstream-missing`. No PR-changed path was classified `markers-only` or `cosmetic-only`.

The following 16 PR files are `small-diff` candidates. `reset-to-upstream.ts --dry-run` reported `Would reset ... to transformed upstream v1.17.5` for all 16:

| File | Tool's non-marker diff count | Assessment |
|---|---:|---|
| `packages/core/schema.json` | 2 | Needs human verification. |
| `packages/core/src/catalog.ts` | 5 | Do not reset. The marked OAuth organization routing is Kilo-specific. |
| `packages/core/src/database/migration.gen.ts` | 1 | Needs human verification. |
| `packages/core/src/plugin/boot.ts` | 2 | Do not reset. Kilo intentionally omits upstream `SkillPlugin` registration. |
| `packages/core/src/project.ts` | 4 | Needs human verification. |
| `packages/core/src/ripgrep/binary.ts` | 2 | Do not reset. Kilo's Windows `rg.exe` handling is intentional. |
| `packages/effect-drizzle-sqlite/package.json` | 5 | Needs human verification. Includes Kilo release/version metadata. |
| `packages/llm/package.json` | 5 | Needs human verification. Includes Kilo release/version metadata. |
| `packages/opencode/src/cli/cmd/run/footer.permission.tsx` | 4 | Do not reset. Kilo SDK import and Kilo-facing permission copy are intentional. |
| `packages/opencode/src/cli/cmd/run/splash.ts` | 4 | Do not reset. Kilo branding and `kilo run` usage are intentional. |
| `packages/opencode/src/mcp/catalog.ts` | 2 | Do not reset. Kilo intentionally distinguishes collection from direct fetch. |
| `packages/server/src/api.ts` | 2 | Do not reset. `Kilo HttpApi` title is intentional branding. |
| `packages/server/src/handlers.ts` | 2 | Do not reset. Kilo supplies a different location-layer arrangement for effective-reference initialization. |
| `packages/tui/package.json` | 5 | Needs human verification. Includes Kilo package identities and release/version metadata. |
| `packages/tui/test/cli/tui/inline-tool-wrap-snapshot.test.tsx` | 3 | Do not reset. The assertions retain dedicated Kilo tool renderers. |
| `packages/ui/src/theme/themes/oc-2.json` | 2 | Needs human verification. It is byte-identical to pristine upstream, but differs from the reset tool's transformed upstream output; a transformed reset would make a change rather than no-op. |

The `small-diff` bucket is a review threshold, not an assertion that a reset is safe. This review found no whole PR file that should be reset solely because it appears in that bucket.

### Files already identical to upstream

Of the 194 PR paths, 60 are byte-identical to the supplied pristine upstream worktree. They do not need resetting and none carries a `kilocode_change` marker. Fifty-nine are also identical to the reset tool's transformed upstream output; the exception is `packages/ui/src/theme/themes/oc-2.json`, explained above.

Seven further PR paths are identical after Kilo's configured package-name and branding transforms, though not byte-identical to raw upstream. `reset-to-upstream.ts --dry-run` confirmed all seven as `already matches transformed upstream v1.17.5`:

- `packages/core/test/plugin/models-dev.test.ts`
- `packages/opencode/src/cli/cmd/run/footer.question.tsx`
- `packages/opencode/src/project/project.ts`
- `packages/tui/src/component/dialog-move-session.tsx`
- `packages/tui/src/context/project.tsx`
- `packages/tui/src/feature-plugins/system/diff-viewer.tsx`
- `packages/tui/test/cli/tui/diff-viewer.test.tsx`

These are merge results already aligned with Kilo's transformed upstream baseline, not candidates for a reset.

### Marker-only candidates found outside the PR range

The full-repository candidate scan found two genuine `markers-only` files. Neither appears in `git diff --name-only origin/main...HEAD`, so they are not introduced or changed by this PR. They are included for completeness because the requested candidate scan surfaced them.

| File | Stale marker lines | Evidence | `reset-to-upstream.ts --dry-run` |
|---|---|---|---|
| `packages/opencode/src/cli/cmd/run/permission.shared.ts` | 128, 132 | Removing the inline markers leaves the Kilo-transformed upstream text unchanged. | Would reset to transformed upstream. |
| `packages/sdk/js/src/error-interceptor.ts` | 40 | Removing the standalone marker leaves the Kilo-transformed upstream text unchanged. | Would reset to transformed upstream. |

`packages/opencode/src/session/prompt/anthropic.txt` was the sole `cosmetic-only` global candidate. It has no `kilocode_change` marker and is outside the PR range.

### Needs human verification

The following standalone marker comments could not be mechanically tied to a block by the marker parser. Manual context comparison shows a real Kilo difference for all except the final item, which remains ambiguous because the surrounding conditional changed upstream:

| File | Line(s) | Assessment |
|---|---:|---|
| `packages/core/src/database/database.ts` | 70 | Keep. The marker documents Kilo's deferred database-path node construction. |
| `packages/core/src/plugin/boot.ts` | 104 | Keep. It documents intentional omission of upstream `SkillPlugin`. |
| `packages/core/src/ripgrep/binary.ts` | 94 | Keep. It documents Kilo's Windows `rg.exe` fallback behavior. |
| `packages/opencode/src/cli/cmd/run/footer.prompt.tsx` | 180 | Keep. It accompanies Kilo's `slashMatches` behavior rather than upstream exact matching. |
| `packages/opencode/src/mcp/index.ts` | 675 | Keep. It accompanies Kilo's `McpCatalog.collect` versus upstream `fetch`. |
| `packages/opencode/src/plugin/index.ts` | 80, 112 | Keep. These document Kilo plugin type bridging and non-plugin named-export handling. |
| `packages/opencode/src/session/prompt.ts` | 1277, 1448, 1457, 1856 | Keep. Each documents a Kilo-only prompt/compaction behavior. |
| `packages/server/src/handlers.ts` | 50 | Keep. It documents Kilo's host-provided location-layer behavior. |
| `packages/tui/src/routes/session/index.tsx` | 433 | Needs human verification. The marker is immediately before an upstream-equivalent `plan_enter` body, but Kilo lacks upstream's preceding `plan_exit` branch. Removing this comment appears safe, but the standalone placement makes its intended region ambiguous. |

## Notable Non-Findings

- None of the 34 PR-changed files containing `kilocode_change` markers is wholly marker-only or cosmetic-only.
- No PR file carrying a marker is byte-identical to raw pristine upstream.
- The eight confirmed stale markers are limited to two otherwise divergent files. There is no evidence that either full file should be reset.
- Manual comparison of the marked `small-diff` files found substantive Kilo behavior or branding at the marked locations. The reset tool's 16 `Would reset` results should therefore not be treated as an approval to discard them.

## Command Output Excerpts

`find-reset-candidates.ts --dry-run`:

```text
[OK] Last merged upstream: v1.17.5 (8d78715d)
[INFO] Candidate files: 1025
| markers-only | 2 | would reset |
| cosmetic-only | 1 | would reset |
| small-diff | 199 | would reset |
| large-diff | 416 | skipped |
| identical | 146 | nothing to do |
```

PR cross-reference:

```text
git diff --name-only origin/main...HEAD | wc -l
194

PR classifications: identical=66, small-diff=16, large-diff=36, upstream-missing=76
```

Examples of individual reset dry-runs:

```text
[INFO] [DRY-RUN] Would reset packages/opencode/src/session/prompt.ts to transformed upstream v1.17.5
[INFO] [DRY-RUN] Would reset packages/tui/src/routes/session/index.tsx to transformed upstream v1.17.5
[OK] packages/opencode/src/project/project.ts already matches transformed upstream v1.17.5
[OK] packages/tui/src/context/project.tsx already matches transformed upstream v1.17.5
```

## Limitations

- `reset-to-upstream.ts` compares the working tree to transformed upstream, not raw pristine upstream. Its dry-run result is a safe indication of what the script would write, not proof that a whole-file reset preserves Kilo behavior.
- The bulk classifier intentionally treats up to five non-marker diff lines as `small-diff`; it does not establish that those lines are unnecessary.
- Marker-block analysis is exact for parsable blocks and inline markers. Standalone comments that conceptually annotate adjacent control flow require context review and are marked `needs human verification` where ownership is ambiguous.
- The audit only evaluates the stated PR range against v1.17.5. It does not judge whether remaining intentional Kilo changes are correct, complete, or desirable.
- The working tree contained pre-existing untracked review reports. This task added only `UNNECESSARY_MARKERS.md` and did not alter those files.
