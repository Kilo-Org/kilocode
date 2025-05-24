/**
 * Type definitions for MCP tools
 */

/**
 * Response type for MCP tool calls
 */
export type McpToolCallResponse = {
	content: Array<{ type: string; text: string }>
	isError?: boolean
}

/**
 * Context type for environment variables and paths
 */
export type Context = {
	LOCALE_PATHS: {
		core: string
		webview: string
	}
	OPENROUTER_API_KEY: string
	DEFAULT_MODEL: string
}

/**
 * Tool handler interface
 */
export interface ToolHandler {
	name: string
	description: string
	inputSchema: any
	execute(args: any, context: Context): Promise<McpToolCallResponse>
}
