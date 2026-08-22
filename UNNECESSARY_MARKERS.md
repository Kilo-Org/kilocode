# Unnecessary `kilocode_change` markers in PR 12695

Reviewed `70eeaff3837e29529e26c7c090767df0a3768249..518501a994bcd660e8c6d061b450c32412104004` against merged upstream `v1.17.13` (`10c894bd`). The PR changes 1,502 files; 286 changed files still contain `kilocode_change`.

## Findings

1. `packages/core/test/session-prompt.test.ts:101` - the standalone comment `// kilocode_change - no durable interrupt lookup: released database readers cannot decode that event type.` is the only difference from transformed upstream. `find-reset-candidates.ts` classified the file as `markers-only`, and `reset-to-upstream.ts --dry-run` reported that it would reset the file.
2. `packages/opencode/test/account/service.test.ts:39` - the trailing `// kilocode_change` is the only difference from transformed upstream. The `LayerNode.compile(...)` code itself is now upstream. Both scripts classified/verified it the same way as the first finding.

Removing only these comments restores transformed-upstream content; no Kilo behavior is lost.

## Notable non-findings

- The source scan found three other `markers-only` files: `packages/opencode/src/cli/cmd/run/demo.ts`, `permission.shared.ts`, and `subagent-data.ts`. None changed in this PR, so they are outside this review.
- The PR-intersecting `small-diff` candidates were inspected rather than treated as findings. Examples include `packages/opencode/src/cli/cmd/run/types.ts`, `effect/runtime-flags.ts`, `mcp/catalog.ts`, `server/routes/instance/httpapi/handlers/file.ts`, and the session layer files; each retains substantive Kilo-only code or branding. Equivalent small-diff intersections in `packages/core`, `packages/tui`, `packages/llm`, `packages/server`, and `packages/schema` also retained real non-marker differences.
- No additional `markers-only` candidates appeared in completed scans of `packages/tui`, `packages/llm`, `packages/server`, `packages/schema`, `packages/protocol`, `packages/ui`, `packages/session-ui`, `.github`, or `script/publish.ts`.

## Commands and limitations

- `bun script/upstream/find-reset-candidates.ts --dry-run` used the correct Bun invocation, fetched missing tag `v1.17.13`, considered 1,191 shared candidates after skipping 332 assets and 1,879 policy-protected files, and classified all 827 queued files. It exceeded the sandbox's 120-second command limit before printing the report. `bun run script/upstream/find-reset-candidates.ts --dry-run --concurrency 32` and a redirected high-concurrency retry had the same post-classification timeout.
- To obtain usable reports, the same analyzer was run with `--dry-run` on PR-relevant scopes. Key results were `packages/core`: 1 `markers-only` (`packages/core/test/session-prompt.test.ts`); `packages/opencode/src`: 3 `markers-only`, all outside the PR; and `packages/opencode/test/account`: 1 `markers-only` (`packages/opencode/test/account/service.test.ts`). Other scoped outcomes are summarized above rather than exhaustively listed.
- Verification commands were `bun run script/upstream/reset-to-upstream.ts packages/core/test/session-prompt.test.ts --dry-run` and the same command for `packages/opencode/test/account/service.test.ts`; both resolved `v1.17.13` (`10c894bd`) and reported `[DRY-RUN] Would reset ... to transformed upstream v1.17.13`.
- The reset verifier reports whether a reset would occur, not whether the drift is marker-only. That conclusion comes from the finder's `markers-only` classification plus manual raw-upstream and PR-diff inspection. All commands were dry runs and changed no repository files.
