# Kilo Code Change Marker Review

## Review Target

- PR: https://github.com/Kilo-Org/kilocode/pull/9751 (#9751, Merge opencode v1.14.29)
- Base: origin/main
- Compared range: `origin/main...HEAD`

## Scope

- Total changed files: 647
- Status summary: 545 modified, 41 added, 23 deleted, 38 renamed
- Complete changed-file list is included in the appendix.

## Review Method

- `git diff --name-only origin/main...HEAD` returned 647 changed files.
- `git diff --name-status -M origin/main...HEAD` returned 545 modified, 41 added, 23 deleted, and 38 renamed files.
- Scanned every changed file for `kilocode_change` occurrence-count changes between `origin/main` and `HEAD`, following rename sources where Git detected renames.
- Inspected all diffs containing added/removed marker lines with `git diff --find-renames -G'kilocode_change'` and manually reviewed the files with marker-count decreases.
- `bun run script/check-opencode-annotations.ts` was also run; it printed `Skipping shared upstream annotation check -- upstream merge detected.`

## Findings

- packages/opencode/script/publish.ts: Removed `// kilocode_change start/end` around the checksum calculation for Kilo release artifacts (`kilo-linux-arm64.tar.gz`, `kilo-linux-x64.tar.gz`, `kilo-darwin-x64.zip`, `kilo-darwin-arm64.zip`). The surrounding file is shared opencode code and these artifact names are Kilo-specific. The individual strings are not otherwise annotated, so this looks like a likely accidental marker removal.

## Manual Checks / Ambiguous Cases

- packages/opencode/src/tool/bash.ts: Marker count dropped from 25 to 7. The diff removes many previously annotated Kilo permission-scanning/read-access blocks while retaining a smaller external-directory and bash metadata flow. This may be intentional upstream replacement, but because the current tool still contains Kilo-specific permission behavior in shared code, it should be manually confirmed that all remaining Kilo-only behavior is covered by the remaining markers.
- packages/opencode/src/permission/index.ts: Marker count dropped from 61 to 58 while permission precedence behavior changed from sorted wildcard-first rules back to insertion-order rules. The removed markers are mostly from relocated/reworked session-drain logic and comments, not obvious standalone marker deletion, but the behavioral change is security-sensitive and should be manually confirmed.
- packages/opencode/src/config/permission.ts: Marker count dropped from 3 to 2 when permission precedence comments were rewritten. No active Kilo code marker was visibly removed from the remaining null-delete-sentinel logic, but this is tied to the permission-order behavior above.
- packages/opencode/src/provider/transform.ts: Removed `kilocode_change` wrapper comments around cherry-picked DeepSeek/OpenRouter reasoning transforms. The old comments explicitly said they would be reverted on the next wholesale upstream merge; this PR is an upstream merge, so the removal is probably intentional, but it is worth confirming those transforms are now upstream-owned.
- packages/opencode/test/session/message-v2.test.ts: Removed `kilocode_change` wrapper comments around the OpenRouter reasoning-details test. This mirrors the provider-transform upstreaming case and is probably intentional, but should be confirmed with the upstream merge context.
- packages/opencode/src/agent/agent.ts: Marker count dropped from 31 to 29 because import-line markers on `Global` and `path` were removed while Kilo-specific agent defaults remain marked below. This looks like import cleanup rather than lost annotation, but it was manually noted because the imports still support Kilo-specific whitelisting code.
- packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx -> packages/opencode/src/cli/cmd/tui/component/use-connected.tsx: The `useConnected` marker moved with the function into a new file. Net marker coverage appears preserved, but this is a shared opencode path and the new file should keep its marker.
- packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx: Marker count dropped from 15 to 11 due removal of `useEvent` and one JSX marker block. The remaining indexing/remote Kilo UI blocks are still marked. No clear accidental marker-only removal found.
- packages/opencode/src/config/config.ts: Marker count dropped from 76 to 73. Removed inline markers on `KilocodeDefaultPlugins` and `KiloIndexingConfig` imports are still inside a surrounding `kilocode_change start/end` block; removed `.pipe(Effect.orDie) // kilocode_change` appears to be marker cleanup after the adjacent Kilo merge call remains marked.
- packages/shared/src/global.ts -> packages/core/src/global.ts: `packages/shared/src/global.ts` was deleted with 2 marker occurrences, but equivalent Kilo global path markers are present in the moved/new `packages/core/src/global.ts` (4 occurrences). No missing marker found, but noted because the deleted file itself is not renamed by Git to the same target.

## Conclusion

One likely accidental marker removal was found in `packages/opencode/script/publish.ts`: the Kilo-specific release checksum block lost its `kilocode_change` wrapper. Other marker removals appear to be either code movement, upstreamed cherry-picks, deleted/replaced code, or marker cleanup around code that remains covered by nearby markers, but the manual-check items above should be reviewed because they touch shared opencode paths and several are security/permission-sensitive.

## Appendix: Complete Changed-File List

The list below is the complete output of `git diff --name-status -M origin/main...HEAD`. Rename rows include source and destination.

