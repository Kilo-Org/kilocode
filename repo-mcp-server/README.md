# Translation MCP Server

A Model Context Protocol (MCP) server for managing internationalization (i18n) translation tasks.

## Overview

This server provides tools for translating strings in JSON translation files used by the Kilo Code extension. It follows the MCP protocol to interact with the extension via stdio (standard input/output).

## Structure

The codebase is organized as follows:

```
repo-mcp-server/
├── src/
│   ├── index.ts              # Main entry point, starts the MCP server
│   ├── tools/                # MCP tools directory
│   │   ├── types.ts          # Type definitions for tools
│   │   ├── index.ts          # Tool registration
│   │   └── i18n/             # i18n specific tools
│   │       ├── index.ts      # i18n tool exports
│   │       ├── listLocales.ts # Tool for listing available locales
│   │       ├── moveKey.ts    # Tool for moving keys between files
│   │       ├── translateKey.ts # Tool for translating keys
│   │       └── translation.ts # Translation utilities
│   └── utils/                # Utility functions
│       ├── json-utils.ts     # JSON handling utilities
│       ├── locale-utils.ts   # Locale detection and management
│       └── order-utils.ts    # JSON ordering utilities
├── tsconfig.json             # TypeScript configuration
└── package.json              # Dependencies and scripts
```

## Tools

This server provides the following MCP tools:

1. `translate_i18n_key` - Translate a specific key or keys from English to other languages
2. `move_i18n_key` - Move a key from one JSON file to another across all locales
3. `list_locales` - List all available locales

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- tsx (installed as a dev dependency)

### Setup

1. Install dependencies:

    ```
    npm install
    ```

### Workflow

This server is a simple script that's executed directly via TSX. It doesn't need to be built or started separately. The Kilo Code extension communicates with it via stdio, launching it as a child process when needed for translation tasks.

For local testing, you can run:

```
npx tsx src/index.ts
```

## Configuration

The server looks for an `.env.local` file in the parent directory for configuration variables:

- `OPENROUTER_API_KEY` - API key for OpenRouter translation service
- `DEFAULT_MODEL` - Default model to use for translation (defaults to "anthropic/claude-3.7-sonnet")
