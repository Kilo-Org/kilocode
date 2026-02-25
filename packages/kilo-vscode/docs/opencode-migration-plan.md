# Feature Parity Plan — Kilo Code VS Code Extension (Rebuild)

## Overview

This extension is a **ground-up rebuild** of the [old Kilo Code extension](https://github.com/Kilo-Org/kilocode-legacy) using Kilo CLI as the backend. Rather than migrating the old extension's codebase, we started fresh with a Solid.js webview, a CLI server manager, and a message-based protocol between extension host and webview. This new extension lives in the [kilocode monorepo](https://github.com/Kilo-Org/kilocode/tree/main/packages/kilo-vscode).

This document tracks remaining work needed for feature parity with the old extension. Each feature links to its detailed parity requirement doc. Features sourced from the [GitHub project board](https://github.com/orgs/Kilo-Org/projects/25/views/1) include issue links.

---

## Chat UI Feature Parity

| Feature                                                                        | Status         | Remaining Work                                                                             | Backend                                                | Priority |
| ------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------- |
| [Browser Session Controls](chat-ui-features/browser-session-controls.md)       | 🔨 Partial     | In-chat browser controls, action replay, screenshot viewing                                | CLI-side (if browser tool exists) + webview            | P3       |
| [Checkpoint & Task Management](chat-ui-features/checkpoint-task-management.md) | ❌ Not started | Checkpoint restore, navigation, "See New Changes" diff buttons                             | CLI session undo/redo/fork + extension git integration | P1       |
| [Connection State UI](chat-ui-features/connection-state-ui.md)                 | 🔨 Partial     | Loading spinner overlay, error panel with retry, reconnecting indicator                    | Webview-only (consumes connection state)               | P0       |
| [Mermaid Diagram Features](chat-ui-features/mermaid-diagram-features.md)       | ❌ Not started | Mermaid rendering, "Fix with AI" button, copy, open-as-PNG                                 | Webview-only (rendering); CLI for "Fix with AI"        | P2       |
| [Message Editing & Management](chat-ui-features/message-editing-management.md) | ❌ Not started | Inline editing, deletion, timestamp display, redo-previous-message (up-arrow)              | CLI session fork/undo for edit semantics               | P1       |
| [Special Content Types](chat-ui-features/special-content-types.md)             | 🔨 Partial     | Copy button on error cards, dedicated MCP tool/resource rows, open-markdown-preview button | Mixed: CLI for MCP data; webview for rendering         | P1       |

---

## Non-Agent Feature Parity

| Feature                                                                                                 | Status         | Remaining Work                                                                                    | Backend                                                              | Priority |
| ------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| [Authentication & Enterprise](non-agent-features/authentication-organization-enterprise-enforcement.md) | 🔨 Partial     | Org feature flags, MDM policy enforcement                                                         | CLI handles its auth; extension handles org/MDM                      | P1       |
| [Auto-Purge](non-agent-features/auto-purge.md)                                                          | ❌ Not started | Scheduled cleanup of old session/task storage                                                     | Extension-side (storage ownership TBD)                               | P3       |
| [Cloud Task Support](non-agent-features/cloud-task-support.md)                                          | 🔨 Partial     | Upload local sessions to cloud, real-time sync, conflict resolution                               | Kilo cloud API + CLI; extension provides UI                          | P2       |
| [Code Actions & Editor Menus](non-agent-features/editor-context-menus-and-code-actions.md)              | 🔨 Partial     | Terminal content capture (shell integration API), custom prompt overrides via settings            | Extension-side (VS Code CodeActionProvider + menus + keybindings)    | P1       |
| [Code Reviews](non-agent-features/code-reviews.md)                                                      | ❌ Not started | Local review mode, automated AI review of uncommitted/branch changes                              | CLI (partial); extension for VS Code review UX                       | P2       |
| [Codebase Indexing & Semantic Search](non-agent-features/codebase-indexing-semantic-search.md)          | ❌ Not started | Vector indexing, semantic search, embeddings infrastructure                                       | CLI has grep/glob endpoints; semantic indexing is extension or cloud | P2       |
| [Contribution Tracking](non-agent-features/contribution-tracking.md)                                    | ❌ Not started | AI attribution tracking, line fingerprinting, reporting                                           | Extension-side                                                       | P3       |
| [Custom Commands](non-agent-features/custom-command-system.md)                                          | ❌ Not started | Slash command system, project-level command discovery, YAML frontmatter support                   | CLI has custom commands; extension provides UI entry points          | P2       |
| [Marketplace](non-agent-features/marketplace.md)                                                        | ❌ Not started | Catalog, install, update capabilities (toolbar button exists but renders a stub)                  | Extension-side                                                       | P2       |
| [MCP & MCP Hub](non-agent-features/mcp-and-mcp-hub.md)                                                  | 🔨 Partial     | MCP configuration UI (add/edit/delete servers), tool allowlisting, connection status display      | CLI owns MCP lifecycle; extension provides config UI                 | P1       |
| [Repository Initialization](non-agent-features/repository-initialization.md)                            | ❌ Not started | /init command support for setting up agentic engineering                                          | CLI /init endpoint; extension provides UI trigger                    | P3       |
| [Rules & Workflows](non-agent-features/rules-and-workflows.md)                                          | 🔨 Partial     | Workflow management UI (rules subtab exists, workflows subtab is a stub)                          | CLI owns rules runtime; extension provides management UI             | P3       |
| [Settings Sync](non-agent-features/settings-sync-integration.md)                                        | ❌ Not started | VS Code Settings Sync allowlist registration                                                      | Extension-side (VS Code API)                                         | P3       |
| [Settings UI](non-agent-features/settings-ui.md)                                                        | 🔨 Partial     | Terminal and Prompts tabs (show "Not implemented"), Workflows subtab stub, import/export settings | CLI exposes config; extension provides settings forms                | P1       |
| [Skills System](non-agent-features/skills-system.md)                                                    | 🔨 Partial     | Skill execution, discovery, hot-reload (config UI for paths/URLs exists)                          | CLI has skills runtime; extension provides packaging/UI              | P2       |
| [Speech-to-Text](non-agent-features/speech-to-text.md)                                                  | ❌ Not started | Voice input, streaming STT                                                                        | Webview (mic capture); CLI-compatible STT optional                   | P3       |

---

## Infrastructure & Robustness

These items were identified from the [JetBrains plugin analysis](../LESSONS_LEARNED_JETBRAINS.md) — patterns the JetBrains plugin implements that are missing in the VSCode extension. They primarily affect reliability and developer experience rather than feature parity.

| Feature                                                                    | Status         | Remaining Work                                                                                                                                 | Scope                                     | Priority |
| -------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------- |
| [SSE Auto-Reconnect](infrastructure/sse-auto-reconnect.md)                 | ❌ Not started | Reconnect logic, exponential backoff, "reconnecting" state                                                                                     | Extension (SSEClient + ConnectionService) | P0       |
| [HTTP Request Timeouts](infrastructure/http-request-timeouts.md)           | ❌ Not started | AbortController with timeout in HttpClient.request()                                                                                           | Extension (HttpClient)                    | P1       |
| [VSCode Error Notifications](infrastructure/vscode-error-notifications.md) | 🔨 Partial     | Error notifications for core connection failures (CLI start, SSE disconnect, HTTP errors). Peripheral services already use showErrorMessage(). | Extension (KiloProvider)                  | P1       |
| [Dedicated Output Channel](infrastructure/dedicated-output-channel.md)     | 🔨 Partial     | General "Kilo Code" output channel (Agent Manager has its own already). Centralized logging utility.                                           | Extension (new logger utility)            | P2       |

---

## Pre-Production Checklist

Before publishing this extension to the VS Code Marketplace or deploying to users, verify every item below.

### Security

- [ ] **Review and tighten CSP** — The current policy in [`KiloProvider._getHtmlForWebview()`](../src/KiloProvider.ts:829) has several areas to audit:
  - `style-src 'unsafe-inline'` is broadly permissive — investigate whether nonce-based style loading is feasible now that kilo-ui styles are bundled
  - `connect-src http://127.0.0.1:* http://localhost:*` allows connections to _any_ localhost port — tighten to the actual CLI server port once known at runtime
  - `img-src … https:` allows images from any HTTPS origin — scope to `${webview.cspSource} data:` unless external images are explicitly needed
  - `'wasm-unsafe-eval'` in `script-src` was added for shiki — confirm it is still required and document the reason
  - `ws://` connections to any localhost port — same concern as `connect-src`
- [ ] **Validate `openExternal` URLs** — The [`openExternal` handler](../src/KiloProvider.ts:186) passes any URL from the webview directly to `vscode.env.openExternal()` with no allowlist or scheme check. Restrict to `https:` (and possibly `vscode:`) schemes, or allowlist specific hosts
- [ ] **Audit credential storage** — CLI stores credentials as plaintext JSON with `chmod 0600`. Evaluate whether VS Code's `SecretStorage` API should be used for extension-side secrets, and document the threat model for CLI-managed credentials
- [ ] **Audit workspace path containment** — CLI's path traversal checks are lexical only; symlinks and Windows cross-drive paths can escape the workspace boundary. Determine if additional hardening (realpath canonicalization) is needed before production

### Reliability

- [ ] **VS Code error notifications** — Critical errors (CLI missing, server crash, connection lost) are only shown inside the webview ([details](infrastructure/vscode-error-notifications.md)). Users get no feedback if the webview is hidden
- [ ] **Connection state UI** — No loading spinner, error panel, or reconnecting indicator in the webview ([details](chat-ui-features/connection-state-ui.md)). Chat renders even when disconnected

### Testing

- [ ] **Test coverage** — Only one test file exists ([`extension.test.ts`](../src/test/extension.test.ts)). Add integration tests for: server lifecycle, SSE event routing, message send/receive, permission flow, session management
- [ ] **Multi-theme visual check** — Verify the webview renders correctly in at least one light theme, one dark theme, and one high-contrast theme
- [ ] **Multi-platform smoke test** — Test on macOS, Windows, and Linux. Particularly: CLI binary provisioning, path handling, `chmod`-based credential protection on Windows

### Packaging & Marketplace

- [ ] **Bundle size audit** — With kilo-ui and its transitive dependencies (shiki, marked, katex, dompurify, etc.) now bundled, measure `dist/webview.js` size and verify the total `.vsix` package size is acceptable
- [ ] **`.vscodeignore` review** — Ensure only necessary files are included in the package (no `docs/`, `src/`, test artifacts, or development scripts)
- [ ] **Marketplace metadata** — Verify [`README.md`](../README.md), [`CHANGELOG.md`](../CHANGELOG.md), publisher name, extension icon, and [`package.json`](../package.json) fields (`displayName`, `description`, `categories`, `keywords`, `repository`) are production-ready
- [ ] **`activationEvents` review** — Confirm the extension only activates when needed (not `*`), to avoid impacting VS Code startup time
- [ ] **Minimum VS Code version** — Verify `engines.vscode` in [`package.json`](../package.json) matches the minimum API features actually used

### Logging & Observability

- [ ] **Dedicated output channel** — All logging currently goes to `console.log` mixed with other extensions ([details](infrastructure/dedicated-output-channel.md)). Create a dedicated "Kilo Code" output channel before production
- [ ] **Remove or guard verbose logging** — Many `console.log` calls with emojis and debug detail exist in [`KiloProvider.ts`](../src/KiloProvider.ts). Gate behind a debug flag or move to the output channel at appropriate log levels

---

## Implementation Notes

### Architecture

- **Solid.js** (not React) powers the webview. JSX compiles via `esbuild-plugin-solid`. All webview components use Solid's reactive primitives (signals, createEffect, etc.).
- **Two separate esbuild builds**: extension (Node/CJS) and webview (browser/IIFE), configured in [`esbuild.js`](../esbuild.js).
- **No shared state** between extension and webview. All communication is via `vscode.Webview.postMessage()` with typed messages defined in [`messages.ts`](../webview-ui/src/types/messages.ts). Provider hierarchy: `ThemeProvider → DialogProvider → VSCodeProvider → ServerProvider → LanguageBridge → MarkedProvider → ProviderProvider → SessionProvider → DataBridge`.
- **CLI backend owns**: agent orchestration, MCP lifecycle, tool execution, search/grep/glob, session storage, permissions runtime, custom commands, skills, and fast edits.
- **Extension owns**: VS Code API integrations (code actions, inline completions, terminal, SCM, settings sync), webview rendering, auth mediation, and any feature not supported by CLI.

### kilo-ui Shared Library

- **kilo-ui shared library**: The webview now heavily uses `@kilocode/kilo-ui` for UI components. A `DataBridge` component in App.tsx adapts the session store to kilo-ui's `DataProvider` expected shape, enabling shared components like `<KiloMessage>` to work with the extension's data model.

### Key Differences from Old Extension

- No `Task.ts` or `webviewMessageHandler.ts` — the CLI server replaces the old in-process agent loop.
- Permissions flow through CLI's ask/reply model, not extension-side approval queues. Permissions are rendered through kilo-ui's DataProvider pattern, not a standalone PermissionDialog.
- Session history is CLI-managed, not stored in VS Code global state.
- MCP servers are configured and managed by the CLI, not the extension.
