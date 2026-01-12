// kilocode_change - new file

/**
 * Slack integration types for Kilo Code
 * Provides TypeScript interfaces for Slack API integration
 */

export interface SlackMessage {
	id: string
	text: string
	channel: string
	timestamp: string
	userId?: string
	botId?: string
}

export interface SlackChannel {
	id: string
	name: string
	isPrivate: boolean
	members?: string[]
}

export interface SlackUser {
	id: string
	name: string
	email?: string
	avatar?: string
}

export interface SlackWorkspace {
	id: string
	name: string
	domain: string
	icon?: string
}

export interface SlackShareRequest {
	content: string
	channelId?: string
	format?: "code-block" | "snippet" | "message"
	includeMetadata?: boolean
}

export interface SlackShareResponse {
	success: boolean
	messageId?: string
	channel?: string
	timestamp?: string
	error?: string
}

export interface SlackIntegrationConfig {
	workspaceId: string
	channelId?: string
	botToken: string
	userToken: string
	isActive: boolean
	lastUsed?: Date
}

export interface SlackErrorResponse {
	error: string
	ok: boolean
	response?: any
}

// Slack API response types
export interface SlackPostMessageResponse {
	ok: boolean
	channel: string
	ts: string
	message: {
		text: string
		bot_id?: string
	}
}

export interface SlackChannelInfo {
	id: string
	name: string
	is_channel: boolean
	is_group: boolean
	is_im: boolean
	created: number
	creator: string
}

export interface SlackAuthResponse {
	ok: boolean
	access_token?: string
	scope?: string
	user?: SlackUser
	team?: SlackWorkspace
}

// Event types for Slack integration
export interface SlackMessageEvent {
	type: "message"
	channel: string
	user: string
	text: string
	ts: string
	thread_ts?: string
}

export interface SlackAppMentionEvent {
	type: "app_mention"
	user: string
	channel: string
	text: string
	ts: string
}

// Configuration types
export interface SlackSettings {
	defaultChannel?: string
	includeCodeBlocks: boolean
	autoFormat: boolean
	maxMessageLength: number
	enableNotifications: boolean
}

// Error types
export class SlackIntegrationError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly originalError?: any,
	) {
		super(message)
		this.name = "SlackIntegrationError"
		this.code = code
		this.originalError = originalError
	}
}

export class SlackApiError extends SlackIntegrationError {
	public readonly response: any

	constructor(message: string, response: any, originalError?: any) {
		super(message, "SLACK_API_ERROR", originalError)
		this.response = response
	}
}

export class SlackAuthError extends SlackIntegrationError {
	constructor(message: string, originalError?: any) {
		super(message, "SLACK_AUTH_ERROR", originalError)
	}
}

// Utility types
export type SlackEventType = SlackMessageEvent | SlackAppMentionEvent

export interface SlackEventWrapper {
	type: string
	team_id: string
	api_app_id: string
	event: SlackEventType
	authed_users?: string[]
	challenge?: string
}
