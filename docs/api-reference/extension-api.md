# Extension API Reference

This document provides comprehensive API documentation for the core extension interfaces, tool implementations, and service APIs.

## Table of Contents

- [Core Task API](#core-task-api)
- [Tool System](#tool-system)
- [Extension Provider](#extension-provider)
- [Service Layer APIs](#service-layer-apis)
- [Message Protocols](#message-protocols)

## Core Task API

The `Task` class is the central orchestrator for AI assistant interactions and tool execution.

### Task Class

```typescript
class Task extends EventEmitter {
	constructor(
		providerSettings: ProviderSettings,
		cwd: string,
		isHidden: boolean,
		alwaysAllowReadOnly: boolean,
		historyItem: HistoryItem,
		clineProvider: ClineProvider,
		abort?: AbortController,
	)
}
```

#### Key Properties

- `cwd: string` - Current working directory for the task
- `api: ApiHandler` - API handler for model communication
- `consecutiveMistakeCount: number` - Tracks consecutive tool errors
- `diffViewProvider: DiffViewProvider` - Manages diff view operations
- `rooIgnoreController: RooIgnoreController` - Handles file access permissions
- `rooProtectedController: RooProtectedController` - Manages write-protected files

#### Core Methods

##### `say(type: string, ...args: any[]): Promise<void>`

Sends a message to the webview with localized content.

**Parameters:**

- `type: string` - Message type key for localization
- `...args: any[]` - Arguments for message formatting

**Example:**

```typescript
await task.say("tool_use", "readFile", "/path/to/file.ts")
```

##### `ask(type: string, text?: string): Promise<ClineAskResponse>`

Requests user input through the webview interface.

**Parameters:**

- `type: string` - Type of ask request
- `text?: string` - Optional prompt text

**Returns:** Promise resolving to user response

**Example:**

```typescript
const response = await task.ask("tool", "Do you want to proceed with file modification?")
```

##### `startTask(): Promise<void>`

Initiates the task execution loop with the AI model.

**Usage:**

```typescript
const task = new Task(providerSettings, cwd, false, false, historyItem, clineProvider)
await task.startTask()
```

## Tool System

The extension provides a comprehensive tool system for AI model interactions with the development environment.

### Tool Interface

```typescript
interface ToolUse {
	tool: string
	params: Record<string, any>
	partial?: boolean
}

type AskApproval = (message: string) => Promise<boolean>
type HandleError = (error: string) => Promise<void>
type PushToolResult = (result: string) => Promise<void>
type RemoveClosingTag = (tag: string, content: string) => string
```

### Core Tools

#### File Operations

##### `readFileTool`

Reads file contents with support for multiple files and line ranges.

**Parameters:**

```typescript
interface ReadFileParams {
	path?: string // Legacy single file path
	args?: string // XML args for multiple files
	start_line?: string // Starting line number
	end_line?: string // Ending line number
}
```

**XML Args Format:**

```xml
<args>
  <file>
    <path>src/components/Button.tsx</path>
    <lineRanges>
      <range><start>10</start><end>50</end></range>
    </lineRanges>
  </file>
  <file>
    <path>src/types/index.ts</path>
  </file>
</args>
```

**Usage Example:**

```typescript
await readFileTool(
	task,
	{ tool: "read_file", params: { path: "src/app.ts" } },
	askApproval,
	handleError,
	pushToolResult,
	removeClosingTag,
)
```

##### `writeToFileTool`

Creates or modifies files with content validation and approval flow.

**Parameters:**

```typescript
interface WriteFileParams {
	path: string // File path relative to workspace
	content: string // File content to write
	line_count?: string // Expected line count for validation
}
```

**Features:**

- Automatic content preprocessing (removes markdown code blocks)
- Write protection validation
- Outside workspace detection
- Line count prediction validation
- Diff view integration

**Usage Example:**

```typescript
await writeToFileTool(
	task,
	{
		tool: "write_to_file",
		params: {
			path: "src/new-component.tsx",
			content: "export const Component = () => <div>Hello</div>",
		},
	},
	askApproval,
	handleError,
	pushToolResult,
	removeClosingTag,
)
```

#### Search and Discovery

##### `searchFilesTool`

Performs regex-based search across files in the workspace.

**Parameters:**

```typescript
interface SearchFilesParams {
	regex: string // Search pattern (regex)
	file_pattern?: string // File glob pattern to limit search
	case_sensitive?: boolean // Case sensitivity flag
}
```

##### `listFilesTool`

Lists files and directories in the workspace with filtering options.

**Parameters:**

```typescript
interface ListFilesParams {
	path?: string // Directory path to list
	recursive?: boolean // Recursive listing flag
	file_pattern?: string // File pattern filter
}
```

#### Code Analysis

##### `codebaseSearchTool`

Semantic search across the codebase using vector embeddings.

**Parameters:**

```typescript
interface CodebaseSearchParams {
	query: string // Search query
	max_results?: number // Maximum results to return
}
```

## Extension Provider

The `ClineProvider` class manages the VS Code webview and coordinates between the extension and UI.

### ClineProvider Class

```typescript
class ClineProvider implements vscode.WebviewViewProvider {
  constructor(
    private context: vscode.ExtensionContext,
    private outputChannel: vscode.OutputChannel
  )
}
```

#### Key Methods

##### `postMessageToWebview(message: ExtensionMessage): void`

Sends messages from extension to webview.

**Parameters:**

- `message: ExtensionMessage` - Message object with type and data

**Example:**

```typescript
provider.postMessageToWebview({
	type: "state",
	state: { currentTask: taskData },
})
```

##### `handleWebviewMessage(message: WebviewMessage): Promise<void>`

Processes messages received from the webview.

**Message Types:**

- `newTask` - Start new AI task
- `askResponse` - User response to AI question
- `selectImages` - Image selection for context
- `exportCurrentTask` - Export task to markdown

## Service Layer APIs

### MCP (Model Context Protocol) Hub

The `McpHub` manages connections to MCP servers for extended tool capabilities.

#### McpHub Class

```typescript
class McpHub {
  constructor(private clineProvider: ClineProvider)

  // Server management
  async connectToServer(serverName: string, config: McpServerConfig): Promise<void>
  async disconnectFromServer(serverName: string): Promise<void>

  // Tool operations
  async listTools(serverName?: string): Promise<McpTool[]>
  async callTool(serverName: string, toolName: string, args: any): Promise<McpToolCallResponse>

  // Resource operations
  async listResources(serverName?: string): Promise<McpResource[]>
  async readResource(serverName: string, uri: string): Promise<McpResourceResponse>
}
```

#### Server Configuration

```typescript
interface McpServerConfig {
	type: "stdio" | "sse" | "streamable-http"
	command?: string // For stdio servers
	args?: string[] // Command arguments
	env?: Record<string, string> // Environment variables
	url?: string // For SSE/HTTP servers
	headers?: Record<string, string> // HTTP headers
	disabled?: boolean // Enable/disable server
	timeout?: number // Connection timeout
	alwaysAllow?: string[] // Auto-approved tools
}
```

### Browser Service

The `BrowserSession` provides web automation capabilities through Puppeteer.

#### BrowserSession Class

```typescript
class BrowserSession {
	constructor(context: vscode.ExtensionContext)

	async launchBrowser(): Promise<void>
	async navigateToUrl(url: string): Promise<BrowserActionResult>
	async clickElement(selector: string): Promise<BrowserActionResult>
	async typeText(selector: string, text: string): Promise<BrowserActionResult>
	async takeScreenshot(options?: ScreenshotOptions): Promise<string>
	async closeBrowser(): Promise<void>
}
```

### Autocomplete Provider

The `AutocompleteProvider` delivers AI-powered code completions.

#### AutocompleteProvider Class

```typescript
class AutocompleteProvider implements vscode.InlineCompletionItemProvider {
	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[]>
}
```

#### Configuration

```typescript
interface AutocompleteConfig {
	enabled: boolean
	apiConfigId: string
	debounceMs: number
	maxCompletionsPerContext: number
}
```

## Message Protocols

### Extension to Webview Messages

```typescript
interface ExtensionMessage {
  type: "action" | "state" | "theme" | "invoke" | "messageUpdated" | ...
  // Type-specific payload properties
}
```

#### Key Message Types

##### State Updates

```typescript
{
  type: "state"
  state: {
    version: string
    clineMessages: ClineMessage[]
    taskHistory: HistoryItem[]
    shouldShowAnnouncement: boolean
  }
}
```

##### Theme Updates

```typescript
{
	type: "theme"
	text: string
	backgroundColor: string
	buttonBackgroundColor: string
}
```

### Webview to Extension Messages

```typescript
interface WebviewMessage {
  type: "newTask" | "askResponse" | "selectImages" | "exportCurrentTask" | ...
  // Type-specific payload properties
}
```

#### Common Message Types

##### New Task Request

```typescript
{
  type: "newTask"
  text: string
  images?: string[]
  mode?: string
}
```

##### User Response

```typescript
{
  type: "askResponse"
  askResponse: ClineAskResponse
  text?: string
  images?: string[]
}
```

## Error Handling

### Tool Error Patterns

All tools follow consistent error handling patterns:

```typescript
// Parameter validation
if (!requiredParam) {
	task.consecutiveMistakeCount++
	task.recordToolError(toolName)
	pushToolResult(await task.sayAndCreateMissingParamError(toolName, "paramName"))
	return
}

// Permission validation
if (!accessAllowed) {
	await task.say("access_denied", path)
	pushToolResult(formatResponse.toolError("Access denied"))
	return
}

// Operation error handling
try {
	// Tool operation
} catch (error) {
	await task.say("operation_failed", error.message)
	pushToolResult(formatResponse.toolError(error.message))
}
```

### Service Error Handling

Services implement graceful degradation and retry logic:

```typescript
// Connection retry with exponential backoff
async connectWithRetry(maxAttempts: number = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await this.connect()
      return true
    } catch (error) {
      if (attempt === maxAttempts) throw error
      await delay(Math.pow(2, attempt) * 1000)
    }
  }
  return false
}
```

## Integration Patterns

### Tool Registration

Tools are registered through the tool system with consistent interfaces:

```typescript
const toolHandlers = {
	read_file: readFileTool,
	write_to_file: writeToFileTool,
	search_files: searchFilesTool,
	// ... other tools
}

// Tool execution
const handler = toolHandlers[toolUse.tool]
if (handler) {
	await handler(task, toolUse, askApproval, handleError, pushToolResult, removeClosingTag)
}
```

### Service Integration

Services are integrated through dependency injection and event-driven patterns:

```typescript
class Task {
	constructor(
		// ... other params
		private mcpHub: McpHub,
		private browserSession: BrowserSession,
	) {
		// Service initialization
		this.mcpHub.on("toolResult", this.handleMcpResult.bind(this))
	}
}
```

### Extension Point Usage

The extension leverages VS Code APIs through well-defined patterns:

```typescript
// Command registration
vscode.commands.registerCommand("cline.newTask", async () => {
	await clineProvider.clearTask()
	await clineProvider.postMessageToWebview({ type: "action", action: "newTask" })
})

// Event handling
vscode.workspace.onDidChangeTextDocument((event) => {
	if (event.document.uri.scheme === "file") {
		fileContextTracker.updateContext(event.document)
	}
})
```

This API reference provides the foundation for understanding and extending the Kiro extension's capabilities. Each component is
designed with clear interfaces and consistent patterns to facilitate development and maintenance.
