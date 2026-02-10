import { z } from "zod"

/**
 * McpServerUse
 */

export interface McpServerUse {
	type: string
	serverName: string
	toolName?: string
	uri?: string
}

/**
 * McpExecutionStatus
 */

export const mcpExecutionStatusSchema = z.discriminatedUnion("status", [
	z.object({
		executionId: z.string(),
		status: z.literal("started"),
		serverName: z.string(),
		toolName: z.string(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("output"),
		response: z.string(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("completed"),
		response: z.string().optional(),
	}),
	z.object({
		executionId: z.string(),
		status: z.literal("error"),
		error: z.string().optional(),
	}),
])

export type McpExecutionStatus = z.infer<typeof mcpExecutionStatusSchema>

/**
 * McpServer
 */

// kilocode_change start: Add authStatus to McpServer type
/**
 * OAuth authentication status for MCP servers
 */
export type McpAuthStatus = {
	/** Whether the server uses OAuth authentication */
	method: "oauth" | "static" | "none"
	/** Current authentication status */
	status: "authenticated" | "expired" | "required" | "none"
	/** Token expiry timestamp (Unix milliseconds) */
	expiresAt?: number
	/** OAuth scopes granted */
	scopes?: string[]
	/** Debug information for OAuth tokens */
	debug?: McpAuthDebugInfo
}

/**
 * Debug information about OAuth token state
 */
export type McpAuthDebugInfo = {
	/** When the token was originally issued (Unix milliseconds) */
	issuedAt?: number
	/** Whether the server supports refresh tokens */
	hasRefreshToken?: boolean
	/** When the last token refresh occurred (Unix milliseconds) */
	lastRefreshAt?: number
	/** When the next token refresh is expected (Unix milliseconds) */
	nextRefreshAt?: number
	/** The token endpoint URL used for refresh */
	tokenEndpoint?: string
	/** The client ID used for authentication */
	clientId?: string
	/** Whether all required metadata for token refresh is available */
	canRefresh?: boolean
}
// kilocode_change end

export type McpServer = {
	name: string
	config: string
	status: "connected" | "connecting" | "disconnected"
	error?: string
	errorHistory?: McpErrorEntry[]
	tools?: McpTool[]
	resources?: McpResource[]
	resourceTemplates?: McpResourceTemplate[]
	disabled?: boolean
	timeout?: number
	source?: "global" | "project"
	projectPath?: string
	instructions?: string
	authStatus?: McpAuthStatus // kilocode_change: OAuth authentication status
}

export type McpTool = {
	name: string
	description?: string
	inputSchema?: object
	alwaysAllow?: boolean
	enabledForPrompt?: boolean
}

export type McpResource = {
	uri: string
	name: string
	mimeType?: string
	description?: string
}

export type McpResourceTemplate = {
	uriTemplate: string
	name: string
	description?: string
	mimeType?: string
}

export type McpResourceResponse = {
	_meta?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
	contents: Array<{
		uri: string
		mimeType?: string
		text?: string
		blob?: string
	}>
}

export type McpToolCallResponse = {
	_meta?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
	content: Array<
		| {
				type: "text"
				text: string
				_meta?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
		  }
		| {
				type: "image"
				data: string
				mimeType: string
				_meta?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
		  }
		| {
				type: "audio"
				data: string
				mimeType: string
				_meta?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
		  }
		| {
				type: "resource"
				resource: {
					uri: string
					mimeType?: string
					text?: string
					blob?: string
					_meta?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
				}
				_meta?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
		  }
		// kilocode_change start
		| {
				type: "resource_link"
				uri: string
				name?: string
				description?: string
				mimeType?: string
				_meta?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
		  }
		// kilocode_change end
	>
	structuredContent?: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
	isError?: boolean
}

export type McpErrorEntry = {
	message: string
	timestamp: number
	level: "error" | "warn" | "info"
}
