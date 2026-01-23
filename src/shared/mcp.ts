export type McpErrorEntry = {
	message: string
	timestamp: number
	level: "error" | "warn" | "info"
}

// kilocode_change start - MCP OAuth Authorization
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
	// kilocode_change start - MCP OAuth Authorization
	/** OAuth authentication status for HTTP-based transports */
	authStatus?: McpAuthStatus
	// kilocode_change end
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
	_meta?: Record<string, any>
	contents: Array<{
		uri: string
		mimeType?: string
		text?: string
		blob?: string
	}>
}

export type McpToolCallResponse = {
	_meta?: Record<string, any>
	content: Array<
		| {
				type: "text"
				text: string
				_meta?: Record<string, any> // kilocode_change
		  }
		| {
				type: "image"
				data: string
				mimeType: string
				_meta?: Record<string, any> // kilocode_change
		  }
		| {
				type: "audio"
				data: string
				mimeType: string
				_meta?: Record<string, any> // kilocode_change
		  }
		| {
				type: "resource"
				resource: {
					uri: string
					mimeType?: string
					text?: string
					blob?: string
					_meta?: Record<string, any> // kilocode_change
				}
				_meta?: Record<string, any> // kilocode_change
		  }
		// kilocode_change start
		| {
				type: "resource_link"
				uri: string
				name?: string
				description?: string
				mimeType?: string
				_meta?: Record<string, any>
		  }
		// kilocode_change end
	>
	structuredContent?: Record<string, any> // kilocode_change
	isError?: boolean
}
