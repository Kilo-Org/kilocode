// Shared test setup for ClineProvider tests
import Anthropic from "@anthropic-ai/sdk"
import * as vscode from "vscode"
import axios from "axios"
import { TelemetryService } from "@roo-code/telemetry"
import { ContextProxy } from "../core/config/ContextProxy"
import { ClineProvider } from "../core/webview/ClineProvider"

// All the common mocks
export function setupCommonMocks() {
	vi.mock("../../prompts/sections/custom-instructions")

	vi.mock("p-wait-for", () => ({
		__esModule: true,
		default: vi.fn().mockResolvedValue(undefined),
	}))

	vi.mock("fs/promises", () => ({
		mkdir: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue(""),
		unlink: vi.fn().mockResolvedValue(undefined),
		rmdir: vi.fn().mockResolvedValue(undefined),
	}))

	vi.mock("axios", () => ({
		default: {
			get: vi.fn().mockResolvedValue({ data: { data: [] } }),
			post: vi.fn(),
		},
		get: vi.fn().mockResolvedValue({ data: { data: [] } }),
		post: vi.fn(),
	}))

	vi.mock("../../../utils/safeWriteJson")

	vi.mock("../integrations/workspace/WorkspaceTracker", () => {
		return {
			default: vi.fn().mockImplementation(() => ({
				initializeFilePaths: vi.fn(),
				dispose: vi.fn(),
			})),
		}
	})

	vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
		CallToolResultSchema: {},
		ListResourcesResultSchema: {},
		ListResourceTemplatesResultSchema: {},
		ListToolsResultSchema: {},
		ReadResourceResultSchema: {},
		ErrorCode: {
			InvalidRequest: "InvalidRequest",
			MethodNotFound: "MethodNotFound",
			InternalError: "InternalError",
		},
		McpError: class McpError extends Error {
			code: string
			constructor(code: string, message: string) {
				super(message)
				this.code = code
				this.name = "McpError"
			}
		},
	}))

	vi.mock("../../../services/browser/BrowserSession", () => ({
		BrowserSession: vi.fn().mockImplementation(() => ({
			testConnection: vi.fn().mockImplementation(async (url) => {
				if (url === "http://localhost:9222") {
					return {
						success: true,
						message: "Successfully connected to Chrome",
						endpoint: "ws://localhost:9222/devtools/browser/123",
					}
				} else {
					return {
						success: false,
						message: "Failed to connect to Chrome",
						endpoint: undefined,
					}
				}
			}),
		})),
	}))

	vi.mock("../../../services/browser/browserDiscovery", () => ({
		discoverChromeHostUrl: vi.fn().mockResolvedValue("http://localhost:9222"),
		tryChromeHostUrl: vi.fn().mockImplementation(async (url) => {
			return url === "http://localhost:9222"
		}),
		testBrowserConnection: vi.fn(),
	}))

	const mockAddCustomInstructions = vi.fn().mockResolvedValue("Combined instructions")
	;(vi.mocked(import("../core/prompts/sections/custom-instructions")) as any).addCustomInstructions =
		mockAddCustomInstructions

	vi.mock("delay", () => {
		const delayFn = (_ms: number) => Promise.resolve()
		delayFn.createDelay = () => delayFn
		delayFn.reject = () => Promise.reject(new Error("Delay rejected"))
		delayFn.range = () => Promise.resolve()
		return { default: delayFn }
	})

	vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
		Client: vi.fn().mockImplementation(() => ({
			connect: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			listTools: vi.fn().mockResolvedValue({ tools: [] }),
			callTool: vi.fn().mockResolvedValue({ content: [] }),
		})),
	}))

	vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
		StdioClientTransport: vi.fn().mockImplementation(() => ({
			connect: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
		})),
	}))

	vi.mock("vscode", () => ({
		ExtensionContext: vi.fn(),
		OutputChannel: vi.fn(),
		WebviewView: vi.fn(),
		Uri: {
			joinPath: vi.fn(),
			file: vi.fn(),
		},
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		commands: {
			executeCommand: vi.fn().mockResolvedValue(undefined),
		},
		window: {
			showInformationMessage: vi.fn(),
			showWarningMessage: vi.fn(),
			showErrorMessage: vi.fn(),
			onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
			createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
		},
		workspace: {
			getConfiguration: vi.fn().mockReturnValue({
				get: vi.fn().mockReturnValue([]),
				update: vi.fn(),
			}),
			onDidChangeConfiguration: vi.fn().mockImplementation(() => ({
				dispose: vi.fn(),
			})),
			onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
			onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
			onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
			onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
			createFileSystemWatcher: vi.fn().mockReturnValue({
				dispose: vi.fn(),
				onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
				onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
				onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
			}),
		},
		env: {
			uriScheme: "vscode",
			language: "en",
			uiKind: 1,
			appName: "Visual Studio Code",
		},
		ExtensionMode: {
			Production: 1,
			Development: 2,
			Test: 3,
		},
		UIKind: {
			1: "Desktop",
			2: "Web",
			Desktop: 1,
			Web: 2,
		},
		version: "1.85.0",
	}))

	vi.mock("../../../utils/tts", () => ({
		setTtsEnabled: vi.fn(),
		setTtsSpeed: vi.fn(),
	}))

	vi.mock("../../../api", () => ({
		buildApiHandler: vi.fn().mockReturnValue({
			getModel: vi.fn().mockReturnValue({
				id: "claude-3-sonnet",
				info: { supportsComputerUse: false },
			}),
		}),
	}))

	vi.mock("../../prompts/system", () => ({
		SYSTEM_PROMPT: vi.fn().mockImplementation(async () => "mocked system prompt"),
		codeMode: "code",
	}))

	vi.mock("../../../integrations/workspace/WorkspaceTracker", () => {
		return {
			default: vi.fn().mockImplementation(() => ({
				initializeFilePaths: vi.fn(),
				dispose: vi.fn(),
			})),
		}
	})

	vi.mock("../../task/Task", () => ({
		Task: vi
			.fn()
			.mockImplementation(
				(
					_provider,
					_apiConfiguration,
					_customInstructions,
					_diffEnabled,
					_fuzzyMatchThreshold,
					_task,
					taskId,
				) => ({
					api: undefined,
					abortTask: vi.fn(),
					handleWebviewAskResponse: vi.fn(),
					clineMessages: [],
					apiConversationHistory: [],
					overwriteClineMessages: vi.fn(),
					overwriteApiConversationHistory: vi.fn(),
					getTaskNumber: vi.fn().mockReturnValue(0),
					setTaskNumber: vi.fn(),
					setParentTask: vi.fn(),
					setRootTask: vi.fn(),
					taskId: taskId || "test-task-id",
					emit: vi.fn(),
				}),
			),
	}))

	vi.mock("../../../integrations/misc/extract-text", () => ({
		extractTextFromFile: vi.fn().mockImplementation(async (_filePath: string) => {
			const content = "const x = 1;\nconst y = 2;\nconst z = 3;"
			const lines = content.split("\n")
			return lines.map((line, index) => `${index + 1} | ${line}`).join("\n")
		}),
	}))

	vi.mock("../../../api/providers/fetchers/modelCache", () => ({
		getModels: vi.fn().mockResolvedValue({}),
		flushModels: vi.fn(),
	}))

	vi.mock("../../../shared/modes", () => ({
		modes: [
			{
				slug: "code",
				name: "Code Mode",
				roleDefinition: "You are a code assistant",
				groups: ["read", "edit", "browser"],
			},
			{
				slug: "architect",
				name: "Architect Mode",
				roleDefinition: "You are an architect",
				groups: ["read", "edit"],
			},
			{
				slug: "ask",
				name: "Ask Mode",
				roleDefinition: "You are a helpful assistant",
				groups: ["read"],
			},
		],
		getModeBySlug: vi.fn().mockReturnValue({
			slug: "code",
			name: "Code Mode",
			roleDefinition: "You are a code assistant",
			groups: ["read", "edit", "browser"],
		}),
		getGroupName: vi.fn().mockImplementation((group: string) => {
			switch (group) {
				case "read":
					return "Read Tools"
				case "edit":
					return "Edit Tools"
				case "browser":
					return "Browser Tools"
				case "mcp":
					return "MCP Tools"
				default:
					return "General Tools"
			}
		}),
		defaultModeSlug: "code",
	}))

	vi.mock("../diff/strategies/multi-search-replace", () => ({
		MultiSearchReplaceDiffStrategy: vi.fn().mockImplementation(() => ({
			getToolDescription: () => "test",
			getName: () => "test-strategy",
			applyDiff: vi.fn(),
		})),
	}))

	vi.mock("@roo-code/cloud", () => ({
		CloudService: {
			hasInstance: vi.fn().mockReturnValue(true),
			get instance() {
				return {
					isAuthenticated: vi.fn().mockReturnValue(false),
				}
			},
		},
		BridgeOrchestrator: {
			isEnabled: vi.fn().mockReturnValue(false),
		},
		getRooCodeApiUrl: vi.fn().mockReturnValue("https://app.roocode.com"),
	}))
}

