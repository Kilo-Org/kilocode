/**
 * Settings passed to system prompt generation functions
 */
export interface SystemPromptSettings {
	maxConcurrentFileReads: number
	todoListEnabled: boolean
	toolCallEnabled?: boolean
	useAgentRules: boolean
	newTaskRequireTodos: boolean
}
