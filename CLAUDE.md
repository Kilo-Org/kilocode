# CLAUDE.md — AI Assistant Guide for Kilo Code

This file provides context and conventions for AI assistants (Claude, Copilot, etc.) working in this repository.

---

## Project Overview

**Kilo Code** (`kilo-code` v4.8.0) is a VSCode extension that delivers a full AI-powered development assistant — a "whole dev team of AI agents in your editor." It supports 15+ AI providers (Anthropic, OpenAI, Bedrock, Vertex AI, Mistral, Ollama, etc.) and implements the Model Context Protocol (MCP) for extensibility.

- **Publisher**: kilocode
- **VSCode requirement**: ^1.84.0
- **Node version**: 20.18.1 (enforced via `.nvmrc`)
- **Upstream repo**: https://github.com/Kilo-Org/kilocode

---

## Repository Structure

```
kilocode/
├── src/                        # Extension backend (TypeScript, Node.js)
│   ├── extension.ts            # Entry point: registers commands, activates providers
│   ├── core/                   # Core agent logic
│   │   ├── Cline.ts            # Main AI agent — orchestrates all tool use
│   │   ├── CodeActionProvider.ts
│   │   ├── EditorUtils.ts
│   │   ├── prompts/            # System prompt generation and response formatting
│   │   └── tools/              # Individual tool implementations
│   ├── api/                    # AI provider abstraction
│   │   ├── index.ts            # Provider factory
│   │   └── providers/          # One file per provider (anthropic, openai, bedrock, …)
│   ├── services/               # Background services
│   │   ├── mcp/                # MCP server management
│   │   ├── browser/            # Puppeteer browser automation
│   │   ├── checkpoints/        # Task state persistence
│   │   └── tree-sitter/        # Code parsing (language grammars via WASM)
│   ├── integrations/           # VSCode-specific integrations
│   │   ├── editor/             # Diff view, file operations
│   │   ├── terminal/           # Terminal creation, command execution
│   │   ├── theme/              # VS Code theme detection
│   │   └── diagnostics/        # Problems panel integration
│   ├── shared/                 # Types shared between extension and webview
│   │   ├── ExtensionMessage.ts # Extension → Webview message types
│   │   ├── WebviewMessage.ts   # Webview → Extension message types
│   │   ├── api.ts              # Provider/model type definitions
│   │   └── modes.ts            # Agent operating modes
│   └── i18n/                   # Internationalization
│       └── locales/            # Language JSON files
├── webview-ui/                 # React sidebar UI (Vite + Tailwind CSS)
│   └── src/
│       ├── components/         # React components
│       ├── context/            # React context providers for state
│       └── __tests__/          # Webview unit tests
├── e2e/                        # End-to-end VSCode integration tests (Mocha)
├── benchmark/                  # Performance benchmarking suite
├── scripts/                    # Build and maintenance scripts
├── cline_docs/                 # Developer how-to guides
│   └── settings.md             # Step-by-step guide for adding new settings
├── .github/workflows/          # CI/CD (code-qa.yml)
├── .clinerules                 # Code quality rules for AI assistants
├── package.json                # Root package (workspaces: webview-ui)
├── tsconfig.json               # Root TypeScript config (extension)
├── esbuild.js                  # Extension bundler config
└── jest.config.js              # Unit test config
```

---

## Development Setup

```bash
# Install all dependencies (root + webview-ui workspace)
npm run install:all

# Start webview in watch mode (hot reload for React UI)
npm run dev

# Watch extension + webview simultaneously
npm run watch
```

---

## Build Commands

| Command | Purpose |
|---|---|
| `npm run compile` | Compile TypeScript + bundle with esbuild |
| `npm run package` | Full build: webview → esbuild → type-check → lint |
| `npm run vsix` | Build distributable `.vsix` package |
| `npm run vscode:prepublish` | Pre-publish build (runs `package`) |
| `npm run generate-types` | Regenerate TypeScript declaration files |
| `npm run knip` | Detect unused files/exports |

---

## Testing

### Unit Tests (Jest)

```bash
npm run test                  # All unit tests
npm run test:extension        # Extension tests only (src/__tests__)
npm run test:webview          # Webview tests only (webview-ui/src/__tests__)
```

Test files live alongside source code in `__tests__/` subdirectories. The Jest config mocks the VSCode API and MCP SDK — do not import these directly in tests without the mocks in place.

### Type Checking & Linting

```bash
npm run check-types           # TypeScript type check (tsc --noEmit)
npm run lint                  # ESLint across extension + webview
```

### End-to-End Tests

```bash
# Requires OPENROUTER_API_KEY environment variable
npm run test:e2e
```

E2E tests launch a real VS Code instance via `@vscode/test-electron`. See `e2e/VSCODE_INTEGRATION_TESTS.md` for full setup instructions.

### Test Coverage Requirements

- **Every code change must include test coverage** (enforced by `.clinerules`).
- All tests must pass before submitting changes.
- When adding a new setting, update `mockState` in `ClineProvider.test.ts`.

---

## Code Conventions

### TypeScript

- **Strict mode** is enabled (`strict: true`). No implicit `any`.
- Target: **ES2022**, module resolution: `Bundler`.
- `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch` are all enforced.
- `useUnknownInCatchVariables` is **disabled** (catch variables are `any`).

### Formatting (Prettier)

```json
{
  "tabWidth": 4,
  "useTabs": true,
  "printWidth": 120,
  "semi": false,
  "bracketSameLine": true
}
```

