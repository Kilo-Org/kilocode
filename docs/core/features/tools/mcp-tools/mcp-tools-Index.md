# Tools - MCP Tools

**Quick Navigation for AI Agents**

---

## Overview

Model Context Protocol tools. Enable AI to use tools and access resources from MCP servers.

**Source Location**: `src/core/tools/`

---

## Tools

| Tool | Purpose | File | Size |
|------|---------|------|------|
| UseMcpToolTool | Invoke MCP server tools | `UseMcpToolTool.ts` | 10KB |
| accessMcpResourceTool | Access MCP resources | `accessMcpResourceTool.ts` | 3KB |

---

## UseMcpToolTool

**Purpose**: Call tools exposed by MCP servers

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| serverName | string | Yes | MCP server name |
| toolName | string | Yes | Tool to invoke |
| arguments | object | No | Tool arguments |

**Behavior**:
1. Finds MCP server connection
2. Validates tool exists
3. Calls tool via MCP protocol
4. Returns tool response

---

## accessMcpResourceTool

**Purpose**: Read resources from MCP servers

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| serverName | string | Yes | MCP server name |
| uri | string | Yes | Resource URI |

**Behavior**:
1. Finds MCP server connection
2. Requests resource via URI
3. Returns resource content

---

## Related

- [MCP Service](../../../../services/features/mcp/) - MCP server management

---

[← Back to Tools](../tools-Index.md)
