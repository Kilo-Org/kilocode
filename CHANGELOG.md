# Changelog

All notable changes to CodeFlux AI Kit will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.8.0] - 2026-02-21 — First Release

### Overview

This is the inaugural release of **CodeFlux AI Kit** — an AI-powered development assistant built as a VSCode extension. It brings a full AI agent experience to your editor, supporting 15+ AI providers and the Model Context Protocol (MCP) for extensibility.

### Features

- **Multi-Provider AI Support** — Anthropic Claude, OpenAI, AWS Bedrock, Google Vertex AI, Mistral, Ollama, OpenRouter, DeepSeek, Gemini, Fireworks, LM Studio, Glama, Requesty, Unbound, and more
- **Model Context Protocol (MCP)** — Extensible tool system via MCP servers; bring your own tools
- **Autonomous Agent Loop** — Orchestrated multi-step task execution via `Cline.ts`
- **Rich Tool Set** — File read/write, diff apply, terminal command execution, web browser automation (Puppeteer), code search (ripgrep + tree-sitter), and MCP tool invocation
- **Full VSCode Integration** — Inline diff views, diagnostic panel integration, terminal management, theme-aware UI
- **React Sidebar UI** — Tailwind-styled webview with real-time streaming, task history, and settings management
- **Internationalization** — UI and prompts localized in 14 languages: English, Spanish, French, German, Italian, Japanese, Korean, Simplified Chinese, Traditional Chinese, Brazilian Portuguese, Catalan, Vietnamese, Turkish, and Hindi
- **Agent Modes** — Configurable operating modes (e.g., code, architect, ask, debug)
- **Checkpoint System** — Per-task conversation history snapshots for resuming sessions
- **Code Parsing** — Tree-sitter WASM grammars for accurate language-aware code analysis
- **AI Assistant Guide** — Comprehensive `CLAUDE.md` onboarding document for AI-assisted development

### Infrastructure

- CI/CD via GitHub Actions: type-check, lint, unit tests (extension + webview), translation completeness checks, and E2E VSCode integration tests
- Automated dependency updates via Dependabot
- Cloudflare Worker build pipeline
- Pre-commit hooks (Husky + lint-staged) enforcing formatting and lint standards
- Strict TypeScript (ES2022, no implicit `any`) with Prettier (tabs, 120-char, no semicolons)

### Technical Stack

- **Extension runtime**: Node.js 20.18.1, TypeScript 5.4, esbuild bundler
- **Webview**: React, Vite, Tailwind CSS, shadcn/ui
- **Test framework**: Jest + ts-jest (unit), @vscode/test-electron (E2E)
- **VSCode engine**: ^1.84.0

---

[4.8.0]: https://github.com/canstralian/CodeFlux-AI-Kit/releases/tag/v4.8.0
