# MCP (Model Context Protocol) Integration

The MCP integration service manages connections to Model Context Protocol servers, providing the AI assistant
with access to external tools, resources, and capabilities. This service handles server discovery, connection
management, and tool execution coordination.

## Location

`src/services/mcp/`

## Core Components

### McpHub.ts

The central hub for managing MCP server connections and operations.

**Key Features:**

- **Multi-server management**: Handles multiple MCP servers simultaneously
- **Connection lifecycle**: Manages server connection, disconnection, and reconnection
- **Configuration management**: Supports both global and project-specific configurations
- **Real-time monitoring**: Tracks server status and health
- **Error handling**: Comprehensive error recovery and reporting

### Architecture

#### Connection Management

```typescript
export type McpConnection = {
	server: McpServer
	client: Client
	transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport
}
```

**Transport Types:**

- **Stdio**: Local process communication via stdin/stdout
- **SSE**: Server-Sent Events for web-based servers
- **Streamable HTTP**: HTTP-based streaming communication

#### Configuration Schema

```typescript
const ServerConfigSchema = z.union([
	// Stdio configuration
	BaseConfigSchema.extend({
		type: z.enum(["stdio"]).optional(),
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		cwd: z.string().default(() => process.cwd()),
		env: z.record(z.string()).optional(),
	}),
	// SSE configuration
	BaseConfigSchema.extend({
		type: z.enum(["sse"]).optional(),
		url: z.string().url(),
		headers: z.record(z.string()).optional(),
	}),
	// Streamable HTTP configuration
	BaseConfigSchema.extend({
		type: z.enum(["streamable-http"]).optional(),
		url: z.string().url(),
		headers: z.record(z.string()).optional(),
	}),
])
```

## Configuration Management

### Global Configuration

Located at `~/.kiro/settings/mcp.json`:

```json
{
	"mcpServers": {
		"filesystem": {
			"command": "uvx",
			"args": ["mcp-server-filesystem", "/path/to/allowed/files"],
			"disabled": false,
			"alwaysAllow": ["list_directory", "read_file"]
		}
	}
}
```

### Project Configuration

Located at `.kiro/mcp.json` or `.mcp.json` in project root:

```json
{
	"mcpServers": {
		"project-specific": {
			"command": "node",
			"args": ["./scripts/mcp-server.js"],
			"env": {
				"PROJECT_ROOT": "${workspaceFolder}"
			}
		}
	}
}
```

### Configuration Features

- **Variable injection**: Support for environment variables and workspace paths
- **Validation**: Comprehensive schema validation with user-friendly error messages
- **Hot reloading**: Automatic configuration updates without restart
- **Precedence**: Project configurations override global configurations

## Server Lifecycle Management

### Connection Process

```typescript
private async connectToServer(
  name: string,
  config: ServerConfig,
  source: "global" | "project"
): Promise<void> {
  // 1. Validate configuration
  const validatedConfig = this.validateServerConfig(config, name)

  // 2. Create transport based on type
  const transport = this.createTransport(validatedConfig)

  // 3. Create MCP client
  const client = new Client(clientInfo, capabilities)

  // 4. Establish connection
  await client.connect(transport)

  // 5. Initialize server capabilities
  await this.initializeServerCapabilities(client, name)
}
```

### Status Monitoring

Server status tracking with real-time updates:

- **Connecting**: Initial connection attempt
- **Connected**: Successfully connected and operational
- **Disconnected**: Connection lost or failed
- **Error**: Connection error with details

### Error Handling

Comprehensive error handling and recovery:

```typescript
private appendErrorMessage(
  connection: McpConnection,
  error: string,
  level: "error" | "warn" | "info" = "error"
) {
  // Truncate long error messages
  const truncatedError = error.length > MAX_ERROR_LENGTH
    ? `${error.substring(0, MAX_ERROR_LENGTH)}...(truncated)`
    : error

  // Add to error history
  connection.server.errorHistory.push({
    message: truncatedError,
    timestamp: Date.now(),
    level
  })

  // Update current error display
  connection.server.error = truncatedError
}
```

## Tool and Resource Management

### Tool Discovery

Automatic discovery of available tools from connected servers:

```typescript
private async fetchToolsList(
  serverName: string,
  source: "global" | "project"
): Promise<McpTool[]> {
  const connection = this.findConnection(serverName, source)
  if (!connection?.client) return []

  const result = await connection.client.listTools()
  return result.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }))
}
```

### Resource Access

Access to server-provided resources:

