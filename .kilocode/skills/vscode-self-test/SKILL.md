---
name: vscode-self-test
description: Test extension flows end to end in VS Code
---

Use this skill when you need to verify a VS Code extension feature in `packages/kilo-vscode/` from the real UI.

Prefer the self-test MCP bridge for interactions because screenshots come back inline and make fast iteration easier.

---

# Build first

Build the extension before testing when your changes affect the packaged extension, webview code, commands, or startup behavior.

Use the repo's normal build flow for `packages/kilo-vscode/`, then start or restart the self-test stack if needed.

---

# Start the stack

The self-test daemon is per-worktree and keeps one isolated VS Code instance alive until you stop it.

Use the CLI entrypoint for lifecycle control:

```bash
bun run --cwd packages/kilo-vscode self-test start
bun run --cwd packages/kilo-vscode self-test status
bun run --cwd packages/kilo-vscode self-test launch-vscode
bun run --cwd packages/kilo-vscode self-test stop-vscode
bun run --cwd packages/kilo-vscode self-test stop
```

If VS Code is not in a standard macOS install location, or you are running on Linux or Windows, pass `--app-path` or set `VSCODE_EXEC_PATH` before launching.

The `code` shell command is only required for `vsix` mode.

Use the MCP bridge for agent-facing control:

```bash
bun run --cwd packages/kilo-vscode mcp:self-test -- --self-check
```

Architecture reference:

- `cli.mjs` controls lifecycle
- `daemon.mjs` owns the isolated VS Code instance
- `mcp.mjs` is the agent-facing bridge
- `engine-mcp.mjs` runs the Playwright-backed engine
- `common.mjs` has shared helpers

---

# Prefer generic actions

Favor generic interactions over bespoke helpers.

The main tool set is enough for most end-to-end checks:

- MCP lifecycle: `daemon-status`, `launch-vscode`, `stop-vscode`, `stop-daemon`
- Quick openers: `open-kilo`, `open-agent-manager`, `open-kilo-settings`
- Core actions: `vscode-observe`, `vscode-click`, `vscode-type`, `vscode-press`, `vscode-wait`, `vscode-screenshot`
- Debug tools: `vscode-console`, `vscode-logs`, `vscode-evaluate`, `vscode-frames`

Secondary tools are still available when needed:

- `vscode-state` for quick session metadata
- `vscode-snapshot` for text-only inspection
- `vscode-move` and `vscode-scroll` for pointer-heavy flows
- `vscode-run-command` for command-palette entrypoints

Reach for feature-specific helpers only if generic click/type/wait cannot cover the flow.

---

# Follow the loop

Use a tight observe -> act -> verify loop.

Recommended pattern:

1. Open the right surface with an MCP quick opener
2. Capture a screenshot before the change
3. Use `vscode-observe` to inspect the current DOM and accessible labels
4. Interact with `vscode-click`, `vscode-type`, `vscode-press`, and `vscode-wait`
5. Capture a screenshot after the change
6. Inspect console or logs if behavior is unclear

Always keep screenshot evidence for visual changes.

---

# Use quick openers

Use MCP quick openers instead of navigating manually when possible.

Common starting points:

- `open-kilo`
- `open-agent-manager`
- `open-kilo-settings`

These are the fastest path into the extension UI before switching back to generic interactions.

---

# Reuse proven selectors

These selectors are already proven useful:

- Kilo activity bar icon: `a[aria-label="Kilo Code (NEW)"]`
- Agent Manager button: `a[aria-label="Agent Manager (⇧⌘M)"]`
- Agent Manager textarea: `textarea[placeholder*="Type a message"]`
- Send button: `[aria-label="Send"]`

Start with these, then refine with `vscode-observe` if labels or layout differ.

---

# Debug deliberately

If the UI does not react as expected, do not guess.

Use:

- `vscode-console` for runtime errors and warnings
- `vscode-logs` for extension and test-stack logs
- `vscode-evaluate` for targeted DOM checks
- `vscode-frames` when the visible UI may live in another frame or webview

When behavior is flaky or ambiguous, capture screenshots before and after each step so the failure point is obvious.

---

# Exercise Agent Manager

This is a proven generic end-to-end recipe for Agent Manager.

1. Open Kilo or click `a[aria-label="Kilo Code (NEW)"]`
2. Open Agent Manager with `open-agent-manager` or click `a[aria-label="Agent Manager (⇧⌘M)"]`
3. Capture a screenshot
4. Focus `textarea[placeholder*="Type a message"]`
5. Type a short prompt with `vscode-type`
6. Click `[aria-label="Send"]` or press Enter if the UI supports it
7. Wait for visible response state with `vscode-wait`
8. Capture another screenshot
9. Check console or logs if the result is missing or confusing

This generic flow is preferred over custom Agent Manager helpers.

---

# Keep scope practical

The goal is to validate real user behavior without overengineering the test.

Open the surface, interact like a user, collect screenshot evidence, and use logs only when the UI stops being self-explanatory.
