// ============================================
// SHARED TYPES - Import from @roo-code/types
// ============================================
import type {
	ProviderSettings,
	ProviderSettingsEntry,
	ProviderName,
	HistoryItem,
	ModeConfig,
	TodoItem,
	ClineMessage,
} from "@roo-code/types"

// ============================================
// SHARED TYPES - Import from src/shared
// ============================================
export type {
	WebviewMessage,
	MaybeTypedWebviewMessage,
	UpdateGlobalStateMessage,
	ClineAskResponse,
	TaskHistoryRequestPayload,
} from "@roo/WebviewMessage"

import type { McpServer, McpTool, McpResource } from "@roo/mcp"
export type { McpServer, McpTool, McpResource }

// ============================================
// MODEL TYPES - Import from constants
// ============================================
import type { RouterName, ModelInfo, ModelRecord, RouterModels } from "../constants/providers/models.js"

// ============================================
// RE-EXPORTS for convenience
// ============================================
export type { ProviderSettings, ProviderSettingsEntry, ProviderName, HistoryItem, ModeConfig, TodoItem }

// Alias ClineMessage as ExtensionChatMessage for backward compatibility
export type ExtensionChatMessage = ClineMessage

// Re-export model types
export type { RouterName, ModelInfo, ModelRecord, RouterModels }

// ============================================
// CLI-SPECIFIC TYPES (Keep these)
// ============================================
export interface ExtensionMessage {
	type: string
	action?: string
	text?: string
	state?: ExtensionState
	images?: string[]
	chatMessages?: ExtensionChatMessage[]
	values?: Record<string, unknown>
	[key: string]: unknown
}

// Organization Allow List for provider validation
export interface OrganizationAllowList {
	allowAll: boolean
	providers: Record<
		string,
		{
			allowAll: boolean
			models?: string[]
		}
	>
}

// CLI-specific ExtensionState
export interface ExtensionState {
	version: string
	apiConfiguration: ProviderSettings
	currentApiConfigName?: string
	listApiConfigMeta?: ProviderSettingsEntry[]
	chatMessages: ExtensionChatMessage[]
	clineMessages?: ExtensionChatMessage[] // Cline Legacy
	currentTaskItem?: HistoryItem
	currentTaskTodos?: TodoItem[]
	mode: string
	customModes: ModeConfig[]
	taskHistoryFullLength: number
	taskHistoryVersion: number
	mcpServers?: McpServer[]
	telemetrySetting: string
	renderContext: "sidebar" | "editor" | "cli"
	cwd?: string
	organizationAllowList?: OrganizationAllowList
	routerModels?: RouterModels
	appendSystemPrompt?: string // Custom text to append to system prompt (CLI only)
	[key: string]: unknown
}

export type Mode = string
