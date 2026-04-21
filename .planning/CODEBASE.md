# Codebase Map

**Analyzed:** 2026-04-18
**Root:** C:\Users\dasbl\Downloads\devilcode
**Confidence:** HIGH

## Architecture Overview

Devil Code is an open-source AI coding agent platform — a fork of OpenCode with authentication, telemetry, i18n, VS Code extension, Agent Manager, and multi-model support via OpenRouter. The architecture follows a **hub-and-spoke model** where the core CLI (`packages/opencode/`, ~108K lines of TypeScript) contains the AI agent runtime, tool execution, session management, and a Hono HTTP/SSE server. All products (TUI, VS Code extension, desktop, web UI) are thin clients that spawn `kilo serve` and communicate via REST+SSE using the `@devilcode/sdk`.

Built on **Turborepo + Bun 1.3.10** monorepo with TypeScript 5.8 (native `tsgo` compiler), targeting Node.js 22+. Primary runtime concerns are per-project singletons via `AsyncLocalStorage` (`Instance.state`), Zod-schema-validated namespace modules (not classes), and filesystem-only persistence (no database). The repo is a fork, so Kilo-specific code is isolated under `src/devilcode/` and marked with `devilcode_change` comments to minimize upstream merge pain — currently 1,429 such markers across the codebase.

Target subsystem for the current planning effort: `packages/opencode/src/devilcode/workflow-tui/` (8 files, ~600 LOC) + `packages/opencode/src/devilcode/team/` (5 files) + `packages/opencode/src/devilcode/workflow/` (stage machine, routes, state).

## Language Distribution

| Extension | File Count | % of Codebase |
|-----------|-----------|---------------|
| .ts       | 1,663     | 52.8%         |
| .tsx      | 561       | 17.9%         |
| .md       | 378       | 12.0%         |
| .json     | 125       | 4.0%          |
| .css      | 113       | 3.6%          |
| .js       | 11        | 0.3%          |

(~3,140 source files total, excluding node_modules/.git/dist)

## Detected Stack

| Layer | Technology | Evidence |
|-------|-----------|----------|
| Runtime | Bun 1.3.10 + Node.js 22 | `packageManager: "bun@1.3.10"` in root `package.json` |
| Language | TypeScript 5.8 (tsgo) | `@typescript/native-preview`, `bun turbo typecheck` |
| Framework (CLI server) | Hono 4.12.12 | `src/server/server.ts`, routes in `src/server/routes/` |
| Framework (AI) | Vercel AI SDK 5.0.124 | `ai@5.0.124`, provider abstraction in `src/provider/` |
| Framework (TUI) | SolidJS 1.9.12 + OpenTUI | `@opentui/solid`, `@opentui/core` in CLI TUI |
| Framework (UI) | SolidJS + TailwindCSS 4 + Kobalte | `devil-ui/` components, `@kobalte/core` |
| Extension | VS Code API + esbuild dual build | Extension CJS → `dist/extension.js`, Webview IIFE → `dist/webview.js` |
| Test | Bun native test runner + Playwright | `bun test --timeout 30000`, 176 `.test.ts` files |
| Build | Turborepo 2.8.13, esbuild, Vite 7.3.2 | Root `turbo.json` + workspaces |
| Architecture | Monorepo + hub-and-spoke | `packages/` with CLI hub; HTTP+SSE between CLI and clients |

## Conventions Detected

- **File naming**: lowercase-kebab dirs (`agent/`, `session/`, `provider/`); devilcode-specific code isolated under `src/devilcode/` and `test/kilocode/`
- **Module structure**: TS namespaces (not classes) with Zod schemas; per-project singletons via `Instance.state(init, dispose?)`; AsyncLocalStorage for context
- **Config location**: Filesystem JSON in `~/.local/share/kilo/storage/` (runtime), `.devil/config.yaml` (repo), env vars (`DEVIL_API_URL`, `KILO_SERVER_PASSWORD`)
- **Test approach**: Co-located `.test.ts` via Bun native runner; 176 test files; CLI package well-covered, UI packages lightly tested
- **Import style**: Path aliases (`@/*` → `./src/*`, `@tui/*` → `./src/cli/cmd/tui/*`); ESM-only
- **Linting/formatting**: Prettier (120 char, no semicolons); Knip (zero dead exports, CI-enforced in devil-vscode); pre-push hook verifies Bun version + runs typecheck