// Common test fixtures
export function createMockContext() {
	const globalState: Record<string, string | undefined> = {
		mode: "architect",
		currentApiConfigName: "current-config",
	}

	const secrets: Record<string, string | undefined> = {}

	return {
		extensionPath: "/test/path",
		extensionUri: {} as vscode.Uri,
		globalState: {
			get: vi.fn().mockImplementation((key: string) => globalState[key]),
			update: vi.fn().mockImplementation((key: string, value: string | undefined) => (globalState[key] = value)),
			keys: vi.fn().mockImplementation(() => Object.keys(globalState)),
		},
		workspaceState: {
			get: vi.fn().mockResolvedValue(undefined),
			update: vi.fn().mockResolvedValue(undefined),
			keys: vi.fn().mockReturnValue([]),
		},
		secrets: {
			get: vi.fn().mockImplementation((key: string) => secrets[key]),
			store: vi.fn().mockImplementation((key: string, value: string | undefined) => (secrets[key] = value)),
			delete: vi.fn().mockImplementation((key: string) => delete secrets[key]),
		},
		subscriptions: [],
		extension: {
			packageJSON: { version: "1.0.0" },
		},
		globalStorageUri: {
			fsPath: "/test/storage/path",
		},
	} as unknown as vscode.ExtensionContext
}

