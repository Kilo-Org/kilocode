import { z } from "zod"

/**
 * Organization Allow List for provider validation
 */
export const organizationAllowListSchema = z.object({
	allowAll: z.boolean(),
	providers: z.record(
		z.object({
			allowAll: z.boolean(),
			models: z.array(z.string()).optional(),
		}),
	),
})

/**
 * Extension message schema
 */
export const extensionMessageSchema = z.object({
	type: z.string(),
	action: z.string().optional(),
	text: z.string().optional(),
	state: z.unknown().optional(), // ExtensionState
	images: z.array(z.string()).optional(),
	chatMessages: z.array(z.unknown()).optional(), // ExtensionChatMessage[]
	values: z.record(z.unknown()).optional(),
})

/**
 * CLI-specific ExtensionState schema
 */
export const extensionStateSchema = z.object({
	version: z.string(),
	apiConfiguration: z.unknown(), // ProviderSettings
	currentApiConfigName: z.string().optional(),
	listApiConfigMeta: z.array(z.unknown()).optional(), // ProviderSettingsEntry[]
	chatMessages: z.array(z.unknown()), // ExtensionChatMessage[]
	clineMessages: z.array(z.unknown()).optional(), // Cline Legacy
	currentTaskItem: z.unknown().optional(), // HistoryItem
	currentTaskTodos: z.array(z.unknown()).optional(), // TodoItem[]
	mode: z.string(),
	customModes: z.array(z.unknown()), // ModeConfig[]
	taskHistoryFullLength: z.number(),
	taskHistoryVersion: z.number(),
	mcpServers: z.array(z.unknown()).optional(), // McpServer[]
	telemetrySetting: z.string(),
	renderContext: z.enum(["sidebar", "editor", "cli"]),
	cwd: z.string().optional(),
	organizationAllowList: organizationAllowListSchema.optional(),
	routerModels: z.unknown().optional(), // RouterModels
	appendSystemPrompt: z.string().optional(), // Custom text to append to system prompt (CLI only)
})

// Inferred types
export type OrganizationAllowList = z.infer<typeof organizationAllowListSchema>
export type ExtensionMessage = z.infer<typeof extensionMessageSchema>
export type ExtensionState = z.infer<typeof extensionStateSchema>

// Mode type alias
export type Mode = string
