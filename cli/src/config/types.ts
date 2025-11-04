import type { ProviderName } from "../types/messages.js"
import type { ThemeId, Theme } from "../types/theme.js"

/**
 * Auto approval configuration for read operations
 */
export interface AutoApprovalReadConfig {
	enabled?: boolean
	outside?: boolean
}

/**
 * Auto approval configuration for write operations
 */
export interface AutoApprovalWriteConfig {
	enabled?: boolean
	outside?: boolean
	protected?: boolean
}

/**
 * Auto approval configuration for browser operations
 */
export interface AutoApprovalBrowserConfig {
	enabled?: boolean
}

/**
 * Auto approval configuration for retry operations
 */
export interface AutoApprovalRetryConfig {
	enabled?: boolean
	delay?: number
}

/**
 * Auto approval configuration for MCP operations
 */
export interface AutoApprovalMcpConfig {
	enabled?: boolean
}

/**
 * Auto approval configuration for mode switching
 */
export interface AutoApprovalModeConfig {
	enabled?: boolean
}

/**
 * Auto approval configuration for subtasks
 */
export interface AutoApprovalSubtasksConfig {
	enabled?: boolean
}

/**
 * Auto approval configuration for command execution
 */
export interface AutoApprovalExecuteConfig {
	enabled?: boolean
	allowed?: string[]
	denied?: string[]
}

/**
 * Auto approval configuration for followup questions
 */
export interface AutoApprovalQuestionConfig {
	enabled?: boolean
	timeout?: number
}

/**
 * Auto approval configuration for todo list updates
 */
export interface AutoApprovalTodoConfig {
	enabled?: boolean
}

/**
 * Complete auto approval configuration
 */
export interface AutoApprovalConfig {
	enabled?: boolean
	read?: AutoApprovalReadConfig
	write?: AutoApprovalWriteConfig
	browser?: AutoApprovalBrowserConfig
	retry?: AutoApprovalRetryConfig
	mcp?: AutoApprovalMcpConfig
	mode?: AutoApprovalModeConfig
	subtasks?: AutoApprovalSubtasksConfig
	execute?: AutoApprovalExecuteConfig
	question?: AutoApprovalQuestionConfig
	todo?: AutoApprovalTodoConfig
}

export interface CLIConfig {
	version: "1.0.0"
	mode: string
	telemetry: boolean
	provider: string
	providers: ProviderConfig[]
	autoApproval?: AutoApprovalConfig
	theme?: ThemeId
	customThemes?: Record<string, Theme>
}

export interface ProviderConfig {
	id: string
	provider: ProviderName
	// Provider-specific fields
	[key: string]: any
}

// Type guards
export function isValidConfig(config: unknown): config is CLIConfig {
	return (
		typeof config === "object" &&
		config !== null &&
		"version" in config &&
		"provider" in config &&
		"providers" in config
	)
}

export function isProviderConfig(provider: unknown): provider is ProviderConfig {
	return typeof provider === "object" && provider !== null && "id" in provider && "provider" in provider
}
