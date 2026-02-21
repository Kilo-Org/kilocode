export type McpServer = {
	name: string
	config: string
	status: "connected" | "connecting" | "disconnected"
	error?: string
	tools?: McpTool[]
	resources?: McpResource[]
	resourceTemplates?: McpResourceTemplate[]
	disabled?: boolean
	timeout?: number
	source?: "global" | "project"
	projectPath?: string
}

export type McpTool = {
	name: string
	description?: string
	inputSchema?: object
	alwaysAllow?: boolean
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
				annotations?: McpContentAnnotations
				_meta?: Record<string, unknown>
		  }
		| {
				type: "image"
				data: string
				mimeType: string
				annotations?: McpContentAnnotations
				_meta?: Record<string, unknown>
		  }
		| {
				type: "audio"
				data: string
				mimeType: string
				annotations?: McpContentAnnotations
				_meta?: Record<string, unknown>
		  }
		| {
				type: "resource_link"
				uri: string
				name?: string
				description?: string
				mimeType?: string
				annotations?: McpContentAnnotations
				_meta?: Record<string, unknown>
		  }
		| {
				type: "resource"
				resource: {
					uri: string
					mimeType?: string
					text?: string
					blob?: string
				}
				annotations?: McpContentAnnotations
				_meta?: Record<string, unknown>
		  }
	>
	structuredContent?: Record<string, unknown>
	isError?: boolean
}

export type McpContentAnnotations = {
	audience?: ("user" | "assistant")[]
	priority?: number
	lastModified?: string
}
