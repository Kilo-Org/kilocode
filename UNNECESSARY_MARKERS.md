# Unnecessary `kilocode_change` markers in PR #12088

## Scope and method

Reviewed the 1,206 paths in `git diff --name-only origin/main...HEAD` against the last merged OpenCode release, v1.16.2 (`76c631d1`). I ran the required bulk classifier in dry-run mode, intersected its results with the PR file set, verified suspicious files with the single-file reset dry run, and manually compared suspicious marker ranges with transformed upstream. No reset or code edit was applied.

## Findings

There are no whole-file `markers-only` reset candidates in this PR. The completed source report from:

```text
bun run script/upstream/find-reset-candidates.ts packages/opencode/src --dry-run --concurrency 32
Last merged upstream: v1.16.2 (76c631d1)
Total candidates: 317
markers-only: 2; cosmetic-only: 1; small-diff: 47; large-diff: 168;
identical: 56; upstream-missing: 43
markers-only:
  packages/opencode/src/cli/cmd/run/permission.shared.ts
  packages/opencode/src/plugin/digitalocean.ts
```

Both `markers-only` files, and the cosmetic-only `packages/opencode/src/session/prompt/anthropic.txt`, have zero intersection with `origin/main...HEAD`. `reset-to-upstream.ts --dry-run` nevertheless confirmed that each of the two global marker-only files would reset to transformed v1.16.2; they are repository cleanup candidates, not PR #12088 findings.

The PR does contain **66 stale individual annotations in 38 shared files**. These files retain other real Kilo/OpenCode differences, so a whole-file reset would be wrong; only the listed marker comments are unnecessary. Marker-range comparison stripped comments, applied the same v1.16.2 branding transform used by the reset workflow, and checked whether each marked range occurred in the remaining diff.

| File(s) | Stale marker finding |
|---|---|
| `packages/core/src/plugin/provider/{llmgateway,nvidia,openrouter,vercel,zenmux}.ts` | The marked referrer-header assignments are transformed upstream branding, not Kilo-only diffs. |
| `packages/opencode/src/provider/provider.ts` and `packages/opencode/test/provider/provider.test.ts` | Same stale marker pattern on transformed `https://kilo.ai/` referrer values. |
| `packages/opencode/src/cli/cmd/{providers,serve,session,web}.ts` and `packages/opencode/src/cli/cmd/tui/attach.ts` | Markers wrap blocks or values now equal to transformed upstream (`instance: false` or branded help/auth text). |
| `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts` and `handlers/session.ts` | Upstream v1.16.2 has the bodyless fork payload/error and raw fork handler behavior; the carry-upstream markers are stale. |
| `packages/opencode/src/session/message-v2.ts`, `session/prompt.ts`, and `tool/edit.ts` | `rows.map(part)`, two default-agent resolution lines, and both `filediff` metadata fields now match upstream exactly. |
| `packages/opencode/script/build.ts`, `src/cli/cmd/tui/context/sync.tsx`, `src/tool/task.ts`, and `src/util/filesystem.ts` | Entire marked blocks no longer contain a non-upstream line after marker stripping. |
| `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`, `context/sync.tsx`, `feature-plugins/sidebar/footer.tsx`, `routes/session/index.tsx`, and `routes/session/permission.tsx` | Eight UI marker comments or blocks remain on lines now supplied by upstream. |
| `packages/opencode/src/permission/index.ts`, `provider/error.ts`, `provider/provider.ts`, `provider/transform.ts`, `session/reminders.ts`, and `skill/index.ts` | Seven inline or block markers wrap lines that are now identical to transformed upstream. |
| `packages/opencode/src/server/routes/instance/httpapi/groups/{config,experimental,global,session}.ts` | Twelve marker comments on branded descriptions, plus the two fork lines above, are stale because branding transforms produce the same text. |
| `packages/core/test/util/effect-flock.test.ts`, `packages/opencode/test/provider/{header-timeout,provider}.test.ts`, `test/share/share-next.test.ts`, `test/tool/registry.test.ts`, and `test/tool/task.test.ts` | Ten test markers remain on upstream-equivalent imports, fixtures, calls, or expectations. |

`reset-to-upstream.ts --dry-run` was run for all 38 files above. Every invocation reported:

```text
Last merged upstream: v1.16.2 (76c631d1)
[DRY-RUN] Would reset <file> to transformed upstream v1.16.2
```

That verifies the files differ overall and prevents treating these partial findings as safe whole-file resets. Manual spot checks confirmed, for example, upstream `groups/session.ts` already has `payload: [HttpApiSchema.NoContent, ForkPayload]` and `ApiNotFoundError`, upstream `message-v2.ts` has `return rows.map(part)`, upstream `prompt.ts` has both `agentName ? ... : defaultInfo()` lines, and upstream `tool/edit.ts` has both `filediff` metadata fields. The provider referrer findings are transform-driven: raw upstream uses `https://opencode.ai/`, which becomes the local `https://kilo.ai/` value before comparison.

## Notable non-findings

Low-drift PR files including `src/cli/cmd/db.ts`, `debug/index.ts`, `run/types.ts`, `run/variant.shared.ts`, `tui/config/tui-schema.ts`, `tui/keymap.tsx`, `tui/routes/session/question.tsx`, `cli/effect-cmd.ts`, `config/paths.ts`, `control-plane/workspace.ts`, `effect/runtime-flags.ts`, `server/shared/workspace-routing.ts`, and `session/llm/ai-sdk.ts` retained markers for real Kilo differences. In particular, `disableChannelDb` and `skipMigrations` are absent from raw upstream v1.16.2, so their `runtime-flags.ts` markers are justified. The two global whole-file marker-only candidates are unchanged by this PR and should not be attributed to it.

## Limitations

The exact unscoped command `bun run script/upstream/find-reset-candidates.ts --dry-run` was run twice (default concurrency and `--concurrency 32`). Both reached `Classified 699/699` after reporting 936 candidates, 330 skipped assets, 1,715 policy-protected files, and 237 pre-bucketed files, but the sandbox's fixed 120-second command limit terminated each before the final report was emitted. Supported scoped dry runs completed for `packages/opencode/src`, `packages/opencode/test`, `packages/opencode/script`, `packages/core`, `packages/llm`, `packages/plugin`, and `packages/ui`; the source report above contains the only `markers-only` bucket. The bulk script intentionally excludes Kilo-owned paths, protected paths, binary/assets, and oversized files. The partial-range analysis covered 249 PR-changed, non-protected shared files that still contain `kilocode_change`; it is line-based, so moved or duplicated identical lines were manually spot-checked rather than assumed safe for automated removal.
