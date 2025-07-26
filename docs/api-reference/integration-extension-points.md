# Integration and Extension Point Documentation

This document provides comprehensive documentation for MCP server integration patterns, VS Code API usage patterns, and
third-party service integration examples and best practices.

## Table of Contents

- [MCP Server Integration](#mcp-server-integration)
- [VS Code API Usage Patterns](#vs-code-api-usage-patterns)
- [Third-Party Service Integrations](#third-party-service-integrations)
- [Extension Point Implementations](#extension-point-implementations)
- [Integration Best Practices](#integration-best-practices)

## MCP Server Integration

The Model Context Protocol (MCP) provides a standardized way to extend the extension's capabilities through external servers.

### MCP Server Configuration

MCP servers are configured through the `.kiro/settings/mcp.json` file in the workspace or user settings.

#### Configuration Schema

```typescript
interface McpServerConfig {
	type: "stdio" | "sse" | "streamable-http"

	// For stdio servers
	command?: string
	args?: string[]
	cwd?: string
	env?: Record<string, string>

	// For SSE/HTTP servers
	url?: string
	headers?: Record<string, string>

	// Common settings
	disabled?: boolean
	timeout?: number
	alwaysAllow?: string[]
	watchPaths?: string[]
	disabledTools?: string[]
}
```

#### Example Configurations

##### Stdio Server (Python)

```json
{
	"mcpServers": {
		"filesystem": {
			"type": "stdio",
			"command": "uvx",
			"args": ["mcp-server-filesystem", "--root", "/path/to/files"],
			"env": {
				"PYTHONPATH": "/custom/path"
			},
			"timeout": 30,
			"alwaysAllow": ["read_file", "list_directory"]
		}
	}
}
```

##### SSE Server

```json
{
	"mcpServers": {
		"web-search": {
			"type": "sse",
			"url": "http://localhost:8080/sse",
			"headers": {
				"Authorization": "Bearer your-token"
			},
			"timeout": 60
		}
	}
}
```

##### Streamable HTTP Server

```json
{
	"mcpServers": {
		"api-service": {
			"type": "streamable-http",
			"url": "http://localhost:3000/mcp",
			"headers": {
				"Content-Type": "application/json"
			}
		}
	}
}
```

### MCP Server Management

#### McpServerManager

The `McpServerManager` provides singleton management for MCP server instances across all webviews.

```typescript
class McpServerManager {
	static async getInstance(context: vscode.ExtensionContext, provider: ClineProvider): Promise<McpHub>

	static unregisterProvider(provider: ClineProvider): void
	static notifyProviders(message: any): void
	static async cleanup(context: vscode.ExtensionContext): Promise<void>
}
```

**Usage Example:**

```typescript
// Get MCP hub instance
const mcpHub = await McpServerManager.getInstance(context, provider)

// Connect to a server
await mcpHub.connectToServer("my-server", {
	type: "stdio",
	command: "python",
	args: ["-m", "my_mcp_server"],
})

// List available tools
const tools = await mcpHub.listTools("my-server")

// Call a tool
const result = await mcpHub.callTool("my-server", "search_files", {
	query: "*.ts",
	path: "/src",
})
```

#### McpHub

The `McpHub` manages connections to multiple MCP servers and provides a unified interface.

```typescript
class McpHub {
	// Server lifecycle
	async connectToServer(serverName: string, config: McpServerConfig): Promise<void>
	async disconnectFromServer(serverName: string): Promise<void>
	async restartServer(serverName: string): Promise<void>

	// Tool operations
	async listTools(serverName?: string): Promise<McpTool[]>
	async callTool(serverName: string, toolName: string, args: any): Promise<McpToolCallResponse>

	// Resource operations
	async listResources(serverName?: string): Promise<McpResource[]>
	async readResource(serverName: string, uri: string): Promise<McpResourceResponse>
	async listResourceTemplates(serverName?: string): Promise<McpResourceTemplate[]>

	// Server information
	getServerStatus(serverName: string): "connected" | "disconnected" | "error"
	getConnectedServers(): string[]

	// Event handling
	on(event: string, listener: Function): void
	off(event: string, listener: Function): void
}
```

### MCP Tool Integration

#### Tool Definition

```typescript
interface McpTool {
	name: string
	description: string
	inputSchema: {
		type: "object"
		properties: Record<string, any>
		required?: string[]
	}
}
```

#### Tool Usage in Extension

```typescript
// In tool handler
export async function useMcpToolTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const serverName = block.params.server_name
	const toolName = block.params.tool_name
	const args = block.params.args

	try {
		// Get MCP hub instance
		const mcpHub = await McpServerManager.getInstance(cline.context, cline.clineProvider)

		// Call the MCP tool
		const result = await mcpHub.callTool(serverName, toolName, args)

		// Process result
		if (result.isError) {
			await handleError(`MCP tool error: ${result.content}`)
		} else {
			pushToolResult(result.content)
		}
	} catch (error) {
		await handleError(`Failed to call MCP tool: ${error.message}`)
	}
}
```

### MCP Resource Integration

#### Resource Access

```typescript
// Access MCP resources
export async function accessMcpResourceTool(
	cline: Task,
	block: ToolUse,
	askApproval: AskApproval,
	handleError: HandleError,
	pushToolResult: PushToolResult,
	removeClosingTag: RemoveClosingTag,
) {
	const serverName = block.params.server_name
	const uri = block.params.uri

	try {
		const mcpHub = await McpServerManager.getInstance(cline.context, cline.clineProvider)
		const resource = await mcpHub.readResource(serverName, uri)

		pushToolResult(resource.contents.map((content) => content.text).join("\n"))
	} catch (error) {
		await handleError(`Failed to access MCP resource: ${error.message}`)
	}
}
```

## VS Code API Usage Patterns

### Command Registration

The extension registers commands through the VS Code API for user interactions.

#### Command Registration Pattern

```typescript
// Command definition
type CommandId =
	| "activationCompleted"
	| "plusButtonClicked"
	| "settingsButtonClicked"
	| "historyButtonClicked"
	| "mcpButtonClicked"
	| "newTask"
	| "clearTask"
// ... other commands

// Registration function
export const registerCommands = (options: RegisterCommandOptions) => {
	const { context } = options

	for (const [id, callback] of Object.entries(getCommandsMap(options))) {
		const command = getCommand(id as CommandId)
		context.subscriptions.push(vscode.commands.registerCommand(command, callback))
	}
}

// Command implementation
const getCommandsMap = ({ context, outputChannel }: RegisterCommandOptions) => ({
	plusButtonClicked: async () => {
		const visibleProvider = getVisibleProviderOrLog(outputChannel)
		if (!visibleProvider) return

		TelemetryService.instance.captureTitleButtonClicked("plus")
		await visibleProvider.removeClineFromStack()
		await visibleProvider.postStateToWebview()
		await visibleProvider.postMessageToWebview({
			type: "action",
			action: "chatButtonClicked",
		})
	},

	newTask: () => handleNewTask(outputChannel),
	// ... other command implementations
})
```

### Webview Provider Integration

#### WebviewViewProvider Implementation

```typescript
export class ClineProvider implements vscode.WebviewViewProvider {
	constructor(
		private context: vscode.ExtensionContext,
		private outputChannel: vscode.OutputChannel,
	) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		context: vscode.WebviewViewResolveContext,
		token: vscode.CancellationToken,
	): void | Thenable<void> {
		this.webviewView = webviewView

		// Configure webview
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this.context.extensionUri],
		}

		// Set HTML content
		webviewView.webview.html = this.getWebviewContent(webviewView.webview)

		// Handle messages
		webviewView.webview.onDidReceiveMessage(
			this.handleWebviewMessage.bind(this),
			undefined,
			this.context.subscriptions,
		)
	}

	private async handleWebviewMessage(message: WebviewMessage) {
		switch (message.type) {
			case "newTask":
				await this.handleNewTask(message.text, message.images)
				break
			case "askResponse":
				await this.handleAskResponse(message.askResponse, message.text, message.images)
				break
			// ... other message handlers
		}
	}
}
```

### File System Integration

#### File Watching

```typescript
class WorkspaceTracker {
	private disposables: vscode.Disposable[] = []
	private filePaths: Set<string> = new Set()

	private registerListeners() {
		const watcher = vscode.workspace.createFileSystemWatcher("**")

		this.disposables.push(
			watcher.onDidCreate(async (uri) => {
				await this.addFilePath(uri.fsPath)
				this.workspaceDidUpdate()
			}),
		)

		this.disposables.push(
			watcher.onDidDelete(async (uri) => {
				if (await this.removeFilePath(uri.fsPath)) {
					this.workspaceDidUpdate()
				}
			}),
		)

		this.disposables.push(watcher)
	}

	dispose() {
		this.disposables.forEach((d) => d.dispose())
	}
}
```

#### Document Editing

```typescript
// Apply text edits to documents
async function applyWorkspaceEdit(uri: vscode.Uri, edits: vscode.TextEdit[]): Promise<boolean> {
	const workspaceEdit = new vscode.WorkspaceEdit()
	workspaceEdit.set(uri, edits)

	return await vscode.workspace.applyEdit(workspaceEdit)
}

// Create text edits
function createTextEdit(
	startLine: number,
	startChar: number,
	endLine: number,
	endChar: number,
	newText: string,
): vscode.TextEdit {
	const range = new vscode.Range(new vscode.Position(startLine, startChar), new vscode.Position(endLine, endChar))
	return new vscode.TextEdit(range, newText)
}
```

### Terminal Integration

#### Terminal Management

```typescript
export class Terminal extends BaseTerminal {
	public terminal: vscode.Terminal

	constructor(id: number, terminal: vscode.Terminal | undefined, cwd: string) {
		super("vscode", id, cwd)

		const env = Terminal.getEnv()
		const iconPath = new vscode.ThemeIcon("rocket")

		this.terminal =
			terminal ??
			vscode.window.createTerminal({
				cwd,
				name: "Kilo Code",
				iconPath,
				env,
			})
	}

	public runCommand(command: string, callbacks: RooTerminalCallbacks): RooTerminalProcessResultPromise {
		this.busy = true

		const process = new TerminalProcess(this)
		process.command = command
		this.process = process

		// Set up event handlers
		process.on("line", (line) => callbacks.onLine(line, process))
		process.once("completed", (output) => callbacks.onCompleted(output, process))

		// Wait for shell integration and execute
		return pWaitFor(() => this.terminal.shellIntegration !== undefined, {
			timeout: Terminal.getShellIntegrationTimeout(),
		}).then(() => {
			process.run(command)
		})
	}
}
```

#### Shell Integration

```typescript
export class ShellIntegrationManager {
	static terminalTmpDirs = new Map<number, string>()

	static zshCleanupTmpDir(terminalId: number): void {
		const tmpDir = this.terminalTmpDirs.get(terminalId)
		if (tmpDir) {
			try {
				fs.rmSync(tmpDir, { recursive: true, force: true })
				this.terminalTmpDirs.delete(terminalId)
			} catch (error) {
				console.warn(`Failed to cleanup temp directory: ${error}`)
			}
		}
	}
}
```

## Third-Party Service Integrations

### Browser Automation (Puppeteer)

#### Browser Session Management

```typescript
export class BrowserSession {
	private browser?: Browser
	private page?: Page
	private isUsingRemoteBrowser: boolean = false

	constructor(private context: vscode.ExtensionContext) {}

	private async ensureChromiumExists(): Promise<PCRStats> {
		const globalStoragePath = this.context?.globalStorageUri?.fsPath
		if (!globalStoragePath) {
			throw new Error("Global storage uri is invalid")
		}

		const puppeteerDir = path.join(globalStoragePath, "puppeteer")
		const dirExists = await fileExistsAtPath(puppeteerDir)
		if (!dirExists) {
			await fs.mkdir(puppeteerDir, { recursive: true })
		}

		// Download Chromium if needed
		const stats: PCRStats = await PCR({
			downloadPath: puppeteerDir,
		})

		return stats
	}

	private async launchLocalBrowser(): Promise<void> {
		const stats = await this.ensureChromiumExists()
		this.browser = await stats.puppeteer.launch({
			args: ["--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"],
			executablePath: stats.executablePath,
			defaultViewport: this.getViewport(),
		})
		this.isUsingRemoteBrowser = false
	}

	async navigateToUrl(url: string): Promise<BrowserActionResult> {
		if (!this.page) {
			throw new Error("Browser not initialized")
		}

		try {
			await this.page.goto(url, {
				waitUntil: "networkidle0",
				timeout: BROWSER_NAVIGATION_TIMEOUT,
			})

			return {
				success: true,
				screenshot: await this.takeScreenshot(),
			}
		} catch (error) {
			return {
				success: false,
				error: error.message,
			}
		}
	}
}
```

#### Browser Discovery

```typescript
export async function discoverChromeHostUrl(): Promise<string | null> {
	// Try cached endpoint first
	const cachedUrl = context.globalState.get("cachedChromeHostUrl")
	if (cachedUrl && (await tryChromeHostUrl(cachedUrl))) {
		return cachedUrl
	}

	// Common Chrome debugging ports
	const commonPorts = [9222, 9223, 9224]
	const commonHosts = ["localhost", "127.0.0.1"]

	// Try common combinations
	for (const host of commonHosts) {
		for (const port of commonPorts) {
			const url = `http://${host}:${port}`
			if (await tryChromeHostUrl(url)) {
				return url
			}
		}
	}

	// Try Docker host discovery
	const dockerHostIP = await getDockerHostIP()
	if (dockerHostIP) {
		for (const port of commonPorts) {
			const url = `http://${dockerHostIP}:${port}`
			if (await tryChromeHostUrl(url)) {
				return url
			}
		}
	}

	return null
}
```

### Cloud Service Integration

#### Authentication and API

```typescript
// Cloud service initialization
await CloudService.createInstance(context, {
	stateChanged: () => ClineProvider.getVisibleInstance()?.postStateToWebview(),
	log: cloudLogger,
})

// Usage in components
const cloudService = CloudService.getInstance()
const userInfo = await cloudService.getUserInfo()
const isAuthenticated = cloudService.isAuthenticated()
```

### Telemetry Integration

#### Telemetry Service Setup

```typescript
// Initialize telemetry service
const telemetryService = TelemetryService.createInstance()

try {
	telemetryService.register(new PostHogTelemetryClient())
} catch (error) {
	console.warn("Failed to register PostHogTelemetryClient:", error)
}

// Usage in code
TelemetryService.instance.captureTitleButtonClicked("plus")
TelemetryService.instance.captureEvent("task_completed", {
	duration: taskDuration,
	toolsUsed: toolNames,
})
```

## Extension Point Implementations

### Code Actions

#### Code Action Provider

```typescript
export class CodeActionProvider implements vscode.CodeActionProvider {
	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken,
	): vscode.ProviderResult<(vscode.CodeAction | vscode.Command)[]> {
		const actions: vscode.CodeAction[] = []

		// Create "Fix with Kilo" action
		const fixAction = new vscode.CodeAction("Fix with Kilo", vscode.CodeActionKind.QuickFix)

		fixAction.command = {
			command: "kilo.fixWithAI",
			title: "Fix with Kilo",
			arguments: [document.uri, range],
		}

		actions.push(fixAction)

		return actions
	}
}

// Registration
context.subscriptions.push(
	vscode.languages.registerCodeActionsProvider({ scheme: "file" }, new CodeActionProvider(), {
		providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
	}),
)
```

### Autocomplete Provider

#### Inline Completion Provider

```typescript
export class AutocompleteProvider implements vscode.InlineCompletionItemProvider {
	async provideInlineCompletionItems(
		document: vscode.TextDocument,
		position: vscode.Position,
		context: vscode.InlineCompletionContext,
		token: vscode.CancellationToken,
	): Promise<vscode.InlineCompletionItem[]> {
		// Gather context
		const contextGatherer = new ContextGatherer()
		const codeContext = await contextGatherer.gatherContext(document, position)

		// Get completion from AI
		const completion = await this.getCompletion(codeContext, token)

		if (!completion || token.isCancellationRequested) {
			return []
		}

		// Create completion item
		const item = new vscode.InlineCompletionItem(completion.text, new vscode.Range(position, position))

		return [item]
	}

	private async getCompletion(
		context: CodeContext,
		token: vscode.CancellationToken,
	): Promise<{ text: string } | null> {
		// Implementation details...
	}
}

// Registration with experiment flag
export function registerAutocomplete(context: vscode.ExtensionContext): void {
	let autocompleteDisposable: vscode.Disposable | null = null

	const checkAndUpdateProvider = () => {
		const experiments = ContextProxy.instance?.getGlobalState("experiments") ?? {}
		const shouldBeEnabled = experiments[EXPERIMENT_IDS.AUTOCOMPLETE] ?? false

		if (shouldBeEnabled && !autocompleteDisposable) {
			autocompleteDisposable = vscode.languages.registerInlineCompletionItemProvider(
				{ pattern: "**" },
				new AutocompleteProvider(),
			)
		} else if (!shouldBeEnabled && autocompleteDisposable) {
			autocompleteDisposable.dispose()
			autocompleteDisposable = null
		}
	}

	checkAndUpdateProvider()
	const interval = setInterval(checkAndUpdateProvider, 5000)

	context.subscriptions.push({
		dispose: () => {
			clearInterval(interval)
			autocompleteDisposable?.dispose()
		},
	})
}
```

### URI Handlers

#### Custom URI Scheme Handling

```typescript
export async function handleUri(uri: vscode.Uri): Promise<void> {
	const path = uri.path
	const query = new URLSearchParams(uri.query)

	switch (path) {
		case "/auth/callback":
			await handleAuthCallback(query)
			break
		case "/share":
			await handleShareLink(query)
			break
		case "/task":
			await handleTaskLink(query)
			break
		default:
			vscode.window.showErrorMessage(`Unknown URI path: ${path}`)
	}
}

async function handleAuthCallback(query: URLSearchParams): Promise<void> {
	const code = query.get("code")
	const state = query.get("state")

	if (!code || !state) {
		vscode.window.showErrorMessage("Invalid auth callback")
		return
	}

	// Process authentication
	const cloudService = CloudService.getInstance()
	await cloudService.handleAuthCallback(code, state)

	// Update UI
	const provider = ClineProvider.getVisibleInstance()
	await provider?.postStateToWebview()
}

// Registration
context.subscriptions.push(
	vscode.window.registerUriHandler({
		handleUri: handleUri,
	}),
)
```

## Integration Best Practices

### Error Handling

#### Graceful Degradation

```typescript
// Service initialization with fallback
async function initializeService<T>(serviceFactory: () => Promise<T>, fallback: T, serviceName: string): Promise<T> {
	try {
		return await serviceFactory()
	} catch (error) {
		console.warn(`Failed to initialize ${serviceName}:`, error)
		return fallback
	}
}

// Usage
const browserSession = await initializeService(() => new BrowserSession(context), null, "BrowserSession")
```

#### Retry Logic

```typescript
async function withRetry<T>(operation: () => Promise<T>, maxAttempts: number = 3, delay: number = 1000): Promise<T> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await operation()
		} catch (error) {
			if (attempt === maxAttempts) {
				throw error
			}
			await new Promise((resolve) => setTimeout(resolve, delay * attempt))
		}
	}
	throw new Error("Max attempts reached")
}
```

### Resource Management

#### Disposable Pattern

```typescript
class ResourceManager {
	private disposables: vscode.Disposable[] = []

