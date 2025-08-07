import { z } from "zod"

/**
 * Message sending configuration schema
 */
export const messageSendingConfigSchema = z.object({
	// Smart template options
	useSmartTemplate: z.boolean().optional(),
	selectedTemplate: z.string().optional(),
	customTemplate: z.string().optional(),
	showTokenSavings: z.boolean().optional(),

	// Content inclusion options
	includeSystemPrompt: z.boolean().optional(),
	includeConversationHistory: z.boolean().optional(),
	includeFileContext: z.boolean().optional(),
	includeCodeContext: z.boolean().optional(),

	// History management
	maxHistoryMessages: z.number().optional(),
	enableHistoryCompression: z.boolean().optional(),
	compressionRatio: z.number().optional(),

	// Performance optimization
	enableContextCaching: z.boolean().optional(),
	enableImageOptimization: z.boolean().optional(),
	enableTokenOptimization: z.boolean().optional(),
	maxTokensPerRequest: z.number().optional(),

	// Real-time features
	enableRealTimePreview: z.boolean().optional(),
	showEstimatedCost: z.boolean().optional(),
})

export type MessageSendingConfig = z.infer<typeof messageSendingConfigSchema>
