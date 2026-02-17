# Agent Manager — Context for AI Agents

The Agent Manager is a Kilo Code feature that lets users run multiple independent AI coding sessions in parallel, each in its own editor tab panel. It is distinct from the regular sidebar chat.

## What It Is

The Agent Manager opens as an editor tab (not the sidebar). It has:

- A left sidebar listing all active agent sessions
- A "+ New Agent" button that starts a fresh session
- A right panel showing the full chat UI (ChatView) for the selected session

Each session is a standard `kilo serve` session, but the Agent Manager manages them as a group, allowing parallel workloads. Future versions will run each session in an isolated git worktree.

## Architecture

```
packages/kilo-vscode/
  src/
    agent-manager/
      AgentManagerProvider.ts   # VS Code panel + KiloProvider wiring
    KiloProvider.ts              # attachToWebview() added for panel use
    utils.ts                     # buildWebviewHtml(), getNonce() shared helpers
  webview-ui/
    agent-manager/
      index.tsx                  # SolidJS entry point
      AgentManagerApp.tsx        # Root component: sidebar + ChatView
      agent-manager.css          # Layout styles only (no component styles)
```

### Extension side

`AgentManagerProvider` opens a `WebviewPanel`, sets the HTML via `buildWebviewHtml()`, then calls `KiloProvider.attachToWebview()` to wire up message handling and SSE without overriding the HTML. The `KiloProvider` instance handles all session communication identical to the regular sidebar.

### Webview side

`AgentManagerApp.tsx` reuses the full provider chain from `webview-ui/src/App.tsx`. `LanguageBridge` and `DataBridge` are imported from `App.tsx` (exported there). The session list is a dedicated `<For>` loop — not the shared `SessionList` component — so it can be tuned independently. `ChatView` from the sidebar handles the full chat experience.

**Key design decision**: "+ New Agent" calls `session.clearCurrentSession()`. This causes `KiloProvider.handleSendMessage` to auto-create a fresh session on the next message send, giving each agent its own independent session ID.

## What Does NOT Exist Yet (Future Specs)

See the spec files in this directory for planned features. Current implementation is intentionally minimal — sessions share the workspace directory, no worktree isolation, no parallel versions.

## Reference: Old Agent Manager

The original Agent Manager lived in the old `kilocode` VS Code extension. Reference it at:
`kilocode/src/core/kilocode/agent-manager/`

Key files to study when porting features:

- `AgentManager.ts` — session lifecycle, worktree creation flow
- `WorktreeManager.ts` — all git worktree operations (simple-git)
- `SessionTerminalManager.ts` — VS Code terminal per worktree
- `AgentManagerPanel.ts` — old webview panel implementation
- `telemetry.ts` — PostHog events to port

The old implementation used a custom agent-runtime subprocess. The new implementation replaces that entirely with `kilo serve` sessions — do not port the subprocess model.

## Constraints

- No "Share" button — not implemented in the new cloud stack, skip entirely
- No "Refresh" button — session list is SSE-driven and always current, not needed
- Worktree features only activate inside the Agent Manager, not in the regular sidebar sessions (for now)
- All new webview code must use `@kilocode/kilo-ui` components, not raw HTML with inline styles
- CSS in `agent-manager.css` should be layout/structural only; component styling comes from kilo-ui
