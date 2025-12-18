---
sidebar_position: 2
title: "Architecture Overview"
---

# Architecture Overview

This document provides a high-level overview of Kilo Code's architecture to help contributors understand how the different components fit together.

## System Architecture

Kilo Code is a VS Code extension built with TypeScript that connects to various AI providers to deliver intelligent coding assistance. The architecture follows a layered approach:

```
┌─────────────────────────────────────────────────────────────────────┐
│                           VS Code Extension                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────────┐     ┌──────────────────┐                      │
│  │   Extension Host │     │    Webview UI    │                      │
│  │      (src/)      │◀───▶│  (webview-ui/)   │                      │
│  └────────┬─────────┘     └──────────────────┘                      │
│           │                                                          │
│           │ Messages                                                 │
│           ▼                                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      Core Services                            │   │
│  ├────────────┬────────────┬────────────┬───────────────────────┤   │
│  │   Tools    │   Browser  │    MCP     │    Code Index         │   │
│  │  Service   │   Session  │  Servers   │     Service           │   │
│  └────────────┴────────────┴────────────┴───────────────────────┘   │
│           │                                                          │
│           │ API Calls                                                │
│           ▼                                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                   API Provider Layer                          │   │
│  ├────────────┬────────────┬────────────┬───────────────────────┤   │
│  │  Anthropic │   OpenAI   │   Kilo     │     OpenRouter        │   │
│  │    API     │    API     │ Provider   │        API            │   │
│  └────────────┴────────────┴────────────┴───────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Components

### Extension Host (`src/`)

The extension host runs in Node.js within VS Code and contains:

- **`src/core/`** - The agent loop and core logic
    - `Kilo.ts` - Main agent class that orchestrates interactions
    - `prompts/` - System prompts and prompt construction
    - `tools/` - Tool implementations (file operations, search, etc.)
- **`src/services/`** - Service implementations

    - `browser/` - Puppeteer-based browser automation
    - `checkpoints/` - Git-based state checkpoints
    - `code-index/` - Codebase indexing and semantic search
    - `mcp/` - Model Context Protocol server integration
    - `commit-message/` - Git commit message generation

- **`src/api/`** - API provider implementations

    - Handles communication with AI providers
    - Manages streaming responses
    - Implements provider-specific features

- **`src/activate/`** - Extension activation and command registration

### Webview UI (`webview-ui/`)

A React-based frontend that provides the chat interface:

- Built with React and TypeScript
- Uses VS Code's webview API
- Communicates with extension host via message passing
- Styled with Tailwind CSS

### Shared Packages (`packages/`)

Shared code used across the monorepo:

- `@kilocode/types` - Shared TypeScript types
- `@kilocode/telemetry` - Telemetry utilities

### Applications (`apps/`)

- `kilocode-docs` - This documentation site (Docusaurus)
- `kilocode-website` - Marketing website

### Command-Line Interface (`cli/`)

A standalone CLI for running Kilo Code outside of VS Code.

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

- [Development Environment](/contributing/development-environment) - Setup guide
- [Engineering Specs](/contributing/specs) - Technical specifications
- [Tools Reference](/features/tools/tool-use-overview) - Available tools
