---
title: "Architecture Overview"
description: "Overview of Kilo Code architecture"
---

s

# Architecture Overview

This document provides a high-level overview of Kilo Code's architecture to help contributors understand how the different components fit together.

## System Architecture

Kilo Code is a VS Code extension built with TypeScript that connects to various AI providers to deliver intelligent coding assistance. The architecture follows a layered approach:

```
┌─────────────────────────────────────────────────────────────────────┐
│                           VS Code Extension                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │   Extension Host │     │    Webview UI    │                      │
│  │      (src/)      │◀───▶│  (webview-ui/)   │                      │
│  └────────┬─────────┘     └──────────────────┘                      │
│           │                                                         │
│           │ Messages                                                │
│           ▼                                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      Core Services                           │   │
│  ├────────────┬────────────┬────────────┬───────────────────────┤   │
│  │   Tools    │   Browser  │    MCP     │    Code Index         │   │
│  │  Service   │   Session  │  Servers   │     Service           │   │
│  └────────────┴────────────┴────────────┴───────────────────────┘   │
│           │                                                         │
│           │ API Calls                                               │
│           ▼                                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   API Provider Layer                         │   │
│  ├────────────┬────────────┬────────────┬───────────────────────┤   │
│  │  Anthropic │   OpenAI   │   Kilo     │     OpenRouter        │   │
│  │    API     │    API     │ Provider   │        API            │   │
│  └────────────┴────────────┴────────────┴───────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Features

These pages document the architecture and design of a current or planned feature, as well as any unique development patterns.

| Feature                                                                                  | Description                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| [Annual Billing](/docs/contributing/architecture/annual-billing)                         | Annual subscription billing                |
| [Enterprise MCP Controls](/docs/contributing/architecture/enterprise-mcp-controls)       | Admin controls for MCP server allowlists   |
| [Onboarding Improvements](/docs/contributing/architecture/onboarding-improvements)       | User onboarding and engagement features    |
| [Organization Modes Library](/docs/contributing/architecture/organization-modes-library) | Shared modes for teams and enterprise      |
| [Agentic Security Reviews](/docs/contributing/architecture/security-reviews)             | AI-powered security vulnerability analysis |
| [Track Repo URL](/docs/contributing/architecture/track-repo-url)                         | Usage tracking by repository/project       |
| [Vercel AI Gateway](/docs/contributing/architecture/vercel-ai-gateway)                   | Vercel AI Gateway integration              |
| [Voice Transcription](/docs/contributing/architecture/voice-transcription)               | Live voice input for chat                  |

To propose a new feature design, please create a detailed proposal using the architecture patterns shown in the above feature examples.

## Key Concepts

### Modes

Modes are configurable presets that customize Kilo Code's behavior:

- Define which tools are available
- Set custom system prompts
- Configure file restrictions
- Examples: Code, Architect, Debug, Ask

### Model Context Protocol (MCP)

MCP enables extending Kilo Code with external tools:

- Servers provide additional capabilities
- Standardized protocol for tool communication
- Configured via `mcp.json`

### Checkpoints

Git-based state management for safe exploration:

- Creates commits to track changes
- Enables rolling back to previous states
- Shadow repository for isolation

### Code Indexing

Semantic search over the codebase:

- Embeddings-based search
- Vector database storage (LanceDB/Qdrant)
- Automatic chunking and indexing

## Development Patterns

### Message Passing

The extension uses VS Code's webview message API:

```typescript
// Extension → Webview
panel.webview.postMessage({ type: "response", data: ... });

// Webview → Extension
vscode.postMessage({ type: "request", data: ... });
```

### Service Architecture

Services are typically singletons with clear interfaces:

```typescript
class CodeIndexService {
	private static instance: CodeIndexService

	static getInstance(): CodeIndexService {
		if (!this.instance) {
			this.instance = new CodeIndexService()
		}
		return this.instance
	}
}
```

### Tool Implementation

Tools follow a consistent pattern:

```typescript
interface Tool {
	name: string
	description: string
	parameters: z.ZodSchema
	execute(params: unknown): Promise<ToolResult>
}
```

## Build System

The project uses:

- **pnpm** - Package management (monorepo workspaces)
- **esbuild** - Fast bundling for extension
- **Vite** - Webview UI development
- **TypeScript** - Type checking across all packages
- **Vitest** - Test runner

## Testing

- **Unit tests** - `*.spec.ts` files alongside source
- **Integration tests** - E2E tests in `e2e/` directory
- **Run tests**: `cd src && pnpm test` or `cd webview-ui && pnpm test`

## Further Reading

- [Development Environment](/docs/contributing/development-environment) - Setup guide
- [Tools Reference](/docs/features/tools/tool-use-overview) - Available tools
