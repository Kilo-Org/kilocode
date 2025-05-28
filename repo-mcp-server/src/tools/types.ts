export type McpToolCallResponse = {
	content: Array<{ type: string; text: string }>
	isError?: boolean
}

export type Context = {
	LOCALE_PATHS: {
		core: string
		webview: string
	}
	OPENROUTER_API_KEY: string
	DEFAULT_MODEL: string
}

export interface ToolHandler {
	name: string
	description: string
	inputSchema: any
	execute(args: any, context: Context): Promise<McpToolCallResponse>
}
