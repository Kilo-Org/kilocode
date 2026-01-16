import { z } from "zod"

/**
 * Auto approval configuration for read operations
 */
export const autoApprovalReadSchema = z.object({
	enabled: z.boolean().optional(),
	outside: z.boolean().optional(),
})

/**
 * Auto approval configuration for write operations
 */
export const autoApprovalWriteSchema = z.object({
	enabled: z.boolean().optional(),
	outside: z.boolean().optional(),
	protected: z.boolean().optional(),
})

/**
 * Auto approval configuration for browser operations
 */
export const autoApprovalBrowserSchema = z.object({
	enabled: z.boolean().optional(),
})

/**
 * Auto approval configuration for retry operations
 */
export const autoApprovalRetrySchema = z.object({
	enabled: z.boolean().optional(),
	delay: z.number().optional(),
})

/**
 * Auto approval configuration for MCP operations
 */
export const autoApprovalMcpSchema = z.object({
	enabled: z.boolean().optional(),
})

/**
 * Auto approval configuration for mode switching
 */
export const autoApprovalModeSchema = z.object({
	enabled: z.boolean().optional(),
})

/**
 * Auto approval configuration for subtasks
 */
export const autoApprovalSubtasksSchema = z.object({
	enabled: z.boolean().optional(),
})

/**
 * Auto approval configuration for command execution
 */
export const autoApprovalExecuteSchema = z.object({
	enabled: z.boolean().optional(),
	allowed: z.array(z.string()).optional(),
	denied: z.array(z.string()).optional(),
})

/**
 * Auto approval configuration for followup questions
 */
export const autoApprovalQuestionSchema = z.object({
	enabled: z.boolean().optional(),
	timeout: z.number().optional(),
})

/**
 * Auto approval configuration for todo list updates
 */
export const autoApprovalTodoSchema = z.object({
	enabled: z.boolean().optional(),
})

/**
 * Complete auto approval configuration
 */
export const autoApprovalConfigSchema = z.object({
	enabled: z.boolean().optional(),
	read: autoApprovalReadSchema.optional(),
	write: autoApprovalWriteSchema.optional(),
	browser: autoApprovalBrowserSchema.optional(),
	retry: autoApprovalRetrySchema.optional(),
	mcp: autoApprovalMcpSchema.optional(),
	mode: autoApprovalModeSchema.optional(),
	subtasks: autoApprovalSubtasksSchema.optional(),
	execute: autoApprovalExecuteSchema.optional(),
	question: autoApprovalQuestionSchema.optional(),
	todo: autoApprovalTodoSchema.optional(),
})

// Inferred types
export type AutoApprovalReadConfig = z.infer<typeof autoApprovalReadSchema>
export type AutoApprovalWriteConfig = z.infer<typeof autoApprovalWriteSchema>
export type AutoApprovalBrowserConfig = z.infer<typeof autoApprovalBrowserSchema>
export type AutoApprovalRetryConfig = z.infer<typeof autoApprovalRetrySchema>
export type AutoApprovalMcpConfig = z.infer<typeof autoApprovalMcpSchema>
export type AutoApprovalModeConfig = z.infer<typeof autoApprovalModeSchema>
export type AutoApprovalSubtasksConfig = z.infer<typeof autoApprovalSubtasksSchema>
export type AutoApprovalExecuteConfig = z.infer<typeof autoApprovalExecuteSchema>
export type AutoApprovalQuestionConfig = z.infer<typeof autoApprovalQuestionSchema>
export type AutoApprovalTodoConfig = z.infer<typeof autoApprovalTodoSchema>
export type AutoApprovalConfig = z.infer<typeof autoApprovalConfigSchema>
