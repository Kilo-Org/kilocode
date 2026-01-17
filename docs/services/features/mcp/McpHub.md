# MCP - McpHub

**Feature**: MCP (Model Context Protocol)
**Source**: `src/services/mcp/McpHub.ts`
**Size**: 70KB

---

## Overview

McpHub is the central orchestrator for Model Context Protocol support. It manages connections to MCP servers, discovers tools and resources, handles server lifecycle, and provides access to MCP capabilities.

---

## Class Definition

```typescript
class McpHub {
  connections: McpConnection[];
  isConnecting: boolean;
  readonly kiloNotificationService: NotificationService;
}
```

---

## Key Properties

| Property | Type | Description |
|----------|------|-------------|
| `connections` | McpConnection[] | All server connections |
| `isConnecting` | boolean | Currently connecting flag |
| `kiloNotificationService` | NotificationService | Notification service |
| `refCount` | number | Active client count |
| `fileWatchers` | Map | File watchers for servers |
| `sanitizedNameRegistry` | Map | Name sanitization registry |

---

## Lifecycle Methods

### constructor()

Initializes McpHub with provider reference.

```typescript
constructor(provider: ClineProvider)
```

**Flow**:
1. Store weak reference to provider
2. Watch settings file for changes
3. Watch project MCP file
4. Setup workspace folder watcher
5. Initialize global MCP servers
6. Initialize project MCP servers

---

### registerClient() / unregisterClient()

Reference counting for cleanup.

```typescript
public registerClient(): void
public async unregisterClient(): Promise<void>
```

When refCount reaches 0, hub is disposed.

---

### dispose()

Cleans up all resources.

**Actions**:
- Disconnect all servers
- Remove file watchers
- Dispose VS Code watchers
- Clear connections

---

## Connection Methods

### connectToServer()

Connects to an MCP server.

```typescript
private async connectToServer(
  serverName: string,
  serverConfig: ServerConfig,
  source: "global" | "project"
): Promise<void>
```

**Location**: `McpHub.ts:672`

**Flow**:
1. Validate configuration
2. Create transport (stdio/sse/http)
3. Create MCP client
4. Connect client to transport
5. Fetch capabilities (tools, resources)
6. Add to connections list
7. Setup file watchers (if configured)

---

### restartConnection()

Restarts a server connection.

```typescript
async restartConnection(
  serverName: string,
  source?: "global" | "project"
): Promise<void>
```

**Location**: `McpHub.ts:1300`

---

### deleteConnection()

Removes a server connection.

```typescript
async deleteConnection(
  name: string,
  source?: "global" | "project"
): Promise<void>
```

**Location**: `McpHub.ts:1120`

---

### refreshAllConnections()

Refreshes all server connections.

```typescript
public async refreshAllConnections(): Promise<void>
```

**Location**: `McpHub.ts:1342`

---

## Tool Methods

### fetchToolsList()

Fetches tools from a server.

```typescript
private async fetchToolsList(
  serverName: string,
  source?: "global" | "project"
): Promise<McpTool[]>
```

**Location**: `McpHub.ts:1006`

---

### getTools() (implicit via connections)

Access tools via `connection.server.tools`.

---

## Resource Methods

### fetchResourcesList()

Fetches resources from a server.

```typescript
private async fetchResourcesList(
  serverName: string,
  source?: "global" | "project"
): Promise<McpResource[]>
```

**Location**: `McpHub.ts:1070`

---

### fetchResourceTemplatesList()

Fetches resource templates.

```typescript
private async fetchResourceTemplatesList(
  serverName: string,
  source?: "global" | "project"
): Promise<McpResourceTemplate[]>
```

**Location**: `McpHub.ts:1092`

---

## Configuration Methods

### getMcpServersPath()

Gets path to MCP servers config file.

```typescript
async getMcpServersPath(): Promise<string>
```

**Location**: `McpHub.ts:464`

---

### getMcpSettingsFilePath()

Gets path to MCP settings file.

```typescript
async getMcpSettingsFilePath(): Promise<string>
```

**Location**: `McpHub.ts:473`

---

### validateServerConfig()

Validates server configuration against schema.

```typescript
private validateServerConfig(
  config: any,
  serverName?: string
): z.infer<typeof ServerConfigSchema>
```

**Location**: `McpHub.ts:201`

---

### toggleServerDisabled()

Enables/disables a server.

```typescript
public async toggleServerDisabled(
  serverName: string,
  disabled: boolean,
  source?: "global" | "project"
): Promise<void>
```

**Location**: `McpHub.ts:1476`

---

### updateServerTimeout()

Updates server timeout setting.

```typescript
public async updateServerTimeout(
  serverName: string,
  timeout: number,
  source?: "global" | "project"
): Promise<void>
```

**Location**: `McpHub.ts:1662`

---

## File Watching

### watchMcpSettingsFile()

Watches global MCP settings file for changes.

```typescript
private async watchMcpSettingsFile(): Promise<void>
```

**Location**: `McpHub.ts:496`

---

### watchProjectMcpFile()

Watches project-level MCP file.

```typescript
private async watchProjectMcpFile(): Promise<void>
```

**Location**: `McpHub.ts:348`

---

### setupFileWatcher()

Sets up file watcher for server config changes.

```typescript
private setupFileWatcher(
  serverName: string,
  paths: string[],
  source: "global" | "project"
): void
```

**Location**: `McpHub.ts:1224`

---

## Helper Methods

### findConnection()

Finds connection by server name.

```typescript
private findConnection(
  serverName: string,
  source?: "global" | "project"
): McpConnection | undefined
```

**Location**: `McpHub.ts:948`

---

### findServerNameBySanitizedName()

Finds original name from sanitized name.

```typescript
public findServerNameBySanitizedName(
  sanitizedServerName: string
): string | null
```

**Location**: `McpHub.ts:997`

---

### isMcpEnabled()

Checks if MCP is enabled globally.

```typescript
private async isMcpEnabled(): Promise<boolean>
```

**Location**: `McpHub.ts:663`

---

## Error Handling

### appendErrorMessage()

Adds error to server's error history.

```typescript
private appendErrorMessage(
  connection: McpConnection,
  error: string,
  level: "error" | "warn" | "info" = "error"
): void
```

**Location**: `McpHub.ts:915`

---

### showErrorMessage()

Shows error to user.

```typescript
private showErrorMessage(
  message: string,
  error: unknown
): void
```

**Location**: `McpHub.ts:266`

---

## Configuration Files

**Global config**: `~/.kilocode/mcp_settings.json`
```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": { "API_KEY": "..." }
    }
  }
}
```

**Project config**: `.kilocode/mcp.json` or `.roo/mcp.json`

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `@modelcontextprotocol/sdk` | MCP client SDK |
| `chokidar` | File watching |
| `zod` | Schema validation |
| `ClineProvider` | Webview integration |

---

[← Back to MCP Index](./mcp-Index.md)
