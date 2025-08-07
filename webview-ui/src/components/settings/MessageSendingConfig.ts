// Message sending configuration types
export interface MessageSendingConfig {
	// Smart template options
	useSmartTemplate: boolean
	selectedTemplate: string
	customTemplate: string
	showTokenSavings: boolean

	// Content inclusion options
	includeSystemPrompt: boolean
	includeConversationHistory: boolean
	includeFileContext: boolean
	includeCodeContext: boolean

	// History management
	maxHistoryMessages: number
	enableHistoryCompression: boolean
	compressionRatio: number

	// Performance optimization
	enableContextCaching: boolean
	enableImageOptimization: boolean
	enableTokenOptimization: boolean
	maxTokensPerRequest: number

	// Real-time features
	enableRealTimePreview: boolean
	showEstimatedCost: boolean
}
