// kilocode_change - new file

/**
 * Slack integration service types for team collaboration
 * Provides TypeScript interfaces for Slack API integration and message sharing
 */

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
	metadata?: SlackIntegrationMetadata
}

export interface SharedMessage {
	id: string
	integrationId: string
	messageId?: string
	content: string
	channelId: string
	timestamp: Date
	response?: SlackResponse
	metadata?: SharedMessageMetadata
}

export interface SlackResponse {
	success: boolean
	messageId?: string
	channel?: string
	timestamp?: string
	error?: string
}

// Metadata interfaces
export interface SlackIntegrationMetadata {
	workspaceName?: string
	teamSize?: number
	defaultChannel?: string
	messageCount?: number
	lastError?: string
	setupDate?: Date
}

export interface SharedMessageMetadata {
	format?: "code-block" | "snippet" | "message"
	language?: string
	lineCount?: number
	characterCount?: number
	includesCitations?: boolean
	shareMethod?: "manual" | "auto"
}

// Request/Response types
export interface SlackShareRequest {
	content: string
	channelId?: string
	format?: "code-block" | "snippet" | "message"
	includeMetadata?: boolean
	messageId?: string
}

export interface SlackAuthRequest {
	code: string
	redirectUri?: string
	state?: string
}

export interface SlackConfigureRequest {
	workspaceId: string
	botToken: string
	userToken: string
	defaultChannel?: string
	isActive?: boolean
}

export interface SlackChannelListResponse {
	channels: SlackChannel[]
	success: boolean
	error?: string
}

export interface SlackChannel {
	id: string
	name: string
	isPrivate: boolean
	members?: string[]
	topic?: string
	purpose?: string
}

// Formatting types
export interface CodeFormatter {
	language: string
	format: "code-block" | "inline" | "diff"
	includeLineNumbers: boolean
	theme?: "light" | "dark" | "auto"
	maxLength?: number
}

export interface MessageFormatter {
	template: string
	includeTimestamp?: boolean
	includeUser?: boolean
	includeChannel?: boolean
	maxMessageLength?: number
	customEmojis?: Record<string, string>
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
	}
}

export class SlackApiError extends SlackIntegrationError {
	constructor(
		message: string,
		public readonly response: any,
		public override readonly originalError?: any,
	) {
		super(message, "SLACK_API_ERROR", originalError)
	}
}

export class SlackAuthError extends SlackIntegrationError {
	constructor(
		message: string,
		public override readonly originalError?: any,
	) {
		super(message, "SLACK_AUTH_ERROR", originalError)
	}
}

// Utility types
export type MessageFormat = "code-block" | "snippet" | "message"
export type SlackIntegrationStatus = "active" | "inactive" | "error" | "pending"

// Configuration types
export interface SlackSettings {
	defaultChannel?: string
	includeCodeBlocks: boolean
	autoFormat: boolean
	maxMessageLength: number
	enableNotifications: boolean
	shareOnCommand?: boolean
}

// Event types
export interface SlackIntegrationEvent {
	type: "integration_configured" | "message_shared" | "auth_completed" | "error_occurred" | "disconnected"
	integrationId?: string
	channelId?: string
	timestamp: Date
	data?: any
}