Key rules: **tabs, not spaces**; **no semicolons**; 120-char line limit.

### Linting (ESLint)

- Never disable lint rules without explicit user approval (`.clinerules`).
- TypeScript-aware rules are enabled via `@typescript-eslint`.

### Styling (Webview UI)

- Use **Tailwind CSS classes** — never inline `style` objects for new markup.
- VSCode CSS variables must be registered in `webview-ui/src/index.css` before use.
- Correct: `<div className="text-md text-vscode-descriptionForeground mb-2" />`
- Incorrect: `<div style={{ color: "var(--vscode-descriptionForeground)" }} />`

### Git Commits

- Use clear, descriptive commit messages focused on the "why."
- Pre-commit hooks (Husky + lint-staged) run automatically.

---

## Architecture: How the Extension Works

### Communication Model

```
VSCode API  ←→  Extension Host (Node.js)  ←→  Webview (React)
                      |
              AI Provider APIs (HTTP)
                      |
              MCP Servers (subprocess)
```

- **Extension ↔ Webview**: Message passing via `postMessage`. All message types are declared in `src/shared/ExtensionMessage.ts` (extension→webview) and `src/shared/WebviewMessage.ts` (webview→extension).
- **Extension ↔ AI APIs**: Each provider implements the `ApiHandler` interface in `src/api/providers/`. The factory in `src/api/index.ts` selects the correct provider.
- **Extension ↔ MCP**: The MCP SDK manages subprocess communication with external tool servers.

### State Management

The extension uses VSCode's built-in storage, not a database:

| Storage | Used For |
|---|---|
| `context.globalState` | Persistent user settings (API keys, preferences) |
| `context.workspaceState` | Per-workspace settings |
| `CheckpointService` | Per-task conversation history snapshots |
| File system | `.vscode/` workspace configuration |

### Adding a New Setting

This is a multi-file operation. Follow `cline_docs/settings.md` exactly:

1. `src/shared/ExtensionMessage.ts` — add to `ExtensionState` interface
2. `src/shared/WebviewMessage.ts` — add message type to union (for checkbox/select)
3. `webview-ui/src/context/ExtensionStateContext.tsx` — add to context interface + state
4. `src/core/webview/ClineProvider.ts` — add `GlobalStateKey`, handle in `getState`, `getStateToPostToWebview`, and `setWebviewMessageListener`
5. `webview-ui/src/components/settings/SettingsView.tsx` — add UI component + `handleSubmit` call
6. `src/core/webview/__tests__/ClineProvider.test.ts` — update `mockState`

### Tool System

The 19 agent tools live in `src/core/tools/`. Each tool:
- Receives parameters parsed from the AI response
- Executes an operation (file I/O, terminal, browser, MCP, etc.)
- Returns structured output back to `Cline.ts` for inclusion in the next prompt turn

Key tools: `readFileTool`, `writeToFileTool`, `applyDiffTool`, `executeCommandTool`, `searchFilesTool`, `browserActionTool`, `useMcpToolTool`, `askFollowupQuestionTool`, `attemptCompletionTool`.

---

## AI Provider Support

Providers are in `src/api/providers/`. All implement the `ApiHandler` interface:

| Provider | File |
|---|---|
| Anthropic (Claude) | `anthropic.ts` |
| AWS Bedrock | `bedrock.ts` |
| Google Vertex AI | `vertex.ts` |
| OpenAI | `openai.ts`, `openai-native.ts` |
| Mistral | `mistral.ts` |
| Ollama (local) | `ollama.ts` |
| + 8 more | See `src/api/providers/` |

When adding a new provider, register it in `src/api/index.ts` and add its configuration type to `src/shared/api.ts`.

---

## Internationalization

- 14 languages in `src/i18n/locales/`: `en`, `es`, `fr`, `de`, `it`, `ja`, `ko`, `zh-CN`, `zh-TW`, `pt-BR`, `ca`, `vi`, `tr`, `hi`
- CI checks translation completeness — all keys must be present in all locales.
- Use the i18n helpers; do not hardcode user-visible strings.

---

## CI/CD (`.github/workflows/code-qa.yml`)

| Job | What it runs |
|---|---|
| `compile` | `check-types` + `lint` + `compile` |
| `check-translations` | Verifies all locale keys are present |
| `test-extension` | Jest unit tests for extension |
| `test-webview` | Jest unit tests for React UI |
| `integration-test` | E2E VSCode tests (requires `OPENROUTER_API_KEY` secret) |

All jobs must pass before merging.

---

## Key Files Quick Reference

| File | Role |
|---|---|
| `src/extension.ts` | VSCode activation, command registration |
| `src/core/Cline.ts` | Central AI agent loop and tool dispatch |
| `src/core/prompts/system.ts` | System prompt assembly |
| `src/api/index.ts` | Provider factory (`buildApiHandler`) |
| `src/shared/ExtensionMessage.ts` | Extension→Webview message contract |
| `src/shared/WebviewMessage.ts` | Webview→Extension message contract |
| `src/shared/api.ts` | All provider/model type definitions |
| `src/shared/modes.ts` | Agent operating mode definitions |
| `src/core/webview/ClineProvider.ts` | Webview lifecycle + global state management |
| `webview-ui/src/context/ExtensionStateContext.tsx` | React state shared across webview |
| `webview-ui/src/components/settings/SettingsView.tsx` | Settings UI |
| `cline_docs/settings.md` | Step-by-step guide for adding settings |
| `.clinerules` | Code quality rules (read before making changes) |
