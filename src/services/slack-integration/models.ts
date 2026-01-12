// kilocode_change - Slack Integration Models

export interface SlackIntegration {
	id: string
	userId: string
	workspaceId: string
	channelId?: string
	botToken: string
	userToken: string
	isActive: boolean
	createdAt: Date
	lastUsed?: Date
	metadata?: Record<string, any>
}

export interface SharedMessage {
	id: string
	integrationId: string
	messageId?: string
	content: string
	channelId: string
	timestamp: Date
	response?: SlackResponse
	metadata?: Record<string, any>
}

export interface SlackResponse {
	ok: boolean
	ts?: string
	channel?: string
	error?: string
}

export interface SlackIntegrationConfig {
	botToken: string
	userToken: string
	defaultChannel?: string
}

export interface ShareMessageRequest {
	integrationId: string
	content: string
	channelId: string
	messageType?: "text" | "code" | "formatted"
	metadata?: Record<string, any>
}

export interface ShareMessageResponse {
	success: boolean
	messageId?: string
	timestamp?: string
	error?: string
}

// Chat message interface (from chat service)
export interface ChatMessage {
	id: string
	role: "user" | "assistant"
	content: string
	citations?: Citation[]
	timestamp: Date
	metadata?: Record<string, any>
}

// Citation interface (from citation service)
export interface Citation {
	id: string
	messageId: string
	sourceType: "file" | "documentation" | "url"
	sourcePath: string
	startLine?: number
	endLine?: number
	snippet: string
	confidence: number
	metadata?: Record<string, any>
}