## Entry Points

| Type | Path | Evidence |
|------|------|----------|
| CLI (main) | `packages/opencode/bin/devil` + `src/index.ts` | `bun run dev` TUI entry |
| VS Code Extension | `packages/devil-vscode/src/extension.ts` | Spawns `kilo serve --port 0`; auth via `KILO_SERVER_PASSWORD` |
| Web UI | `packages/app/src/index.ts` | `bun run dev:web`; not actively maintained |
| Desktop (Tauri) | `packages/desktop/src/main.ts` | Tauri app; not actively maintained |
| HTTP Server | `packages/opencode/src/server/server.ts` | Hono on dynamic port; OpenAPI spec auto-generated |

## Risk Areas

| Area | Risk Level | Why | Recommendation |
|------|-----------|-----|----------------|
| `models-snapshot.ts` | HIGH | 65,831 lines (auto-generated); unreviewable manually | Verify generator runs in CI; document refresh cadence |
| Fork markers (`devilcode_change`) | HIGH | 1,429 markers scatter fork-specific code; merge conflicts on upstream sync | Consolidate related changes into `src/devilcode/` submodules where possible; quarterly upstream merge |
| Provider layer | MEDIUM | `provider.ts` (1,517) + `transform.ts` (1,062); AI SDK version pinning | Add fallback-chain tests; pin AI SDK upgrades |
| Session + Prompt | MEDIUM | `session/prompt.ts` (2,146); context window + truncation logic | Add edge-case integration tests (very long prompts, token overflow) |
| Config system | MEDIUM | `config.ts` (1,881); YAML + env + CLI parsing | Add schema-validation tests; test precedence rules |
| LSP server | MEDIUM | `lsp/server.ts` (2,071); complex async state | Check for memory leaks in long-running sessions |
| **Workflow TUI (target)** | MEDIUM | 8 files / ~600 LOC; discoverability gaps, rendering bug, overloaded input; subject of current redesign | Full redesign in progress |

## Technical Debt Signals

- **TODO/FIXME count**: 0 detected in source (style guide discourages; any deferred work is captured elsewhere)
- **Large files (>500 lines)** — top 5:
  - `models-snapshot.ts` (65,831, auto-generated)
  - `session/prompt.ts` (2,146)
  - `lsp/server.ts` (2,071)
  - `config/config.ts` (1,881)
  - `acp/agent.ts` (1,760)
- **Files without tests**: `src/devilcode/permission/`, `src/provider/sdk/copilot/` (1,732 lines), `packages/devil-ui/src/` (storybook only)
- **Git hotspots (last 90 days)**: `src/devilcode/workflow/` (build-runner, routes, types) — 5+ commits; `devil-vscode/webview-ui/` (sidebar, settings, team UI) — 4+ commits; `src/server/rate-limit.ts` — 4+ commits (recent audit)

## Dependency Risk

**Ecosystem**: Node.js / Bun (via `package.json` workspaces).
**Direct dependencies**: ~50 direct in `packages/opencode/package.json` + catalog-pinned versions at root.

### Risk Summary

| Dependency | Version | Risk | Note |
|---|---|---|---|
| Vercel AI SDK (`ai`) | 5.0.124 | HIGH | Breaking API changes expected; multi-model support is critical path |
| Hono | 4.12.12 | MEDIUM | Stable, core server |
| SolidJS | 1.9.12 | MEDIUM | Niche framework, smaller ecosystem vs React |
| Drizzle ORM | 1.0.0-beta.16 | MEDIUM | Beta version in devil-gateway |
| TypeScript | 5.8.2 | LOW | Well-tested |

