import { ToolProtocol } from "@roo-code/types"

/**
 * Settings passed to system prompt generation functions
 */
export interface SystemPromptSettings {
	maxConcurrentFileReads: number
	todoListEnabled: boolean
	browserToolEnabled?: boolean
	useAgentRules: boolean
	newTaskRequireTodos: boolean
	toolProtocol?: ToolProtocol
}
