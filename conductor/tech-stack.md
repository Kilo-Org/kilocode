# Technology Stack

## Core Technologies

- **Languages:** TypeScript (primary), JavaScript
- **Runtime:** Node.js (>= 20.20.0)
- **Package Manager:** pnpm (v10.x, workspace-based monorepo)

## Build & Tooling

- **Monorepo Management:** Turborepo
- **Bundlers:** esbuild (CLI/Extension), Vite (Webview UI)
- **Linting & Formatting:** ESLint, Prettier
- **Git Hooks:** Husky, Lint-staged

## Component Frameworks

- **CLI/TUI:** React with Ink, Commander.js
- **Webview UI:** React, Tailwind CSS, VS Code Webview UI Toolkit
- **Extension API:** VS Code Extension API
- **JetBrains:** JetBrains Plugin SDK (IntelliJ Platform)

## AI & Agent Runtime

- **Agent Logic:** Custom runtime in `@kilocode/agent-runtime`
- **Schemas:** Zod via `@kilocode/core-schemas`
- **Integrations:** MCP (Model Context Protocol) SDK

## Testing

- **Unit/Integration:** Vitest
- **E2E:** Playwright