**Patched packages** (via `bun patch`): `@openrouter/ai-sdk-provider@1.5.4`, `@standard-community/standard-openapi@0.2.9` — verify patches on upgrade.

## Agent Guidance

- **Preferred**: Namespace-module pattern (Zod schemas + exported functions); co-located `.test.ts`; `Instance.state()` for per-project singletons; mark fork changes with `// devilcode_change` or isolate in `src/devilcode/`; always pass `windowsHide: true` to process spawns (use `src/util/process.ts`)
- **Avoid**: Monolithic files >500 lines (break into submodules); classes (use TS namespaces); direct `child_process.spawn` without `windowsHide`; editing `packages/sdk/js/src/gen/` (generated); editing `models-snapshot.ts` (generated); leaving stale `devilcode_change` markers (CI check)
- **Touch with care**:
  - `packages/opencode/src/provider/` — multi-model abstraction; breaks all downstream clients
  - `packages/opencode/src/server/` — HTTP/SSE protocol; mismatch breaks VS Code extension
  - `packages/devil-vscode/` — CI enforces knip, format, `devilcode_change` check, file-size caps
  - `packages/opencode/src/devilcode/workflow-tui/` — target of current redesign; coordinate carefully

## Dependency Graph

`opencode` (CLI hub) fans out to all clients. Critical chains:
- **Provider chain**: `src/provider/provider.ts` → Vercel AI SDK → 15+ model providers (OpenAI, Anthropic, Google, Bedrock, etc.)
- **Server chain**: `src/server/server.ts` → Hono routes (`/session`, `/config`, `/file`, `/tool`, `/mcp`, `/devilcode/workflow`) → AsyncLocalStorage-based Instance singletons
- **Session chain**: `src/session/index.ts` → prompt builder (`src/session/prompt.ts`) → LSP server (`src/lsp/server.ts`) → tool execution (`src/tool/`)
- **Workflow chain (target)**: `workflow-tui/orchestrator.ts` → `workflow/dispatch.ts` → `team/agents.ts` (via `createWorkflowAgents`) → `agent/agent.ts` (runtime)

Cross-package: devil-vscode → @devilcode/sdk → cli server; gateway ← cli (session export); all packages → devil-telemetry

## Test Coverage Map

**Test convention**: Co-located `.test.ts` files (Bun native runner).
**Coverage**: MEDIUM estimated (CLI ~60-70%, UIs lower).
**Source**: 176 `.test.ts` files in `packages/opencode/test/` + `packages/opencode/src/`.

### Critical Untested Files

| File | Lines | Risk Level | Recommendation |
|------|-------|-----------|----------------|
| `src/devilcode/permission/*` | varies | HIGH | Fine-grained access control; add tests before extending |
| `src/provider/sdk/copilot/*` | 1,732 | MEDIUM | Microsoft Copilot integration; test with live-API mocks |
| `packages/devil-ui/src/*` | varies | MEDIUM | Storybook only; add unit tests for critical components |
| `packages/app/*` | varies | LOW | Unmaintained |

## API Surface

Hono HTTP routes (OpenAPI spec auto-generated):

| Prefix | Purpose |
|--------|---------|
| `/session` | Session lifecycle + SSE streaming |
| `/config` | Configuration, auth profile, env vars |
| `/file` | Read/write/delete files |
| `/tool` | Tool definitions + execution |
| `/provider` | Model listing + override |
| `/mcp` | MCP server lifecycle + tool calling (SSE) |
| `/devilcode/workflow` | Devil-specific workflow state endpoints (status, plans, review, locks, events, lessons) |
| `/permission` | Fine-grained access control |
| `/project` | Project config |
| `/question` | Streaming Q&A |

Rate-limited at server level; password auth via `KILO_SERVER_PASSWORD`.

## Config & Environment