export function createMockWebviewView() {
	const mockPostMessage = vi.fn()

	return {
		webview: {
			postMessage: mockPostMessage,
			html: "",
			options: {},
			onDidReceiveMessage: vi.fn(),
			asWebviewUri: vi.fn(),
			cspSource: "vscode-webview://test-csp-source",
		},
		visible: true,
		onDidDispose: vi.fn().mockImplementation((callback) => {
			callback()
			return { dispose: vi.fn() }
		}),
		onDidChangeVisibility: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
	} as unknown as vscode.WebviewView
}

export function createMockOutputChannel() {
	return {
		appendLine: vi.fn(),
		clear: vi.fn(),
		dispose: vi.fn(),
	} as unknown as vscode.OutputChannel
}

export function setupProvider() {
	if (!TelemetryService.hasInstance()) {
		TelemetryService.createInstance([])
	}

	const mockContext = createMockContext()
	const mockOutputChannel = createMockOutputChannel()
	const provider = new ClineProvider(mockContext, mockOutputChannel, "sidebar", new ContextProxy(mockContext))

	// Mock getMcpHub method
	provider.getMcpHub = vi.fn().mockReturnValue({
		listTools: vi.fn().mockResolvedValue([]),
		callTool: vi.fn().mockResolvedValue({ content: [] }),
		listResources: vi.fn().mockResolvedValue([]),
		readResource: vi.fn().mockResolvedValue({ contents: [] }),
		getAllServers: vi.fn().mockReturnValue([]),
	})

	return { provider, mockContext, mockOutputChannel }
}
