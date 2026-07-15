# Config Regression Review: PR #12204, Second Pass

Audited PR HEAD `2d92d8dae2cb2d9efc4961b020dabb11ff5564aa` against merge base `19bd048e21464f69b45e0d7a27c98a77037ebb08`.

## Findings

### High: local references now resolve relative to the config directory

Before this PR, TUI reference paths were resolved relative to the worktree. The V2 reference plugin uses `dirname(document.path)` in `packages/core/src/config/plugin/reference.ts`, so `./docs` declared in `.kilo/kilo.json` now resolves to `.kilo/docs` rather than `<repo>/docs`. The same regression applies to `.kilocode`.

Preserve Kilo's workspace-relative semantics or explicitly migrate them, with endpoint tests for references declared in both Kilo config directories.

### High: V2 reference discovery does not represent effective Kilo config

The repaired V2 scanner now recognizes `kilo.json`, `.kilo`, and `.kilocode` and ignores `.opencode`, but it remains independent from Kilo's stable effective loader. It omits or misorders sources including `KILO_CONFIG`, `KILO_CONFIG_CONTENT`, managed and account config, home-level Kilo directories, linked-worktree primary config, `KILO_DISABLE_PROJECT_CONFIG`, and `KILO_CONFIG_DIR` precedence.

References can therefore disappear from TUI autocomplete, project references can appear while project config is disabled, and project aliases can override explicit-profile aliases contrary to stable-loader precedence. Build V2 references from the stable effective config or add full parity coverage for sources, disable flags, linked worktrees, and precedence.

### Medium: non-interactive `mcp add` ignores `KILO_CONFIG_DIR`

`packages/opencode/src/cli/cmd/mcp.ts:523` writes via static `Global.Path.config`, not the active profile directory. With `KILO_CONFIG_DIR`, the command can report success after writing an ineffective default config. Resolve the target from the active global service and add a profile-path subprocess test.

## Resolved Since First Pass

- V2 ordinary filesystem discovery no longer reads `.opencode` and now orders `.kilo` over `.kilocode`.
- MCP subprocess tests now assert `~/.config/kilo/kilo.json` instead of the obsolete OpenCode path.

## Notable Non-Findings

The stable CLI loader still does not read `.opencode` directories. Compatible `opencode.json/jsonc` filenames remain limited to accepted Kilo roots. TUI config and theme discovery remain Kilo-only, and `.opencode` detection is migration notification logic rather than fallback loading.

This was a read-only Git-object audit. Target tests were inspected but not executed locally; current required CI passes.
