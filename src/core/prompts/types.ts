import { ToolProtocol } from "@roo-code/types"

/**
 * Settings passed to system prompt generation functions
 */
export interface SystemPromptSettings {
	maxConcurrentFileReads: number
	todoListEnabled: boolean
	browserToolEnabled?: boolean
	useAgentRules: boolean
	/** When true, recursively discover and load .roo/rules from subdirectories */
	enableSubfolderRules?: boolean
	newTaskRequireTodos: boolean
	toolProtocol?: ToolProtocol
	/** When true, model should hide vendor/company identity in responses */
	isStealthModel?: boolean
}