**Key env vars**:
- `DEVIL_API_URL` (default `https://api.devil.ai`) — gateway, auth, models, profile
- `DEVIL_SESSION_INGEST_URL` (default `https://ingest.devilsessions.ai`) — cloud sync
- `DEVIL_MODELS_URL` (default `https://models.dev`) — model metadata
- `KILO_SERVER_PASSWORD` (auto-generated) — extension ↔ CLI auth
- `KILO_PLATFORM` — set to `vscode` when inside extension

**Config files**: `~/.local/share/kilo/storage/` (runtime JSON), `.devil/config.yaml` (project-local), `.devil/prompt.system.md` (system prompt override).

## Pattern Library

1. **`Instance.state(init, dispose?)`** — per-project lazy singleton tied to directory via AsyncLocalStorage (`src/instance.ts`)
2. **`Tool.define(id, init)`** — tool registration with auto-truncated output (`src/tool/index.ts`)
3. **`fn(schema, callback)`** — Zod-validated function wrapper (`src/fn/index.ts`)
4. **`Bus.publish` + `BusEvent.define()`** — in-process pub/sub (`src/bus/`)
5. **`NamedError.create(name, schema)`** — structured errors (`src/error/index.ts`)

## Monorepo Structure

| Package | Purpose | Status |
|---------|---------|--------|
| `packages/opencode/` | Core CLI, agents, tools, server, TUI | Primary (~108K lines) |
| `packages/devil-vscode/` | VS Code extension + Agent Manager | Primary (dual esbuild: Node + IIFE) |
| `packages/devil-ui/` | SolidJS component library (40+ components on Kobalte) | Active |
| `packages/devil-gateway/` | Auth, provider routing, Kilo API | Active (Drizzle beta) |
| `packages/sdk/js/` | Auto-generated SDK (`src/gen/` never edited) | Generated |
| `packages/devil-telemetry/` | PostHog + OpenTelemetry | Active |
| `packages/devil-i18n/` | 16 language translations | Active |
| `packages/devil-docs/` | Next.js + Markdoc docs | Active |
| `packages/app/` | Shared SolidJS web UI | Not maintained |
| `packages/desktop/` | Tauri desktop app | Not maintained |

**Cross-package deps**: devil-vscode → sdk → cli server; gateway ← cli; all → devil-telemetry

## Directory Mappings

| Category | Primary Location | Priority | Pattern |
|----------|------------------|----------|---------|
| Routes | `packages/opencode/src/server/routes/` | explicit (10) | one file per domain |
| Tests | `packages/opencode/test/` + co-located `.test.ts` | explicit (10) | mirrors src/ |
| Components | `packages/devil-ui/src/` | explicit (10) | SolidJS + Kobalte |
| Services | `packages/opencode/src/{agent,provider,tool,session}/` | inferred (9) | namespace modules |
| Utils | `packages/opencode/src/util/`, `packages/util/` | inferred (8) | shared helpers |
| Types | co-located in namespace modules | inferred (8) | Zod schemas |
| Config | `~/.local/share/kilo/storage/` (runtime) + `.devil/config.yaml` (repo) | inferred (7) | no single file |
| TUI views | `packages/opencode/src/cli/cmd/tui/` + `src/devilcode/workflow-tui/` | inferred (7) | SolidJS + OpenTUI |
| Stores | AsyncLocalStorage (CLI) + SolidJS context (UIs) | inferred (7) | no centralized state manager |
| Assets | `packages/devil-vscode/assets/`, `packages/devil-docs/public/` | inferred (5) | icons, logos |
| Styles | TailwindCSS only; `devil-ui/src/index.css` | inferred (5) | utility-first |

### Path Enforcement Rules
- **Strictness**: warn
- New Kilo-specific code → `src/devilcode/` or `packages/devil-*/` (no `devilcode_change` marker required)
- Shared-code edits → mark with `// devilcode_change` (CI enforced in devil-vscode + devil-ui)
- Generated code (`packages/sdk/js/src/gen/`, `models-snapshot.ts`) → never hand-edit
