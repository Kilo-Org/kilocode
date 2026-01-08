import { z } from "zod"

/**
 * Schema for MCP parameter definitions
 */
export const mcpParameterSchema = z.object({
	name: z.string().min(1),
	key: z.string().min(1),
	placeholder: z.string().optional(),
	optional: z.boolean().optional().default(false),
})

export type McpParameter = z.infer<typeof mcpParameterSchema>

/**
 * Schema for MCP installation method with name
 */
export const mcpInstallationMethodSchema = z.object({
	name: z.string().min(1),
	content: z.string().min(1),
	parameters: z.array(mcpParameterSchema).optional(),
	prerequisites: z.array(z.string()).optional(),
})

export type McpInstallationMethod = z.infer<typeof mcpInstallationMethodSchema>

/**
 * Component type validation
 */
export const marketplaceItemTypeSchema = z.enum(["mode", "mcp", "skill"] as const)

export type MarketplaceItemType = z.infer<typeof marketplaceItemTypeSchema>

/**
 * Base schema for common marketplace item fields
 */
const baseMarketplaceItemSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1, "Name is required"),
	description: z.string(),
	author: z.string().optional(),
	authorUrl: z.string().url("Author URL must be a valid URL").optional(),
	tags: z.array(z.string()).optional(),
	prerequisites: z.array(z.string()).optional(),
})

/**
 * Type-specific schemas for YAML parsing (without type field, added programmatically)
 */
export const modeMarketplaceItemSchema = baseMarketplaceItemSchema.extend({
	content: z.string().min(1), // YAML content for modes
})

export type ModeMarketplaceItem = z.infer<typeof modeMarketplaceItemSchema>

export const mcpMarketplaceItemSchema = baseMarketplaceItemSchema.extend({
	url: z.string().url(), // Required url field
	content: z.union([z.string().min(1), z.array(mcpInstallationMethodSchema)]), // Single config or array of methods
	parameters: z.array(mcpParameterSchema).optional(),
})

export type McpMarketplaceItem = z.infer<typeof mcpMarketplaceItemSchema>

export const skillMarketplaceItemSchema = baseMarketplaceItemSchema.extend({
	repository: z
		.object({
			fullName: z.string(),
			stars: z.number(),
			forks: z.number(),
			url: z.string().url(),
			pushedAt: z.string(),
		})
		.optional(),
	category: z.string().optional(),
	hasInstallCommand: z.boolean().optional(),
	skillFile: z.string().optional(),
	marketplaceJson: z
		.object({
			name: z.string(),
			version: z.string().optional(),
			installCommand: z.string().optional(),
			description: z.string().optional(),
		})
		.optional(),
	content: z.string().optional(), // Optional content for skill (SKILL.md content)
})

export type SkillMarketplaceItem = z.infer<typeof skillMarketplaceItemSchema>

/**
 * Unified marketplace item schema using discriminated union
 */
export const marketplaceItemSchema = z.discriminatedUnion("type", [
	// Mode marketplace item
	modeMarketplaceItemSchema.extend({
		type: z.literal("mode"),
	}),
	// MCP marketplace item
	mcpMarketplaceItemSchema.extend({
		type: z.literal("mcp"),
	}),
	// Skill marketplace item
	skillMarketplaceItemSchema.extend({
		type: z.literal("skill"),
	}),
])

export type MarketplaceItem = z.infer<typeof marketplaceItemSchema>

/**
 * Installation options for marketplace items
 */
export const installMarketplaceItemOptionsSchema = z.object({
	target: z.enum(["global", "project"]).optional().default("project"),
	parameters: z.record(z.string(), z.any()).optional(),
})

export type InstallMarketplaceItemOptions = z.infer<typeof installMarketplaceItemOptionsSchema>
