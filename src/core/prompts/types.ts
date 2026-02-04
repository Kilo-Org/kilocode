/**
 * Settings passed to system prompt generation functions
 */
export interface SystemPromptSettings {
	todoListEnabled: boolean
	browserToolEnabled?: boolean
	useAgentRules: boolean
	/** When true, recursively discover and load .roo/rules from subdirectories */
	enableSubfolderRules?: boolean
	newTaskRequireTodos: boolean
	/** When true, model should hide vendor/company identity in responses */
	isStealthModel?: boolean
}
