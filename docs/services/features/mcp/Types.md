# MCP - Type Definitions

**Feature**: MCP (Model Context Protocol)
**Source**: `src/shared/mcp.ts`, `src/services/mcp/McpHub.ts`

---

## Core Types

### McpServer

Represents an MCP server configuration and state.

```typescript
type McpServer = {
  name: string;                           // Server name
  config: string;                         // JSON config string
  status: "connected" | "connecting" | "disconnected";
  error?: string;                         // Error message if any
  errorHistory?: McpErrorEntry[];         // Error history
  tools?: McpTool[];                      // Available tools
  resources?: McpResource[];              // Available resources
  resourceTemplates?: McpResourceTemplate[];
  disabled?: boolean;                     // Server disabled flag
  timeout?: number;                       // Request timeout
  source?: "global" | "project";          // Config source
  projectPath?: string;                   // Project path (if project source)
  instructions?: string;                  // Server instructions
}
```

---

### McpTool

Tool exposed by an MCP server.

```typescript
type McpTool = {
  name: string;              // Tool name
  description?: string;      // Tool description
  inputSchema?: object;      // JSON Schema for input
  alwaysAllow?: boolean;     // Auto-approve this tool
  enabledForPrompt?: boolean;// Include in system prompt
}
```

---

### McpResource

Resource exposed by an MCP server.

```typescript
type McpResource = {
  uri: string;         // Resource URI
  name: string;        // Display name
  mimeType?: string;   // MIME type
  description?: string;// Description
}
```

---

### McpResourceTemplate

Template for dynamic resources.

```typescript
type McpResourceTemplate = {
  uriTemplate: string;  // URI template (with placeholders)
  name: string;         // Display name
  description?: string; // Description
  mimeType?: string;    // Expected MIME type
}
```

---

### McpResourceResponse

Response from reading a resource.

```typescript
type McpResourceResponse = {
  _meta?: Record<string, any>;
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;      // Text content
    blob?: string;      // Base64 binary content
  }>;
}
```

---

### McpToolCallResponse

Response from calling a tool.

```typescript
type McpToolCallResponse = {
  _meta?: Record<string, any>;
  content: Array<
    | { type: "text"; text: string; }
    | { type: "image"; data: string; mimeType: string; }
    | { type: "audio"; data: string; mimeType: string; }
    | { type: "resource"; resource: { uri: string; text?: string; blob?: string; }; }
    | { type: "resource_link"; uri: string; name?: string; }
  >;
  structuredContent?: Record<string, any>;
  isError?: boolean;
}
```

---

### McpErrorEntry

Error log entry.

```typescript
type McpErrorEntry = {
  message: string;
  timestamp: number;
  level: "error" | "warn" | "info";
}
```

---

## Connection Types

### McpConnection

Discriminated union for connection states.

```typescript
type McpConnection = ConnectedMcpConnection | DisconnectedMcpConnection;

type ConnectedMcpConnection = {
  type: "connected";
  server: McpServer;
  client: Client;
  transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;
}

type DisconnectedMcpConnection = {
  type: "disconnected";
  server: McpServer;
  client: null;
  transport: null;
}
```

---

## Configuration Schema

### ServerConfigSchema (Zod)

Validates server configuration.

```typescript
// Stdio server
{
  type?: "stdio";
  command: string;        // Required for stdio
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  disabled?: boolean;
  timeout?: number;       // 1-3600 seconds
  alwaysAllow?: string[]; // Auto-approve tools
  watchPaths?: string[];  // Paths to watch for restart
  disabledTools?: string[];
}

// SSE server
{
  type: "sse";            // Required for SSE
  url: string;            // Required for SSE
  headers?: Record<string, string>;
  // ... common fields
}

// Streamable HTTP server
{
  type: "streamable-http";
  url: string;
  headers?: Record<string, string>;
  // ... common fields
}
```

---

## Enums

### DisableReason

Why a server is disabled.

```typescript
enum DisableReason {
  MCP_DISABLED = "mcpDisabled",      // MCP globally disabled
  SERVER_DISABLED = "serverDisabled" // This server disabled
}
```

---

## Transport Types

| Type | Description | Use Case |
|------|-------------|----------|
| `stdio` | Standard input/output | Local processes |
| `sse` | Server-Sent Events | Remote servers |
| `streamable-http` | HTTP streaming | Remote servers |

---

[← Back to MCP Index](./mcp-Index.md)
