# Services - MCP Feature

**Quick Navigation for AI Agents**

---

## Overview

Model Context Protocol (MCP) support. The McpHub (70KB) manages connections to external MCP servers, tool discovery, and execution. Enables extending Kilocode with external capabilities.

**Source Location**: `src/services/mcp/`

---

## Components

| Component | Type | File | Size |
|-----------|------|------|------|
| McpHub | Class | `McpHub.ts` | 70KB |
| McpServerManager | Class | `McpServerManager.ts` | 15KB |

---

## Documentation Files

- **[Types.md](./Types.md)** - MCP type definitions (McpServer, McpTool, etc.)
- **[McpHub.md](./McpHub.md)** - Central MCP orchestration (70KB)

---

## Quick Reference

| Operation | Method | File |
|-----------|--------|------|
| Connect server | `connectServer()` | `McpHub.ts` |
| Disconnect server | `disconnectServer()` | `McpHub.ts` |
| List tools | `getTools()` | `McpHub.ts` |
| Execute tool | `executeTool()` | `McpHub.ts` |
| List resources | `getResources()` | `McpHub.ts` |
| Access resource | `accessResource()` | `McpHub.ts` |
| Add server | `addServer()` | `McpServerManager.ts` |
| Remove server | `removeServer()` | `McpServerManager.ts` |

---

## MCP Concepts

- **Server**: External process providing tools/resources
- **Tool**: Function that can be invoked
- **Resource**: Data that can be accessed
- **Transport**: Communication protocol (stdio, HTTP)

---

## Server Configuration

```json
{
  "name": "example-server",
  "command": "npx",
  "args": ["-y", "@example/mcp-server"],
  "env": {
    "API_KEY": "..."
  }
}
```

---

## Integration

MCP tools are available alongside built-in tools:
1. User configures MCP servers
2. McpHub connects and discovers tools
3. Tools appear in AI's available actions
4. AI can invoke MCP tools like built-in ones

---

## Related Features

- [MCP Tools](../../../core/features/tools/mcp-tools/) - UseMcpTool, accessMcpResource
- [Skills](../skills/) - User-defined functions (similar concept)

---

## Kilocode-Specific

| File | Purpose |
|------|---------|
| `kilocode/` | Kilocode MCP features |

---

[← Back to Services](../../Feature-Index.md)
