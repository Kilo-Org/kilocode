/**
 * Types for the agent runtime.
 * Re-exports from @roo-code/types and @kilocode/core-schemas plus runtime-specific types.
 */

// Re-export from @roo-code/types
export type {
	ProviderSettings,
	ProviderSettingsEntry,
	ProviderName,
	HistoryItem,
	ModeConfig,
	TodoItem,
	ClineMessage,
	ModelInfo,
} from "@roo-code/types"

// Re-export from @kilocode/core-schemas
export {
	type OrganizationAllowList,
	type Mode,
	extensionMessageSchema,
	extensionStateSchema,
} from "@kilocode/core-schemas"

// Identity information for VSCode environment
export interface IdentityInfo {
	machineId: string
	sessionId: string
	cliUserId?: string
}

// MCP types (inline since they come from src/shared which isn't a package)
export interface McpErrorEntry {
	message: string
	timestamp: number
	level: "error" | "warn" | "info"
}

export interface McpServer {
	name: string
	config: string
	status: "connected" | "connecting" | "disconnected"
	error?: string
	errorHistory?: McpErrorEntry[]
	tools?: McpTool[]
	resources?: McpResource[]
	resourceTemplates?: McpResourceTemplate[]
	disabled?: boolean
	timeout?: number
	source?: "global" | "project"
	projectPath?: string
	instructions?: string
}

export interface McpTool {
	name: string
	description?: string
	inputSchema?: object
	alwaysAllow?: boolean
	enabledForPrompt?: boolean
}

export interface McpResource {
	uri: string
	name: string
	mimeType?: string
	description?: string
}

export interface McpResourceTemplate {
	uriTemplate: string
	name: string
	description?: string
	mimeType?: string
}

// Router models types
export interface RouterName {
	id: string
	name: string
}

export interface ModelRecord {
	[modelId: string]: import("@roo-code/types").ModelInfo
}

export interface RouterModels {
	[routerName: string]: ModelRecord
}

/**
 * Messages sent from the extension to the webview/CLI
 */
export interface ExtensionMessage {
	type: string
	action?: string
	text?: string
	state?: ExtensionState
	images?: string[]
	chatMessages?: import("@roo-code/types").ClineMessage[]
	values?: Record<string, unknown>
	routerModels?: RouterModels
	completionRequestId?: string
	completionText?: string
	completionError?: string
	success?: boolean
	[key: string]: unknown
}

/**
 * Messages sent from the webview/CLI to the extension
 */
export interface WebviewMessage {
	type: string
	text?: string
	action?: string
	askResponse?: string
	images?: string[]
	bool?: boolean
	apiConfiguration?: import("@roo-code/types").ProviderSettings
	context?: string
	messageTs?: number
	completionRequestId?: string
	[key: string]: unknown
}

/**
 * Extension state - the main state object
 */
export interface ExtensionState {
	version: string
	apiConfiguration: import("@roo-code/types").ProviderSettings
	currentApiConfigName?: string
	listApiConfigMeta?: import("@roo-code/types").ProviderSettingsEntry[]
	chatMessages: import("@roo-code/types").ClineMessage[]
	clineMessages?: import("@roo-code/types").ClineMessage[] // Legacy name
	currentTaskItem?: import("@roo-code/types").HistoryItem
	currentTaskTodos?: import("@roo-code/types").TodoItem[]
	mode: string
	customModes: import("@roo-code/types").ModeConfig[]
	taskHistoryFullLength: number
	taskHistoryVersion: number
	mcpServers?: McpServer[]
	telemetrySetting: string
	renderContext: "sidebar" | "editor" | "cli"
	cwd?: string
	organizationAllowList?: import("@kilocode/core-schemas").OrganizationAllowList
	routerModels?: RouterModels
	appendSystemPrompt?: string
	experiments?: Record<string, boolean>
	// Auto-approval settings
	autoApprovalEnabled?: boolean
	alwaysAllowReadOnly?: boolean
	alwaysAllowReadOnlyOutsideWorkspace?: boolean
	alwaysAllowWrite?: boolean
	alwaysAllowWriteOutsideWorkspace?: boolean
	alwaysAllowWriteProtected?: boolean
	alwaysAllowBrowser?: boolean
	alwaysApproveResubmit?: boolean
	requestDelaySeconds?: number
	alwaysAllowMcp?: boolean
	alwaysAllowModeSwitch?: boolean
	alwaysAllowSubtasks?: boolean
	alwaysAllowExecute?: boolean
	allowedCommands?: string[]
	deniedCommands?: string[]
	alwaysAllowFollowupQuestions?: boolean
	followupAutoApproveTimeoutMs?: number
	alwaysAllowUpdateTodoList?: boolean
	maxConcurrentFileReads?: number
	[key: string]: unknown
}
