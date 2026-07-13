# Unnecessary `kilocode_change` Marker Re-review: PR #12088

## Second-pass verdict

**Reviewed head:** `b42f911f7680559b536850aab414258d0eb59a88`

**Current `origin/main`:** `6639022345dd0966b6e028f2c7e533ab91e97166`

**Merge base:** `be15cf4b556bea96aaef6de1b3c405b86c0d1a6c`

The Kilo-owned-path cleanup is complete. The original 66 stale shared-file annotations remain, and the remediation range adds three more, for **69 unnecessary annotations across 39 shared files**. This remains cleanup work rather than a behavioral merge blocker.

## Remaining candidates

The prior 66 annotations remain in the same 38 files and categories:

| Area | Files |
|---|---|
| Provider headers | `packages/core/src/plugin/provider/{llmgateway,nvidia,openrouter,vercel,zenmux}.ts`, `packages/opencode/src/provider/provider.ts`, `packages/opencode/test/provider/provider.test.ts` |
| CLI | `packages/opencode/src/cli/cmd/{providers,serve,session,web}.ts`, `packages/opencode/src/cli/cmd/tui/attach.ts` |
| HTTP API | `packages/opencode/src/server/routes/instance/httpapi/groups/{config,experimental,global,session}.ts`, `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` |
| Session/tool internals | `packages/opencode/src/session/{message-v2,prompt,reminders}.ts`, `packages/opencode/src/tool/{edit,task}.ts`, `packages/opencode/src/permission/index.ts`, `packages/opencode/src/provider/{error,transform}.ts`, `packages/opencode/src/skill/index.ts`, `packages/opencode/src/util/filesystem.ts` |
| Build and TUI | `packages/opencode/script/build.ts`, `packages/opencode/src/cli/cmd/tui/context/sync.tsx`, `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`, `packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx`, `packages/opencode/src/cli/cmd/tui/routes/session/{index,permission}.tsx` |
| Tests | `packages/core/test/util/effect-flock.test.ts`, `packages/opencode/test/provider/{header-timeout,provider}.test.ts`, `packages/opencode/test/share/share-next.test.ts`, `packages/opencode/test/tool/{registry,task}.test.ts` |

Three new stale annotations wrap branding-transformed upstream values:

- `packages/opencode/src/cli/cmd/github.handler.ts:441` on `shareBaseUrl`
- `packages/opencode/src/cli/cmd/github.handler.ts:702` on the default Kilo OIDC URL
- `packages/opencode/src/provider/provider.ts:899` on the `kilo auth` Snowflake wording

## Resolved items

All reported marker text was removed from the eight Kilo-owned config, permission, session, config-console, and permission-test paths. The two repository-wide whole-file candidates, `cli/cmd/run/permission.shared.ts` and `plugin/digitalocean.ts`, are unchanged by this PR and remain separate cleanup.

## Commands and limitations

The required classifier and marker fixer were run against a disposable detached worktree at the exact head. `find-reset-candidates.ts packages/opencode/src --dry-run` reproduced two whole-file marker-only candidates, neither changed by this PR. `fix-kilocode-markers.ts --dry-run` confirmed all 39 partial candidates. The annotation checker skipped because it detected an upstream merge. No reset or production edit was applied.