```text
M	.github/workflows/disabled/review.yml.disabled
M	.opencode/skills/effect/SKILL.md
M	.opencode/tool/github-triage.ts
M	bun.lock
A	kilocode-2.code-workspace
M	nix/kilo.nix
M	package.json
M	packages/app/package.json
M	packages/app/src/app.tsx
M	packages/app/src/components/dialog-edit-project.tsx
M	packages/app/src/components/dialog-fork.tsx
M	packages/app/src/components/dialog-select-directory.tsx
M	packages/app/src/components/dialog-select-file.tsx
M	packages/app/src/components/dialog-select-mcp.tsx
M	packages/app/src/components/prompt-input/build-request-parts.ts
M	packages/app/src/components/prompt-input/context-items.tsx
M	packages/app/src/components/prompt-input/slash-popover.tsx
M	packages/app/src/components/prompt-input/submit.test.ts
M	packages/app/src/components/prompt-input/submit.ts
M	packages/app/src/components/session/session-context-tab.tsx
M	packages/app/src/components/session/session-header.tsx
M	packages/app/src/components/session/session-new-view.tsx
M	packages/app/src/components/session/session-sortable-tab.tsx
M	packages/app/src/components/settings-general.tsx
M	packages/app/src/components/status-popover-body.tsx
M	packages/app/src/context/file.tsx
M	packages/app/src/context/global-sync.tsx
M	packages/app/src/context/global-sync/bootstrap.ts
M	packages/app/src/context/global-sync/child-store.test.ts
M	packages/app/src/context/global-sync/child-store.ts
M	packages/app/src/context/global-sync/event-reducer.ts
M	packages/app/src/context/layout.tsx
M	packages/app/src/context/local.tsx
M	packages/app/src/context/notification.tsx
M	packages/app/src/context/permission-auto-respond.test.ts
M	packages/app/src/context/permission-auto-respond.ts
M	packages/app/src/context/prompt.tsx
M	packages/app/src/context/sync.tsx
M	packages/app/src/i18n/en.ts
M	packages/app/src/pages/directory-layout.tsx
M	packages/app/src/pages/home.tsx
M	packages/app/src/pages/layout.tsx
M	packages/app/src/pages/layout/helpers.ts
M	packages/app/src/pages/layout/sidebar-items.tsx
M	packages/app/src/pages/layout/sidebar-project.tsx
M	packages/app/src/pages/layout/sidebar-workspace.tsx
M	packages/app/src/pages/session.tsx
M	packages/app/src/pages/session/file-tabs.tsx
M	packages/app/src/pages/session/message-timeline.tsx
M	packages/app/src/pages/session/use-session-commands.tsx
M	packages/app/src/utils/base64.ts
M	packages/app/src/utils/persist.ts
D	packages/console/core/migrations/20260417071612_tidy_diamondback/snapshot.json
A	packages/core/package.json
R097	packages/opencode/src/effect/cross-spawn-spawner.ts	packages/core/src/cross-spawn-spawner.ts
R098	packages/opencode/src/effect/logger.ts	packages/core/src/effect/logger.ts
R100	packages/opencode/src/effect/memo-map.ts	packages/core/src/effect/memo-map.ts
R092	packages/opencode/src/effect/observability.ts	packages/core/src/effect/observability.ts
R094	packages/opencode/src/effect/runtime.ts	packages/core/src/effect/runtime.ts
R100	packages/shared/src/filesystem.ts	packages/core/src/filesystem.ts
R100	packages/opencode/src/flag/flag.ts	packages/core/src/flag/flag.ts
R065	packages/opencode/src/global/index.ts	packages/core/src/global.ts
R100	packages/opencode/src/installation/version.ts	packages/core/src/installation/version.ts
A	packages/core/src/npm-config.ts
R072	packages/opencode/src/npm/index.ts	packages/core/src/npm.ts
R100	packages/shared/src/util/array.ts	packages/core/src/util/array.ts
R100	packages/shared/src/util/binary.ts	packages/core/src/util/binary.ts
R100	packages/shared/src/util/effect-flock.ts	packages/core/src/util/effect-flock.ts
R100	packages/shared/src/util/encode.ts	packages/core/src/util/encode.ts
R100	packages/shared/src/util/error.ts	packages/core/src/util/error.ts
R100	packages/shared/src/util/flock.ts	packages/core/src/util/flock.ts
R100	packages/shared/src/util/glob.ts	packages/core/src/util/glob.ts
R100	packages/shared/src/util/hash.ts	packages/core/src/util/hash.ts
R100	packages/shared/src/util/identifier.ts	packages/core/src/util/identifier.ts
R100	packages/shared/src/util/iife.ts	packages/core/src/util/iife.ts
R100	packages/shared/src/util/lazy.ts	packages/core/src/util/lazy.ts
R098	packages/opencode/src/util/log.ts	packages/core/src/util/log.ts
R100	packages/shared/src/util/module.ts	packages/core/src/util/module.ts
R100	packages/opencode/src/util/opencode-process.ts	packages/core/src/util/opencode-process.ts
R100	packages/shared/src/util/path.ts	packages/core/src/util/path.ts
R100	packages/shared/src/util/retry.ts	packages/core/src/util/retry.ts
R100	packages/shared/src/util/slug.ts	packages/core/src/util/slug.ts
R100	packages/shared/sst-env.d.ts	packages/core/sst-env.d.ts
R096	packages/opencode/test/effect/cross-spawn-spawner.test.ts	packages/core/test/effect/cross-spawn-spawner.test.ts
R096	packages/opencode/test/effect/observability.test.ts	packages/core/test/effect/observability.test.ts
R099	packages/shared/test/filesystem/filesystem.test.ts	packages/core/test/filesystem/filesystem.test.ts
R088	packages/shared/test/fixture/effect-flock-worker.ts	packages/core/test/fixture/effect-flock-worker.ts
R096	packages/shared/test/fixture/flock-worker.ts	packages/core/test/fixture/flock-worker.ts
A	packages/core/test/fixture/tmpdir.ts
R087	packages/shared/test/kilocode/filesystem-containment.test.ts	packages/core/test/kilocode/filesystem-containment.test.ts
R100	packages/shared/test/lib/effect.ts	packages/core/test/lib/effect.ts
A	packages/core/test/npm-config.test.ts
A	packages/core/test/npm.test.ts
R098	packages/shared/test/util/effect-flock.test.ts	packages/core/test/util/effect-flock.test.ts
R098	packages/shared/test/util/flock.test.ts	packages/core/test/util/flock.test.ts
R100	packages/shared/tsconfig.json	packages/core/tsconfig.json
M	packages/extensions/zed/extension.toml
M	packages/kilo-docs/markdoc/partials/cli-commands-table.md
M	packages/kilo-docs/pages/code-with-ai/platforms/cli-reference.md
M	packages/opencode/.gitignore
A	packages/opencode/migration/20260428004200_add_session_path/migration.sql
A	packages/opencode/migration/20260428004200_add_session_path/snapshot.json
M	packages/opencode/package.json
M	packages/opencode/script/publish.ts
M	packages/opencode/script/schema.ts
M	packages/opencode/specs/effect/http-api.md
M	packages/opencode/src/account/repo.ts
M	packages/opencode/src/acp/agent.ts
M	packages/opencode/src/acp/session.ts
M	packages/opencode/src/agent/agent.ts
M	packages/opencode/src/auth/index.ts
M	packages/opencode/src/bus/index.ts
M	packages/opencode/src/cli/cmd/acp.ts
M	packages/opencode/src/cli/cmd/agent.ts
M	packages/opencode/src/cli/cmd/config.ts
M	packages/opencode/src/cli/cmd/db.ts
M	packages/opencode/src/cli/cmd/debug/agent.ts
M	packages/opencode/src/cli/cmd/debug/config.ts
M	packages/opencode/src/cli/cmd/debug/index.ts
M	packages/opencode/src/cli/cmd/debug/lsp.ts
M	packages/opencode/src/cli/cmd/debug/scrap.ts
A	packages/opencode/src/cli/cmd/debug/startup.ts
M	packages/opencode/src/cli/cmd/export.ts
M	packages/opencode/src/cli/cmd/generate.ts
M	packages/opencode/src/cli/cmd/github.ts
M	packages/opencode/src/cli/cmd/import.ts
M	packages/opencode/src/cli/cmd/mcp.ts
M	packages/opencode/src/cli/cmd/models.ts
M	packages/opencode/src/cli/cmd/plug.ts
M	packages/opencode/src/cli/cmd/pr.ts
M	packages/opencode/src/cli/cmd/providers.ts
M	packages/opencode/src/cli/cmd/run.ts
M	packages/opencode/src/cli/cmd/serve.ts
M	packages/opencode/src/cli/cmd/session.ts
M	packages/opencode/src/cli/cmd/stats.ts
M	packages/opencode/src/cli/cmd/tui/app.tsx
M	packages/opencode/src/cli/cmd/tui/component/dialog-go-upsell.tsx
M	packages/opencode/src/cli/cmd/tui/component/dialog-mcp.tsx
M	packages/opencode/src/cli/cmd/tui/component/dialog-model.tsx
M	packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx
M	packages/opencode/src/cli/cmd/tui/component/dialog-session-delete-failed.tsx
M	packages/opencode/src/cli/cmd/tui/component/dialog-session-list.tsx
M	packages/opencode/src/cli/cmd/tui/component/dialog-stash.tsx
M	packages/opencode/src/cli/cmd/tui/component/dialog-status.tsx
M	packages/opencode/src/cli/cmd/tui/component/dialog-workspace-create.tsx
M	packages/opencode/src/cli/cmd/tui/component/error-component.tsx
M	packages/opencode/src/cli/cmd/tui/component/prompt/autocomplete.tsx
M	packages/opencode/src/cli/cmd/tui/component/prompt/frecency.tsx
M	packages/opencode/src/cli/cmd/tui/component/prompt/history.tsx
M	packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx
M	packages/opencode/src/cli/cmd/tui/component/prompt/stash.tsx
M	packages/opencode/src/cli/cmd/tui/component/textarea-keybindings.ts
A	packages/opencode/src/cli/cmd/tui/component/use-connected.tsx
M	packages/opencode/src/cli/cmd/tui/config/tui-migrate.ts
M	packages/opencode/src/cli/cmd/tui/config/tui.ts
M	packages/opencode/src/cli/cmd/tui/context/directory.ts
A	packages/opencode/src/cli/cmd/tui/context/editor-zed.ts
M	packages/opencode/src/cli/cmd/tui/context/editor.ts
M	packages/opencode/src/cli/cmd/tui/context/keybind.tsx
M	packages/opencode/src/cli/cmd/tui/context/kv.tsx
M	packages/opencode/src/cli/cmd/tui/context/local.tsx
M	packages/opencode/src/cli/cmd/tui/context/sdk.tsx
M	packages/opencode/src/cli/cmd/tui/context/sync.tsx
M	packages/opencode/src/cli/cmd/tui/context/theme.tsx
M	packages/opencode/src/cli/cmd/tui/event.ts
M	packages/opencode/src/cli/cmd/tui/feature-plugins/home/footer.tsx
M	packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips-view.tsx
M	packages/opencode/src/cli/cmd/tui/feature-plugins/home/tips.tsx
M	packages/opencode/src/cli/cmd/tui/feature-plugins/sidebar/footer.tsx
M	packages/opencode/src/cli/cmd/tui/feature-plugins/system/plugins.tsx
M	packages/opencode/src/cli/cmd/tui/layer.ts
M	packages/opencode/src/cli/cmd/tui/plugin/api.tsx
D	packages/opencode/src/cli/cmd/tui/plugin/index.ts
M	packages/opencode/src/cli/cmd/tui/plugin/runtime.ts
M	packages/opencode/src/cli/cmd/tui/routes/home.tsx
M	packages/opencode/src/cli/cmd/tui/routes/session/dialog-fork-from-timeline.tsx
M	packages/opencode/src/cli/cmd/tui/routes/session/dialog-timeline.tsx
M	packages/opencode/src/cli/cmd/tui/routes/session/footer.tsx
M	packages/opencode/src/cli/cmd/tui/routes/session/index.tsx
M	packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx
M	packages/opencode/src/cli/cmd/tui/routes/session/sidebar.tsx
M	packages/opencode/src/cli/cmd/tui/routes/session/subagent-footer.tsx
M	packages/opencode/src/cli/cmd/tui/thread.ts
M	packages/opencode/src/cli/cmd/tui/ui/dialog-alert.tsx
M	packages/opencode/src/cli/cmd/tui/ui/dialog-confirm.tsx
M	packages/opencode/src/cli/cmd/tui/ui/dialog-export-options.tsx
M	packages/opencode/src/cli/cmd/tui/ui/dialog-help.tsx
M	packages/opencode/src/cli/cmd/tui/ui/dialog-prompt.tsx
M	packages/opencode/src/cli/cmd/tui/ui/dialog-select.tsx
M	packages/opencode/src/cli/cmd/tui/ui/dialog.tsx
M	packages/opencode/src/cli/cmd/tui/ui/toast.tsx
M	packages/opencode/src/cli/cmd/tui/util/clipboard.ts
M	packages/opencode/src/cli/cmd/tui/util/editor.ts
D	packages/opencode/src/cli/cmd/tui/util/index.ts
M	packages/opencode/src/cli/cmd/tui/util/selection.ts
M	packages/opencode/src/cli/cmd/tui/util/sound.ts
D	packages/opencode/src/cli/cmd/tui/util/terminal.ts
M	packages/opencode/src/cli/cmd/tui/util/transcript.ts
M	packages/opencode/src/cli/cmd/tui/worker.ts
M	packages/opencode/src/cli/cmd/uninstall.ts
M	packages/opencode/src/cli/cmd/upgrade.ts
M	packages/opencode/src/cli/cmd/web.ts
M	packages/opencode/src/cli/error.ts
M	packages/opencode/src/cli/heap.ts
M	packages/opencode/src/cli/network.ts
M	packages/opencode/src/cli/ui.ts
M	packages/opencode/src/cli/upgrade.ts
M	packages/opencode/src/command/index.ts
M	packages/opencode/src/config/agent.ts
M	packages/opencode/src/config/command.ts
M	packages/opencode/src/config/config.ts
M	packages/opencode/src/config/error.ts
D	packages/opencode/src/config/index.ts
M	packages/opencode/src/config/managed.ts
M	packages/opencode/src/config/markdown.ts
M	packages/opencode/src/config/parse.ts
M	packages/opencode/src/config/paths.ts
M	packages/opencode/src/config/permission.ts
M	packages/opencode/src/config/plugin.ts
M	packages/opencode/src/config/variable.ts
M	packages/opencode/src/control-plane/adaptors/worktree.ts
M	packages/opencode/src/control-plane/workspace-context.ts
M	packages/opencode/src/control-plane/workspace.ts
M	packages/opencode/src/effect/app-runtime.ts
M	packages/opencode/src/effect/bootstrap-runtime.ts
M	packages/opencode/src/effect/bridge.ts
D	packages/opencode/src/effect/index.ts
M	packages/opencode/src/effect/instance-state.ts
M	packages/opencode/src/effect/run-service.ts
M	packages/opencode/src/effect/runner.ts
M	packages/opencode/src/env/index.ts
M	packages/opencode/src/file/ignore.ts
M	packages/opencode/src/file/index.ts
M	packages/opencode/src/file/ripgrep.ts
M	packages/opencode/src/file/watcher.ts
M	packages/opencode/src/format/formatter.ts
M	packages/opencode/src/format/index.ts
M	packages/opencode/src/git/index.ts
M	packages/opencode/src/ide/index.ts
M	packages/opencode/src/index.ts
M	packages/opencode/src/installation/index.ts
M	packages/opencode/src/kilo-sessions/kilo-sessions.ts
M	packages/opencode/src/kilo-sessions/remote-sender.ts
M	packages/opencode/src/kilocode/agent/index.ts
M	packages/opencode/src/kilocode/bootstrap.ts
M	packages/opencode/src/kilocode/claw/client.ts
M	packages/opencode/src/kilocode/claw/hooks.ts
M	packages/opencode/src/kilocode/cli/heap-snapshot.ts
M	packages/opencode/src/kilocode/commands.ts
M	packages/opencode/src/kilocode/commit-message/generate.ts
M	packages/opencode/src/kilocode/config-injector.ts
M	packages/opencode/src/kilocode/config-validation.ts
M	packages/opencode/src/kilocode/config/config.ts
M	packages/opencode/src/kilocode/const.ts
M	packages/opencode/src/kilocode/enhance-prompt.ts
M	packages/opencode/src/kilocode/help.ts
M	packages/opencode/src/kilocode/ignore-migrator.ts
M	packages/opencode/src/kilocode/indexing.ts
M	packages/opencode/src/kilocode/kilo-errors.ts
M	packages/opencode/src/kilocode/lancedb.ts
M	packages/opencode/src/kilocode/mcp-migrator.ts
M	packages/opencode/src/kilocode/modes-migrator.ts
M	packages/opencode/src/kilocode/paths.ts
M	packages/opencode/src/kilocode/permission/config-paths.ts
M	packages/opencode/src/kilocode/permission/drain.ts
M	packages/opencode/src/kilocode/permission/routes.ts
M	packages/opencode/src/kilocode/plan-followup.ts
M	packages/opencode/src/kilocode/plugins/home-footer.tsx
M	packages/opencode/src/kilocode/plugins/sidebar-footer.tsx
M	packages/opencode/src/kilocode/plugins/sidebar-pr.tsx
M	packages/opencode/src/kilocode/project-id.ts
M	packages/opencode/src/kilocode/question/index.ts
M	packages/opencode/src/kilocode/review/review.ts
M	packages/opencode/src/kilocode/review/worktree-diff.ts
M	packages/opencode/src/kilocode/server/instance.ts
M	packages/opencode/src/kilocode/server/routes/commit-message.ts
M	packages/opencode/src/kilocode/session-import/service.ts
M	packages/opencode/src/kilocode/session/cost-propagation.ts
M	packages/opencode/src/kilocode/session/fork.ts
M	packages/opencode/src/kilocode/session/index.ts
M	packages/opencode/src/kilocode/session/processor.ts
M	packages/opencode/src/kilocode/session/prompt.ts
M	packages/opencode/src/kilocode/snapshot/diff-full.ts
M	packages/opencode/src/kilocode/suggestion/index.ts
M	packages/opencode/src/kilocode/suggestion/tool.ts
M	packages/opencode/src/kilocode/suggestion/tui/sync.ts
M	packages/opencode/src/kilocode/tool/registry.ts
M	packages/opencode/src/kilocode/tool/task.ts
M	packages/opencode/src/kilocode/ts-check.ts
M	packages/opencode/src/kilocode/ts-client.ts
M	packages/opencode/src/kilocode/workflows-migrator.ts
M	packages/opencode/src/kilocode/worktree-cleanup.ts
M	packages/opencode/src/kilocode/worktree-family.ts
M	packages/opencode/src/lsp/client.ts
D	packages/opencode/src/lsp/index.ts
M	packages/opencode/src/lsp/language.ts
M	packages/opencode/src/lsp/launch.ts
M	packages/opencode/src/lsp/lsp.ts
M	packages/opencode/src/lsp/server.ts
M	packages/opencode/src/mcp/auth.ts
M	packages/opencode/src/mcp/index.ts
M	packages/opencode/src/mcp/oauth-callback.ts
M	packages/opencode/src/mcp/oauth-provider.ts
M	packages/opencode/src/node.ts
D	packages/opencode/src/npm/config.ts
D	packages/opencode/src/npmcli-config.d.ts
M	packages/opencode/src/patch/index.ts
M	packages/opencode/src/permission/evaluate.ts
M	packages/opencode/src/permission/index.ts
M	packages/opencode/src/plugin/codex.ts
M	packages/opencode/src/plugin/github-copilot/copilot.ts
M	packages/opencode/src/plugin/index.ts
M	packages/opencode/src/plugin/install.ts
M	packages/opencode/src/plugin/loader.ts
M	packages/opencode/src/plugin/meta.ts
M	packages/opencode/src/plugin/shared.ts
M	packages/opencode/src/project/bootstrap.ts
D	packages/opencode/src/project/index.ts
M	packages/opencode/src/project/instance.ts
M	packages/opencode/src/project/project.ts
M	packages/opencode/src/project/vcs.ts
M	packages/opencode/src/provider/auth.ts
M	packages/opencode/src/provider/error.ts
D	packages/opencode/src/provider/index.ts
M	packages/opencode/src/provider/model-cache.ts
M	packages/opencode/src/provider/models.ts
M	packages/opencode/src/provider/provider.ts
D	packages/opencode/src/provider/sdk/copilot/index.ts
M	packages/opencode/src/provider/transform.ts
M	packages/opencode/src/pty/index.ts
M	packages/opencode/src/question/index.ts
M	packages/opencode/src/server/adapter.bun.ts
M	packages/opencode/src/server/adapter.node.ts
M	packages/opencode/src/server/adapter.ts
M	packages/opencode/src/server/error.ts
M	packages/opencode/src/server/fence.ts
M	packages/opencode/src/server/mdns.ts
M	packages/opencode/src/server/middleware.ts
M	packages/opencode/src/server/projectors.ts
M	packages/opencode/src/server/proxy.ts
M	packages/opencode/src/server/routes/control/index.ts
M	packages/opencode/src/server/routes/control/workspace.ts
M	packages/opencode/src/server/routes/global.ts
M	packages/opencode/src/server/routes/instance/config.ts
M	packages/opencode/src/server/routes/instance/event.ts
M	packages/opencode/src/server/routes/instance/experimental.ts
M	packages/opencode/src/server/routes/instance/file.ts
A	packages/opencode/src/server/routes/instance/httpapi/auth.ts
M	packages/opencode/src/server/routes/instance/httpapi/config.ts
A	packages/opencode/src/server/routes/instance/httpapi/control.ts
A	packages/opencode/src/server/routes/instance/httpapi/event.ts
A	packages/opencode/src/server/routes/instance/httpapi/experimental.ts
A	packages/opencode/src/server/routes/instance/httpapi/file.ts
A	packages/opencode/src/server/routes/instance/httpapi/global.ts
A	packages/opencode/src/server/routes/instance/httpapi/instance.ts
A	packages/opencode/src/server/routes/instance/httpapi/lifecycle.ts
A	packages/opencode/src/server/routes/instance/httpapi/mcp.ts
M	packages/opencode/src/server/routes/instance/httpapi/permission.ts
M	packages/opencode/src/server/routes/instance/httpapi/project.ts
M	packages/opencode/src/server/routes/instance/httpapi/provider.ts
A	packages/opencode/src/server/routes/instance/httpapi/pty.ts
A	packages/opencode/src/server/routes/instance/httpapi/public.ts
M	packages/opencode/src/server/routes/instance/httpapi/question.ts
M	packages/opencode/src/server/routes/instance/httpapi/server.ts
A	packages/opencode/src/server/routes/instance/httpapi/session.ts
A	packages/opencode/src/server/routes/instance/httpapi/sync.ts
A	packages/opencode/src/server/routes/instance/httpapi/tui.ts
M	packages/opencode/src/server/routes/instance/httpapi/workspace.ts
M	packages/opencode/src/server/routes/instance/index.ts
M	packages/opencode/src/server/routes/instance/mcp.ts
M	packages/opencode/src/server/routes/instance/middleware.ts
M	packages/opencode/src/server/routes/instance/permission.ts
M	packages/opencode/src/server/routes/instance/project.ts
M	packages/opencode/src/server/routes/instance/provider.ts
M	packages/opencode/src/server/routes/instance/pty.ts
M	packages/opencode/src/server/routes/instance/session.ts
M	packages/opencode/src/server/routes/instance/sync.ts
M	packages/opencode/src/server/routes/instance/tui.ts
M	packages/opencode/src/server/routes/ui.ts
M	packages/opencode/src/server/server.ts
M	packages/opencode/src/server/workspace.ts
M	packages/opencode/src/session/compaction.ts
D	packages/opencode/src/session/index.ts
M	packages/opencode/src/session/instruction.ts
M	packages/opencode/src/session/llm.ts
M	packages/opencode/src/session/message-v2.ts
M	packages/opencode/src/session/network.ts
M	packages/opencode/src/session/overflow.ts
M	packages/opencode/src/session/processor.ts
M	packages/opencode/src/session/projectors.ts
M	packages/opencode/src/session/prompt.ts
M	packages/opencode/src/session/retry.ts
M	packages/opencode/src/session/revert.ts
M	packages/opencode/src/session/run-state.ts
M	packages/opencode/src/session/session.sql.ts
M	packages/opencode/src/session/session.ts
M	packages/opencode/src/session/status.ts
M	packages/opencode/src/session/summary.ts
M	packages/opencode/src/session/system.ts
M	packages/opencode/src/session/todo.ts
D	packages/opencode/src/share/index.ts
M	packages/opencode/src/share/session.ts
M	packages/opencode/src/share/share-next.ts
M	packages/opencode/src/shell/shell.ts
M	packages/opencode/src/skill/discovery.ts
M	packages/opencode/src/skill/index.ts
M	packages/opencode/src/snapshot/index.ts
M	packages/opencode/src/storage/db.ts
D	packages/opencode/src/storage/index.ts
M	packages/opencode/src/storage/json-migration.ts
M	packages/opencode/src/storage/storage.ts
M	packages/opencode/src/sync/index.ts
M	packages/opencode/src/temporary.ts
M	packages/opencode/src/tool/apply_patch.ts
M	packages/opencode/src/tool/bash.ts
M	packages/opencode/src/tool/bash.txt
M	packages/opencode/src/tool/diagnostics.ts
M	packages/opencode/src/tool/edit.ts
M	packages/opencode/src/tool/external-directory.ts
M	packages/opencode/src/tool/glob.ts
M	packages/opencode/src/tool/grep.ts
D	packages/opencode/src/tool/index.ts
M	packages/opencode/src/tool/lsp.ts
M	packages/opencode/src/tool/lsp.txt
M	packages/opencode/src/tool/plan.ts
M	packages/opencode/src/tool/read.ts
M	packages/opencode/src/tool/recall.ts
M	packages/opencode/src/tool/registry.ts
M	packages/opencode/src/tool/task.ts
M	packages/opencode/src/tool/tool.ts
M	packages/opencode/src/tool/truncate.ts
M	packages/opencode/src/tool/truncation-dir.ts
M	packages/opencode/src/tool/write.ts
M	packages/opencode/src/util/archive.ts
M	packages/opencode/src/util/bom.ts
M	packages/opencode/src/util/color.ts
M	packages/opencode/src/util/filesystem.ts
D	packages/opencode/src/util/index.ts
M	packages/opencode/src/util/keybind.ts
M	packages/opencode/src/util/local-context.ts
M	packages/opencode/src/util/locale.ts
M	packages/opencode/src/util/lock.ts
M	packages/opencode/src/util/process.ts
M	packages/opencode/src/util/rpc.ts
M	packages/opencode/src/util/schema.ts
M	packages/opencode/src/util/token.ts
M	packages/opencode/src/util/which.ts
M	packages/opencode/src/util/wildcard.ts
M	packages/opencode/src/v2/session.ts
M	packages/opencode/src/worktree/index.ts
M	packages/opencode/test/account/repo.test.ts
M	packages/opencode/test/account/service.test.ts
M	packages/opencode/test/agent/agent.test.ts
M	packages/opencode/test/auth/auth.test.ts
M	packages/opencode/test/bus/bus-effect.test.ts
A	packages/opencode/test/cli/tui/editor-context.test.ts
M	packages/opencode/test/cli/tui/plugin-loader-entrypoint.test.ts
M	packages/opencode/test/cli/tui/plugin-loader.test.ts
M	packages/opencode/test/cli/tui/theme-store.test.ts
M	packages/opencode/test/cli/tui/thread.test.ts
M	packages/opencode/test/config/agent-color.test.ts
M	packages/opencode/test/config/config.test.ts
M	packages/opencode/test/config/markdown.test.ts
M	packages/opencode/test/config/tui.test.ts
M	packages/opencode/test/effect/app-runtime-logger.test.ts
M	packages/opencode/test/effect/instance-state.test.ts
M	packages/opencode/test/effect/runner.test.ts
M	packages/opencode/test/fake/provider.ts
M	packages/opencode/test/file/index.test.ts
M	packages/opencode/test/file/path-traversal.test.ts
M	packages/opencode/test/file/watcher.test.ts
M	packages/opencode/test/filesystem/filesystem.test.ts
M	packages/opencode/test/fixture/db.ts
M	packages/opencode/test/fixture/fixture.ts
M	packages/opencode/test/fixture/flock-worker.ts
M	packages/opencode/test/fixture/log-init-worker.ts
M	packages/opencode/test/fixture/plug-worker.ts
M	packages/opencode/test/format/format.test.ts
M	packages/opencode/test/installation/installation.test.ts
M	packages/opencode/test/keybind.test.ts
M	packages/opencode/test/kilocode/agent-global-config-dirs.test.ts
M	packages/opencode/test/kilocode/bash-permission-metadata.test.ts
M	packages/opencode/test/kilocode/bedrock-claude-empty-content.test.ts
M	packages/opencode/test/kilocode/cleanup.ts
M	packages/opencode/test/kilocode/commit-message/generate.test.ts
M	packages/opencode/test/kilocode/config-gitignore.test.ts
M	packages/opencode/test/kilocode/config-resilience.test.ts
M	packages/opencode/test/kilocode/config-validation.test.ts
M	packages/opencode/test/kilocode/config/indexing-default-plugin.test.ts
M	packages/opencode/test/kilocode/config/opentelemetry-default.test.ts
M	packages/opencode/test/kilocode/cost-propagation.test.ts
M	packages/opencode/test/kilocode/diff-full.test.ts
M	packages/opencode/test/kilocode/edit-permission-filediff.test.ts
M	packages/opencode/test/kilocode/external-directory-boundary.test.ts
M	packages/opencode/test/kilocode/indexing-startup.test.ts
M	packages/opencode/test/kilocode/indexing-worktree.test.ts
M	packages/opencode/test/kilocode/kilo-errors.test.ts
M	packages/opencode/test/kilocode/kilo-loader-auth.test.ts
M	packages/opencode/test/kilocode/lancedb-runtime.test.ts
M	packages/opencode/test/kilocode/local-model.test.ts
M	packages/opencode/test/kilocode/lsp-typescript-lightweight.test.ts
M	packages/opencode/test/kilocode/model-cache-org.test.ts
M	packages/opencode/test/kilocode/permission/config-paths.test.ts
M	packages/opencode/test/kilocode/permission/next.always-rules.test.ts
M	packages/opencode/test/kilocode/permission/next.reply-http.test.ts
M	packages/opencode/test/kilocode/permission/next.reply-routing.test.ts
M	packages/opencode/test/kilocode/plan-exit-detection.test.ts
M	packages/opencode/test/kilocode/plan-followup.test.ts
M	packages/opencode/test/kilocode/read-directory.test.ts
M	packages/opencode/test/kilocode/semantic-search.test.ts
M	packages/opencode/test/kilocode/server/permission-allow-everything.test.ts
M	packages/opencode/test/kilocode/session-compaction-cap.test.ts
M	packages/opencode/test/kilocode/session-fork-remap.test.ts
M	packages/opencode/test/kilocode/session-import-service.test.ts
M	packages/opencode/test/kilocode/session-list.test.ts
M	packages/opencode/test/kilocode/session-processor-empty-tool-calls.test.ts
M	packages/opencode/test/kilocode/session-processor-network-offline.test.ts
M	packages/opencode/test/kilocode/session-processor-retry-limit.test.ts
M	packages/opencode/test/kilocode/session-prompt-compaction-safety.test.ts
M	packages/opencode/test/kilocode/session-prompt-queue.test.ts
M	packages/opencode/test/kilocode/snapshot-cache.test.ts
M	packages/opencode/test/kilocode/snapshot-freeze-repro.test.ts
M	packages/opencode/test/kilocode/stats-subagent-cost.test.ts
M	packages/opencode/test/kilocode/suggestion/tool.test.ts
M	packages/opencode/test/kilocode/tool-encoding.test.ts
M	packages/opencode/test/kilocode/tool-registry-indexing.test.ts
M	packages/opencode/test/kilocode/tool-task-model.test.ts
M	packages/opencode/test/kilocode/transform-opus-4.7.test.ts
M	packages/opencode/test/kilocode/worktree-remove-lock.test.ts
M	packages/opencode/test/lsp/client.test.ts
M	packages/opencode/test/lsp/index.test.ts
M	packages/opencode/test/lsp/lifecycle.test.ts
D	packages/opencode/test/npm.test.ts
M	packages/opencode/test/permission-task.test.ts
M	packages/opencode/test/permission/next.test.ts
M	packages/opencode/test/plugin/auth-override.test.ts
M	packages/opencode/test/plugin/install-concurrency.test.ts
M	packages/opencode/test/plugin/install.test.ts
M	packages/opencode/test/plugin/loader-shared.test.ts
M	packages/opencode/test/plugin/meta.test.ts
M	packages/opencode/test/plugin/workspace-adaptor.test.ts
M	packages/opencode/test/preload.ts
M	packages/opencode/test/project/migrate-global.test.ts
M	packages/opencode/test/project/project.test.ts
M	packages/opencode/test/project/vcs.test.ts
M	packages/opencode/test/project/worktree-remove.test.ts
M	packages/opencode/test/project/worktree.test.ts
M	packages/opencode/test/provider/amazon-bedrock.test.ts
M	packages/opencode/test/provider/gitlab-duo.test.ts
M	packages/opencode/test/provider/provider.test.ts
M	packages/opencode/test/provider/transform.test.ts
M	packages/opencode/test/pty/pty-shell.test.ts
M	packages/opencode/test/server/experimental-session-list.test.ts
M	packages/opencode/test/server/global-session-list.test.ts
A	packages/opencode/test/server/httpapi-bridge.test.ts
A	packages/opencode/test/server/httpapi-config.test.ts
A	packages/opencode/test/server/httpapi-event.test.ts
A	packages/opencode/test/server/httpapi-experimental.test.ts
A	packages/opencode/test/server/httpapi-file.test.ts
A	packages/opencode/test/server/httpapi-instance.test.ts
A	packages/opencode/test/server/httpapi-json-parity.test.ts
A	packages/opencode/test/server/httpapi-mcp.test.ts
A	packages/opencode/test/server/httpapi-provider.test.ts
A	packages/opencode/test/server/httpapi-pty.test.ts
A	packages/opencode/test/server/httpapi-session.test.ts
A	packages/opencode/test/server/httpapi-sync.test.ts
A	packages/opencode/test/server/httpapi-tui.test.ts
M	packages/opencode/test/server/httpapi-workspace.test.ts
M	packages/opencode/test/server/project-init-git.test.ts
M	packages/opencode/test/server/session-actions.test.ts
M	packages/opencode/test/server/session-list.test.ts
M	packages/opencode/test/server/session-messages.test.ts
M	packages/opencode/test/server/session-select.test.ts
M	packages/opencode/test/session/compaction.test.ts
M	packages/opencode/test/session/instruction.test.ts
M	packages/opencode/test/session/llm.test.ts
M	packages/opencode/test/session/message-v2.test.ts
M	packages/opencode/test/session/messages-pagination.test.ts
M	packages/opencode/test/session/processor-effect.test.ts
M	packages/opencode/test/session/prompt.test.ts
M	packages/opencode/test/session/retry.test.ts
M	packages/opencode/test/session/revert-compact.test.ts
M	packages/opencode/test/session/schema-decoding.test.ts
A	packages/opencode/test/session/session-schema.test.ts
M	packages/opencode/test/session/session.test.ts
M	packages/opencode/test/session/snapshot-tool-race.test.ts
M	packages/opencode/test/session/structured-output-integration.test.ts
M	packages/opencode/test/share/share-next.test.ts
M	packages/opencode/test/shell/shell.test.ts
M	packages/opencode/test/skill/discovery.test.ts
M	packages/opencode/test/skill/skill.test.ts
M	packages/opencode/test/snapshot/snapshot.test.ts
M	packages/opencode/test/storage/db.test.ts
M	packages/opencode/test/storage/json-migration.test.ts
M	packages/opencode/test/storage/storage.test.ts
M	packages/opencode/test/sync/index.test.ts
M	packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap
M	packages/opencode/test/tool/apply_patch.test.ts
M	packages/opencode/test/tool/bash.test.ts
M	packages/opencode/test/tool/diagnostics-filter.test.ts
M	packages/opencode/test/tool/edit.test.ts
M	packages/opencode/test/tool/external-directory.test.ts
M	packages/opencode/test/tool/glob.test.ts
M	packages/opencode/test/tool/grep.test.ts
A	packages/opencode/test/tool/lsp.test.ts
M	packages/opencode/test/tool/question.test.ts
M	packages/opencode/test/tool/read.test.ts
M	packages/opencode/test/tool/recall.test.ts
M	packages/opencode/test/tool/registry.test.ts
M	packages/opencode/test/tool/skill.test.ts
M	packages/opencode/test/tool/task.test.ts
M	packages/opencode/test/tool/tool-define.test.ts
M	packages/opencode/test/tool/truncation.test.ts
M	packages/opencode/test/tool/webfetch.test.ts
M	packages/opencode/test/tool/write.test.ts
M	packages/opencode/test/util/filesystem.test.ts
M	packages/opencode/test/util/glob.test.ts
M	packages/opencode/test/util/lock.test.ts
M	packages/opencode/test/util/log.test.ts
M	packages/opencode/test/util/module.test.ts
M	packages/opencode/test/util/process.test.ts
M	packages/opencode/test/util/wildcard.test.ts
M	packages/opencode/test/workspace/workspace-restore.test.ts
M	packages/plugin/package.json
M	packages/script/tests/check-opencode-annotations.test.ts
M	packages/sdk/js/script/build.ts
M	packages/sdk/js/src/v2/gen/sdk.gen.ts
M	packages/sdk/js/src/v2/gen/types.gen.ts
M	packages/sdk/openapi.json
D	packages/shared/package.json
D	packages/shared/src/global.ts
D	packages/shared/src/types.d.ts
D	packages/shared/src/util/fn.ts
M	packages/ui/package.json
M	packages/ui/src/components/basic-tool.css
M	packages/ui/src/components/file.tsx
M	packages/ui/src/components/line-comment.tsx
M	packages/ui/src/components/markdown.tsx
M	packages/ui/src/components/message-part.css
M	packages/ui/src/components/message-part.tsx
M	packages/ui/src/components/session-review.tsx
M	packages/ui/src/components/session-turn.tsx
M	script/beta.ts
M	script/github/close-issues.ts
M	script/raw-changelog.ts
M	script/upstream/utils/report.ts
D	session.json
```
