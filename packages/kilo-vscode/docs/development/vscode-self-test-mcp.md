# Self-test

Run quick, real VS Code checks against an isolated extension instance.

## Understand it

The self-test stack lives in `packages/kilo-vscode/script/self-test/`.

- `cli.mjs` handles lifecycle commands
- `daemon.mjs` owns one isolated VS Code instance per worktree
- `mcp.mjs` exposes agent-facing tools with inline screenshots
- `engine-mcp.mjs` is the internal Playwright engine
- `common.mjs` holds shared helpers

Use the CLI for lifecycle. Use MCP for interaction.

## Follow the lifecycle

Each worktree gets its own daemon and isolated VS Code session.

The daemon keeps running until you stop it explicitly, even if the agent or CLI process is interrupted.

Main commands:

```bash
bun run --cwd packages/kilo-vscode self-test start
bun run --cwd packages/kilo-vscode self-test status
bun run --cwd packages/kilo-vscode self-test launch-vscode --mode dev --build true
bun run --cwd packages/kilo-vscode self-test stop-vscode
bun run --cwd packages/kilo-vscode self-test stop
```

Use `start` once per worktree, then `launch-vscode` when you want a fresh window.

If VS Code is installed in a non-standard location, or you are testing on Linux or Windows, pass `--app-path` or set `VSCODE_EXEC_PATH` before launching.

The `code` shell command is only required for `vsix` mode, where the workflow installs a packaged extension into the isolated profile.

## Use the workflow

Keep the flow simple.

1. Start the daemon
2. Launch VS Code
3. Use MCP tools to open the target UI
4. Interact with generic click, type, press, and wait actions
5. Observe with screenshots often
6. Stop only when the session is no longer needed

Prefer MCP for UI work because screenshot results come back inline and are easier to inspect than file-based output.

## Use the tools

CLI lifecycle commands:

- `start`
- `status`
- `launch-vscode`
- `stop-vscode`
- `stop`

MCP quick openers:

- `open-kilo`
- `open-agent-manager`
- `open-kilo-settings`

MCP testing tools:

- `vscode-observe`
- `vscode-click`
- `vscode-type`
- `vscode-press`
- `vscode-wait`
- `vscode-screenshot`

MCP debug tools:

- `vscode-console`
- `vscode-logs`
- `vscode-evaluate`
- `vscode-frames`

Secondary MCP tools:

- `daemon-status`
- `launch-vscode`
- `stop-vscode`
- `stop-daemon`
- `vscode-state`
- `vscode-snapshot`
- `vscode-move`
- `vscode-scroll`
- `vscode-run-command`

Favor generic interactions over custom flows.

## Reuse the recipe

This pattern is enough for most Agent Manager checks.

1. Run `open-agent-manager`
2. Confirm the view with `vscode-observe`
3. Click the input
4. Type a prompt
5. Click send or press Enter
6. Wait for the session UI to update
7. Capture another screenshot

Proven selectors:

```css
a[aria-label="Kilo Code (NEW)"]
a[aria-label="Agent Manager (⇧⌘M)"]
textarea[placeholder*="Type a message"]
[aria-label="Send"]
```

This generic click/type/wait loop is enough to verify end-to-end Agent Manager messaging.

## Debug it

Start with `vscode-observe` when the UI state is unclear.

Use the rest when needed:

- `vscode-console` for browser and webview errors
- `vscode-logs` for VS Code-side logs
- `vscode-evaluate` for targeted DOM inspection
- `vscode-frames` for workbench and webview frame discovery

If text snapshots are sparse, trust screenshots first.

## Respect limits

This is a manual self-test harness, not an assertions-first test runner.

Webview text can be incomplete, selectors may still be more reliable than text, and `vsix` checks still depend on local package and install steps working correctly.
