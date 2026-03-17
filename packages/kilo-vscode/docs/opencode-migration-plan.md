# Feature Parity Plan — Kilo Code VS Code Extension (Rebuild)

## Overview

This extension is a **ground-up rebuild** of the [old Kilo Code extension](https://github.com/Kilo-Org/kilocode-legacy) using Kilo CLI as the backend. Rather than migrating the old extension's codebase, we started fresh with a Solid.js webview, a CLI server manager, and a message-based protocol between extension host and webview. This new extension lives in the [kilocode monorepo](https://github.com/Kilo-Org/kilocode/tree/main/packages/kilo-vscode).

This document tracks remaining work needed for feature parity with the old extension. Each feature links to its detailed parity requirement doc. Features sourced from the [GitHub project board](https://github.com/orgs/Kilo-Org/projects/25/views/1) include issue links.

---

## Chat UI Feature Parity

| Feature                                                                        | Remaining Work                                                                             | Backend                                                | Priority |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------- |
| [Browser Session Controls](chat-ui-features/browser-session-controls.md)       | In-chat browser controls, action replay, screenshot viewing                                | CLI-side (if browser tool exists) + webview            | P3       |
| [Checkpoint & Task Management](chat-ui-features/checkpoint-task-management.md) | Checkpoint restore UI, navigation, diff viewing, "See New Changes" buttons                 | CLI session undo/redo/fork + extension git integration | P1       |
| [Mermaid Diagram Features](chat-ui-features/mermaid-diagram-features.md)       | Mermaid rendering, "Fix with AI" button, copy, open-as-PNG                                 | Webview-only (rendering); CLI for "Fix with AI"        | P2       |
| [Message Editing & Management](chat-ui-features/message-editing-management.md) | Inline editing, deletion, timestamp display, redo-previous-message (up-arrow)              | CLI session fork/undo for edit semantics               | P1       |
| [Special Content Types](chat-ui-features/special-content-types.md)             | Copy button on error cards, dedicated MCP tool/resource rows, open-markdown-preview button | Mixed: CLI for MCP data; webview for rendering         | P1       |

---

## Non-Agent Feature Parity

| Feature                                                                                                 | Remaining Work                                                                                    | Backend                                                              | Priority |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------- |
| [Authentication & Enterprise](non-agent-features/authentication-organization-enterprise-enforcement.md) | Org feature flags, MDM policy enforcement                                                         | CLI handles its auth; extension handles org/MDM                      | P1       |
| [Auto-Purge](non-agent-features/auto-purge.md)                                                          | Scheduled cleanup of old session/task storage                                                     | Extension-side (storage ownership TBD)                               | P3       |
| [Cloud Task Support](non-agent-features/cloud-task-support.md)                                          | Upload local sessions to cloud, real-time sync, conflict resolution                               | Kilo cloud API + CLI; extension provides UI                          | P2       |
| [Code Reviews](non-agent-features/code-reviews.md)                                                      | Local review mode, automated AI review of uncommitted/branch changes                              | CLI (partial); extension for VS Code review UX                       | P2       |
| [Codebase Indexing & Semantic Search](non-agent-features/codebase-indexing-semantic-search.md)          | Vector indexing, semantic search, embeddings infrastructure                                       | CLI has grep/glob endpoints; semantic indexing is extension or cloud | P2       |
| [Contribution Tracking](non-agent-features/contribution-tracking.md)                                    | AI attribution tracking, line fingerprinting, reporting                                           | Extension-side                                                       | P3       |
| [Custom Commands](non-agent-features/custom-command-system.md)                                          | Slash command system, project-level command discovery, YAML frontmatter support                   | CLI has custom commands; extension provides UI entry points          | P2       |
| [Marketplace](non-agent-features/marketplace.md)                                                        | Catalog, install, update capabilities (toolbar button exists but renders a stub)                  | Extension-side                                                       | P2       |
| [MCP & MCP Hub](non-agent-features/mcp-and-mcp-hub.md)                                                  | MCP configuration UI (add/edit/delete servers), tool allowlisting, connection status display      | CLI owns MCP lifecycle; extension provides config UI                 | P1       |
| [Repository Initialization](non-agent-features/repository-initialization.md)                            | /init command support for setting up agentic engineering                                          | CLI /init endpoint; extension provides UI trigger                    | P3       |
| [Rules & Workflows](non-agent-features/rules-and-workflows.md)                                          | Workflow management UI (rules subtab exists, workflows subtab is a stub)                          | CLI owns rules runtime; extension provides management UI             | P3       |
| [Settings Sync](non-agent-features/settings-sync-integration.md)                                        | VS Code Settings Sync allowlist registration                                                      | Extension-side (VS Code API)                                         | P3       |
| [Settings UI](non-agent-features/settings-ui.md)                                                        | Terminal and Prompts tabs (show "Not implemented"), Workflows subtab stub, import/export settings | CLI exposes config; extension provides settings forms                | P1       |
| [Skills System](non-agent-features/skills-system.md)                                                    | Skill execution, discovery, hot-reload (config UI for paths/URLs exists)                          | CLI has skills runtime; extension provides packaging/UI              | P2       |
| [Speech-to-Text](non-agent-features/speech-to-text.md)                                                  | Voice input, streaming STT                                                                        | Webview (mic capture); CLI-compatible STT optional                   | P3       |

---

## Project Board Issues

Open issues from the [GitHub project board](https://github.com/orgs/Kilo-Org/projects/25/views/1) not covered by the feature docs above. Each item has its own detailed doc.

### UI Polish & Bugs

| Feature                                                                                  | Remaining Work                                                                        | Priority |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| [Markdown Rendering Improvements](ui-polish/markdown-rendering-improvements.md)          | Add CSS for heading sizes, weights, spacing so headings look different from body text | P1       |
| [Approval Box Missing Full Path](ui-polish/approval-box-full-path.md)                    | Always show full absolute path for out-of-workspace permission requests               | P1       |
| [Profile View Missing Back Button](ui-polish/profile-view-back-button.md)                | Add back button to Profile view header matching Settings view pattern                 | P2       |
| [Chat Input Overflow on Narrow Sidebar](ui-polish/chat-input-narrow-sidebar-overflow.md) | Make chat input toolbar wrap when sidebar is too narrow                               | P2       |

### Features

| Feature                                                                       | Remaining Work                                                          | Priority |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| [File Attachments](features/file-attachments.md)                              | Add non-image file attachment via button, drag-and-drop, or file picker | P2       |
| [Task Completion Notification](features/task-completion-notification.md)      | VS Code toast when task completes or awaits input while panel is hidden | P2       |
| [Custom OpenAI-Compatible Provider UI](features/custom-openai-provider-ui.md) | Port `DialogCustomProvider` from `packages/app` to extension webview    | P1       |
| [Remember Last Model Choice](features/remember-last-model.md)                 | Persist last-used model and pre-select it for new sessions              | P2       |
| [Expandable MCP Tools](features/expandable-mcp-tools.md)                      | Make MCP tool rows expandable to show inputs/outputs like regular tools | P2       |
| [Session Preview Improvements](features/session-preview-improvements.md)      | Evaluate showing first message snippet or improving title generation    | P2       |

### Migration (old extension → new)

| Feature                                                   | Remaining Work                                                               | Priority |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| [Settings Migration](migration/settings-migration.md)     | Read old extension settings and offer to import into CLI config on first run | P1       |
| [MemoryBank Migration](migration/memorybank-migration.md) | Detect MemoryBank content and offer to migrate it to AGENTS.md               | P1       |
| [Upgrade Onboarding](migration/upgrade-onboarding.md)     | Show distinct onboarding for upgraders explaining what changed               | P1       |

### Error Handling & Reliability

| Feature                                                                                   | Remaining Work                                                               | Priority |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------- |
| [Pre-Release Switch CPU Spike](error-handling/pre-release-switch-crash.md)                | Fix race condition / process conflict when switching release ↔ pre-release  | P0       |
| [Extension View Doesn't Refresh on Update](error-handling/extension-refresh-on-update.md) | Force webview reload when extension version changes                          | P1       |
| [Propagate CLI Errors to UI](error-handling/propagate-cli-errors-to-ui.md)                | Surface CLI stderr errors in chat or as VS Code notifications                | P1       |
| [CLI Startup Errors](error-handling/cli-startup-errors.md)                                | Detect CLI process exit before connection; show error with details and retry | P1       |
| [Autocomplete Settings Link Broken](error-handling/autocomplete-settings-link.md)         | Fix "settings" link in autocomplete broken notice; fix missing default model | P1       |

### Infrastructure / Refactoring

| Feature                                                                    | Remaining Work                                                              | Priority |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| [Show Changelog on Update](infrastructure/changelog-on-update.md)          | Detect version change on activation and offer "What's New" notification     | P3       |
| [Publish to OpenVSX](infrastructure/openvsx-publish.md)                    | Add `ovsx publish` step to CI/CD pipeline after VS Code Marketplace publish | P3       |
| [HTTP Request Timeouts](infrastructure/http-request-timeouts.md)           | Add timeouts to SDK calls (only health check has timeout currently)         | P1       |
| [VSCode Error Notifications](infrastructure/vscode-error-notifications.md) | Error notifications for CLI start failure, SSE disconnect                   | P1       |
| [Dedicated Output Channel](infrastructure/dedicated-output-channel.md)     | General "Kilo Code" output channel and centralized logging utility          | P2       |

### CLI-Side (tracked here for awareness)

| Feature                                                              | Remaining Work                                                            | Priority |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------- |
| [/init Pre-Commit Secret Check](cli-side/init-secret-check.md)       | Check for secret scanning hooks in `/init`; suggest adding one if missing | P2       |
| [Plan Mode Over-Prompting](cli-side/plan-mode-over-prompting.md)     | Fix Plan mode system prompt so agent stops repeatedly asking to implement | P1       |
| [Architect Mode / Plan Files](cli-side/architect-mode-plan-files.md) | Export plan as `.md` to `/plans/` directory from Plan mode                | P2       |

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

- [ ] **VS Code error notifications** — Critical errors (CLI missing, server crash, connection lost) need VS Code-native notifications ([details](infrastructure/vscode-error-notifications.md)). Users get no feedback if the webview is hidden
- [ ] **HTTP request timeouts** — SDK calls need configurable timeouts ([details](infrastructure/http-request-timeouts.md))

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