	register<T extends vscode.Disposable>(disposable: T): T {
		this.disposables.push(disposable)
		return disposable
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
		this.disposables.length = 0
	}
}

// Usage in extension
export async function activate(context: vscode.ExtensionContext) {
	const resourceManager = new ResourceManager()

	// Register disposables
	resourceManager.register(vscode.commands.registerCommand("kilo.command", handler))

	resourceManager.register(vscode.workspace.onDidChangeTextDocument(handler))

	// Cleanup on deactivation
	context.subscriptions.push(resourceManager)
}
```

### Configuration Management

#### Settings Validation

```typescript
function validateConfiguration(): boolean {
	const config = vscode.workspace.getConfiguration("kilo")
	const apiKey = config.get<string>("apiKey")

	if (!apiKey) {
		vscode.window.showErrorMessage("Kilo API key is required. Please configure it in settings.")
		return false
	}

	return true
}

// Configuration change handling
vscode.workspace.onDidChangeConfiguration((event) => {
	if (event.affectsConfiguration("kilo")) {
		// Reload configuration
		reloadConfiguration()
	}
})
```

### Performance Optimization

#### Lazy Loading

```typescript
class LazyService {
	private _instance: ServiceType | null = null

	async getInstance(): Promise<ServiceType> {
		if (!this._instance) {
			this._instance = await this.createInstance()
		}
		return this._instance
	}

	private async createInstance(): Promise<ServiceType> {
		// Heavy initialization logic
	}
}
```

#### Debouncing

```typescript
function createDebouncedHandler<T extends any[]>(handler: (...args: T) => void, delay: number): (...args: T) => void {
	let timeoutId: NodeJS.Timeout | null = null

	return (...args: T) => {
		if (timeoutId) {
			clearTimeout(timeoutId)
		}

		timeoutId = setTimeout(() => {
			handler(...args)
			timeoutId = null
		}, delay)
	}
}

// Usage
const debouncedUpdate = createDebouncedHandler(updateUI, 250)
```

This documentation provides comprehensive guidance for integrating with MCP servers, using VS Code APIs effectively, and
implementing third-party service integrations following best practices.
