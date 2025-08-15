import { z } from "zod"

/**
 * Auto-approval configuration schema
 * Contains all settings related to automatic approval of operations
 */
export const autoApprovalConfigSchema = z.object({
	autoApprovalEnabled: z.boolean().optional(),
	alwaysAllowReadOnly: z.boolean().optional(),
	alwaysAllowReadOnlyOutsideWorkspace: z.boolean().optional(),
	alwaysAllowWrite: z.boolean().optional(),
	alwaysAllowWriteOutsideWorkspace: z.boolean().optional(),
	alwaysAllowWriteProtected: z.boolean().optional(),
	writeDelayMs: z.number().min(0).optional(),
	alwaysAllowBrowser: z.boolean().optional(),
	alwaysApproveResubmit: z.boolean().optional(),
	requestDelaySeconds: z.number().optional(),
	alwaysAllowMcp: z.boolean().optional(),
	alwaysAllowModeSwitch: z.boolean().optional(),
	alwaysAllowSubtasks: z.boolean().optional(),
	alwaysAllowExecute: z.boolean().optional(),
	alwaysAllowFollowupQuestions: z.boolean().optional(),
	followupAutoApproveTimeoutMs: z.number().optional(),
	alwaysAllowUpdateTodoList: z.boolean().optional(),
	alwaysAllowEditMarkdownOnly: z.boolean().optional(),
	allowedCommands: z.array(z.string()).optional(),
	deniedCommands: z.array(z.string()).optional(),
	commandExecutionTimeout: z.number().optional(),
	commandTimeoutAllowlist: z.array(z.string()).optional(),
	preventCompletionWithOpenTodos: z.boolean().optional(),
	allowedMaxRequests: z.number().nullish(),
	allowedMaxCost: z.number().nullish(),
	showAutoApproveMenu: z.boolean().optional(),
})

export type AutoApprovalConfig = z.infer<typeof autoApprovalConfigSchema>

/**
 * Default auto-approval configuration
 */
export const DEFAULT_AUTO_APPROVAL_CONFIG: AutoApprovalConfig = {
	autoApprovalEnabled: false,
	alwaysAllowReadOnly: false,
	alwaysAllowReadOnlyOutsideWorkspace: false,
	alwaysAllowWrite: false,
	alwaysAllowWriteOutsideWorkspace: false,
	alwaysAllowWriteProtected: false,
	writeDelayMs: 1000,
	alwaysAllowBrowser: false,
	alwaysApproveResubmit: false,
	requestDelaySeconds: 0,
	alwaysAllowMcp: false,
	alwaysAllowModeSwitch: false,
	alwaysAllowSubtasks: false,
	alwaysAllowExecute: false,
	alwaysAllowFollowupQuestions: false,
	followupAutoApproveTimeoutMs: 60000,
	alwaysAllowUpdateTodoList: false,
	alwaysAllowEditMarkdownOnly: false,
	allowedCommands: [],
	deniedCommands: [],
	commandExecutionTimeout: 30,
	commandTimeoutAllowlist: [],
	preventCompletionWithOpenTodos: false,
	allowedMaxRequests: null,
	allowedMaxCost: null,
	showAutoApproveMenu: false,
}

/**
 * Auto-approval configuration keys that can be set via setCachedStateField
 */
export const AUTO_APPROVAL_CONFIG_KEYS = [
	"autoApprovalEnabled",
	"alwaysAllowReadOnly",
	"alwaysAllowReadOnlyOutsideWorkspace",
	"alwaysAllowWrite",
	"alwaysAllowWriteOutsideWorkspace",
	"alwaysAllowWriteProtected",
	"writeDelayMs",
	"alwaysAllowBrowser",
	"alwaysApproveResubmit",
	"requestDelaySeconds",
	"alwaysAllowMcp",
	"alwaysAllowModeSwitch",
	"alwaysAllowSubtasks",
	"alwaysAllowExecute",
	"alwaysAllowFollowupQuestions",
	"followupAutoApproveTimeoutMs",
	"alwaysAllowUpdateTodoList",
	"alwaysAllowEditMarkdownOnly",
	"allowedCommands",
	"deniedCommands",
	"commandExecutionTimeout",
	"commandTimeoutAllowlist",
	"preventCompletionWithOpenTodos",
	"allowedMaxRequests",
	"allowedMaxCost",
	"showAutoApproveMenu",
] as const

export type AutoApprovalConfigKey = (typeof AUTO_APPROVAL_CONFIG_KEYS)[number]

/**
 * Check if a key is an auto-approval configuration key
 */
export function isAutoApprovalConfigKey(key: string): key is AutoApprovalConfigKey {
	return AUTO_APPROVAL_CONFIG_KEYS.includes(key as AutoApprovalConfigKey)
}