```typescript
async readResource(
  serverName: string,
  uri: string
): Promise<McpResourceResponse> {
  const connection = this.findConnection(serverName)
  if (!connection) {
    throw new Error(`Server ${serverName} not found`)
  }

  const result = await connection.client.readResource({ uri })
  return {
    contents: result.contents,
    mimeType: result.mimeType
  }
}
```

### Tool Execution

Coordinated tool execution with error handling:

```typescript
async callTool(
  serverName: string,
  toolName: string,
  arguments: Record<string, unknown>
): Promise<McpToolCallResponse> {
  const connection = this.findConnection(serverName)
  if (!connection) {
    throw new Error(`Server ${serverName} not found`)
  }

  try {
    const result = await connection.client.callTool({
      name: toolName,
      arguments
    })

    return {
      content: result.content,
      isError: result.isError
    }
  } catch (error) {
    this.appendErrorMessage(connection, error.message)
    throw error
  }
}
```

## File System Watching

### Configuration File Watching

Automatic detection of configuration changes:

```typescript
private async watchMcpSettingsFile(): Promise<void> {
  const settingsPath = await this.getMcpSettingsFilePath()
  const settingsPattern = new vscode.RelativePattern(
    path.dirname(settingsPath),
    path.basename(settingsPath)
  )

  this.settingsWatcher = vscode.workspace.createFileSystemWatcher(settingsPattern)

  this.settingsWatcher.onDidChange((uri) => {
    this.debounceConfigChange(settingsPath, "global")
  })
}
```

### Debounced Updates

Prevents excessive reconnections during configuration changes:

```typescript
private debounceConfigChange(filePath: string, source: "global" | "project"): void {
  const key = `${source}-${filePath}`

  // Clear existing timer
  const existingTimer = this.configChangeDebounceTimers.get(key)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  // Set new timer
  const timer = setTimeout(async () => {
    this.configChangeDebounceTimers.delete(key)
    await this.handleConfigFileChange(filePath, source)
  }, 500) // 500ms debounce

  this.configChangeDebounceTimers.set(key, timer)
}
```

## Integration Points

### Task Integration

MCP tools are integrated into the main task execution flow:

```typescript
// In Task.ts
const mcpHub = this.providerRef.deref()?.mcpHub
if (mcpHub) {
	const result = await mcpHub.callTool(serverName, toolName, args)
	// Process result
}
```

### Webview Integration

Real-time server status updates to the UI:

```typescript
private async notifyWebviewOfServerChanges(): Promise<void> {
  const provider = this.providerRef.deref()
  if (provider) {
    await provider.postStateToWebview()
  }
}
```

### Permission System

Integration with user approval system:

```typescript
// Tools can be auto-approved based on configuration
const isAutoApproved = server.alwaysAllow?.includes(toolName)
if (!isAutoApproved) {
	const approved = await askUserApproval(toolName, arguments)
	if (!approved) return
}
```

## Security Considerations

### Access Control

- **Server isolation**: Each server runs in its own process/context
- **Permission management**: User control over tool execution
- **Resource restrictions**: Configurable access limitations

### Configuration Validation

- **Schema enforcement**: Strict validation of server configurations
- **Path validation**: Prevent access outside allowed directories
- **Command validation**: Validate executable paths and arguments

### Error Isolation

- **Server failures**: Individual server failures don't affect others
- **Error containment**: Errors are logged and reported without crashing
- **Resource cleanup**: Proper cleanup of failed connections

## Performance Optimizations

### Connection Pooling

- **Persistent connections**: Reuse connections across tool calls
- **Connection limits**: Prevent resource exhaustion
- **Cleanup**: Automatic cleanup of unused connections

### Caching

- **Tool metadata**: Cache tool definitions and schemas
- **Resource content**: Cache frequently accessed resources
- **Configuration**: Cache parsed configurations

### Async Operations

- **Non-blocking**: All operations are asynchronous
- **Parallel execution**: Multiple tool calls can execute concurrently
- **Timeout handling**: Prevent hanging operations

## Testing

### Unit Tests

- **Configuration validation**: Test schema validation and error handling
- **Connection management**: Test connection lifecycle
- **Tool execution**: Test tool calling and error handling

### Integration Tests

- **End-to-end workflows**: Test complete MCP integration
- **Error scenarios**: Test error handling and recovery
- **Configuration changes**: Test hot reloading

### Mock Servers

- **Test servers**: Mock MCP servers for testing
- **Error simulation**: Simulate various error conditions
- **Performance testing**: Test under load

## Future Enhancements

- **Server discovery**: Automatic discovery of available MCP servers
- **Load balancing**: Distribute tool calls across multiple servers
- **Caching improvements**: More sophisticated caching strategies
- **Monitoring**: Enhanced monitoring and metrics
- **Security enhancements**: Additional security measures and validation
