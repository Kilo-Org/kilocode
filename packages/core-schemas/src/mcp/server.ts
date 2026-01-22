import { z } from "zod"

/**
 * MCP Tool schema
 */
export const mcpToolSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	inputSchema: z.record(z.string(), z.unknown()).optional(),
})

/**
 * MCP Resource schema
 */
export const mcpResourceSchema = z.object({
	uri: z.string(),
	name: z.string(),
	description: z.string().optional(),
	mimeType: z.string().optional(),
})

/**
 * MCP Server status schema
 */
export const mcpServerStatusSchema = z.enum(["connected", "connecting", "disconnected"])

/**
 * MCP Server schema
 */
export const mcpServerSchema = z.object({
	name: z.string(),
	config: z.record(z.string(), z.unknown()),
	status: mcpServerStatusSchema,
	tools: z.array(mcpToolSchema).optional(),
	resources: z.array(mcpResourceSchema).optional(),
	resourceTemplates: z.array(z.unknown()).optional(),
	errorHistory: z.array(z.string()).optional(),
	timeout: z.number().optional(),
	source: z.enum(["global", "project"]).optional(),
})

/**
 * MCP server data for message rendering
 */
export const mcpServerDataSchema = z.object({
	type: z.string().optional(),
	serverName: z.string().optional(),
	toolName: z.string().optional(),
	arguments: z.string().optional(),
	uri: z.string().optional(),
	response: z.string().optional(),
})

// Inferred types
export type McpTool = z.infer<typeof mcpToolSchema>
export type McpResource = z.infer<typeof mcpResourceSchema>
export type McpServerStatus = z.infer<typeof mcpServerStatusSchema>
export type McpServer = z.infer<typeof mcpServerSchema>
export type McpServerData = z.infer<typeof mcpServerDataSchema>
