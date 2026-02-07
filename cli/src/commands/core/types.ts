/**
 * Command system type definitions
 */

import type { ExtensionMessage, RouterModels, WebviewMessage, ModeConfig } from "../../types/messages.js"
import type { CliMessage } from "../../types/cli.js"
import type { CLIConfig, ProviderConfig } from "../../config/types.js"
import type { ProfileData, BalanceData } from "../../state/atoms/profile.js"
import type { TaskHistoryData, TaskHistoryFilters } from "../../state/atoms/taskHistory.js"
import type { ModelListFilters } from "../../state/atoms/modelList.js"
import type { HistoryItem } from "@roo-code/types"

export interface Command {
	name: string
	aliases: string[]
	description: string
	usage: string
	examples: string[]
	category: "chat" | "settings" | "navigation" | "system"
	handler: CommandHandler
	options?: CommandOption[]
	arguments?: ArgumentDefinition[]
	priority?: number // 1-10 scale, default 5. Higher = appears first in suggestions
}

export interface CommandOption {
	name: string
	alias?: string
	description: string
	required?: boolean
	type: "string" | "number" | "boolean"
	default?: string | number | boolean
}

export interface CommandContext {
	input: string
	args: string[]
	options: Record<string, string | number | boolean>
	config: CLIConfig
	sendMessage: (message: CliMessage) => Promise<void>
	addMessage: (message: CliMessage) => void
	clearMessages: () => void
	replaceMessages: (messages: CliMessage[]) => void
	setMessageCutoffTimestamp: (timestamp: number) => void
	clearTask: () => Promise<void>
	setMode: (mode: string) => void
	setTheme: (theme: string) => Promise<void>
	exit: () => void
	setCommittingParallelMode: (isCommitting: boolean) => void
	isParallelMode: boolean
	// Model-related context
	routerModels: RouterModels | null
	currentProvider: ProviderConfig | null
	kilocodeDefaultModel: string
	updateProviderModel: (modelId: string) => Promise<void>
	refreshRouterModels: () => Promise<void>
	// Provider update function for teams command
	updateProvider: (providerId: string, updates: Partial<ProviderConfig>) => Promise<void>
	// Provider selection function
	selectProvider: (providerId: string) => Promise<void>
	// Profile data context
	profileData: ProfileData | null
	balanceData: BalanceData | null
	profileLoading: boolean
	balanceLoading: boolean
	// Custom modes context
	customModes: ModeConfig[]
	// Task history context
	taskHistoryData: TaskHistoryData | null
	taskHistoryFilters: TaskHistoryFilters
	taskHistoryLoading: boolean
	taskHistoryError: string | null
	fetchTaskHistory: () => Promise<void>
	updateTaskHistoryFilters: (filters: Partial<TaskHistoryFilters>) => Promise<TaskHistoryData>
	changeTaskHistoryPage: (pageIndex: number) => Promise<TaskHistoryData>
	nextTaskHistoryPage: () => Promise<TaskHistoryData>
	previousTaskHistoryPage: () => Promise<TaskHistoryData>
	sendWebviewMessage: (message: WebviewMessage) => Promise<void>
	refreshTerminal: () => Promise<void>
	chatMessages: ExtensionMessage[]
	// Current task context
	currentTask: HistoryItem | null
	// Model list context
	modelListPageIndex: number
	modelListFilters: ModelListFilters
	updateModelListFilters: (filters: Partial<ModelListFilters>) => void
	changeModelListPage: (pageIndex: number) => void
	resetModelListState: () => void
	// Condense context
	condenseAndWait: (taskId: string) => Promise<void>
}

export type CommandHandler = (context: CommandContext) => Promise<void> | void

export interface ParsedCommand {
	command: string
	args: string[]
	options: Record<string, string | number | boolean>
}

// Argument autocompletion types

/**
 * Argument suggestion with metadata
 */
export interface ArgumentSuggestion {
	value: string
	title?: string
	description?: string
	matchScore: number
	highlightedValue: string
	loading?: boolean
	error?: string
}

export interface ArgumentProviderCommandContext {
	config: CLIConfig
	routerModels: RouterModels | null
	currentProvider: ProviderConfig | null
	kilocodeDefaultModel: string
	profileData: ProfileData | null
	profileLoading: boolean
	updateProviderModel: (modelId: string) => Promise<void>
	refreshRouterModels: () => Promise<void>
	taskHistoryData: TaskHistoryData | null
	chatMessages: ExtensionMessage[]
	customModes: ModeConfig[]
}

/**
 * Context provided to argument providers
 */
export interface ArgumentProviderContext {
	// Basic info
	commandName: string
	argumentIndex: number
	argumentName: string

	// Current state
	currentArgs: string[]
	currentOptions: Record<string, string | number | boolean>
	partialInput: string

	// Access to previous arguments by name
	getArgument: (name: string) => string | undefined

	// Access to all parsed values
	parsedValues: {
		args: Record<string, string>
		options: Record<string, string | number | boolean>
	}

	// Metadata about the command
	command: Command

	// CommandContext properties for providers that need them
	commandContext?: ArgumentProviderCommandContext
}

/**
 * Argument provider function (can be async)
 */
export type ArgumentProvider = (
	context: ArgumentProviderContext,
) => Promise<ArgumentSuggestion[]> | ArgumentSuggestion[] | Promise<string[]> | string[]

/**
 * Validation result
 */
export interface ValidationResult {
	valid: boolean
	error?: string
	warning?: string
}

/**
 * Argument dependency
 */
export interface ArgumentDependency {
	argumentName: string
	values?: string[]
	condition?: (value: string, context: ArgumentProviderContext) => boolean
}

/**
 * Conditional provider
 */
export interface ConditionalProvider {
	condition: (context: ArgumentProviderContext) => boolean
	provider: ArgumentProvider
}

/**
 * Cache configuration for providers
 */
export interface ProviderCacheConfig {
	enabled: boolean
	ttl?: number
	keyGenerator?: (context: ArgumentProviderContext) => string
}

/**
 * Argument value with metadata
 */
export interface ArgumentValue {
	value: string
	description?: string
}

/**
 * Argument definition with provider support
 */
export interface ArgumentDefinition {
	name: string
	description: string
	required?: boolean

	// Provider options
	provider?: ArgumentProvider
	values?: ArgumentValue[]
	conditionalProviders?: ConditionalProvider[]
	defaultProvider?: ArgumentProvider

	// Dependencies
	dependsOn?: ArgumentDependency[]

	// Validation
	validate?: (value: string, context: ArgumentProviderContext) => Promise<ValidationResult> | ValidationResult

	// Transform
	transform?: (value: string) => string

	// UI
	placeholder?: string

	// Caching
	cache?: ProviderCacheConfig
}

/**
 * Input state for autocomplete
 */
export interface InputState {
	type: "command" | "argument" | "option" | "none"
	commandName?: string
	command?: Command

	currentArgument?: {
		definition: ArgumentDefinition
		index: number
		partialValue: string
	}

	validation?: {
		valid: boolean
		errors: string[]
		warnings: string[]
	}

	dependencies?: {
		satisfied: boolean
		missing: string[]
	}
}
