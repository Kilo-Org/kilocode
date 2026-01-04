// kilocode_change - new file
/**
 * Integration types for external context connectors
 * Supports GitHub Issues, Jira, and Slack integrations
 */

export type IntegrationType = "github" | "jira" | "slack"

export type IntegrationStatus = "disconnected" | "connecting" | "connected" | "syncing" | "error"

export interface IntegrationConfig {
	type: IntegrationType
	name: string
	enabled: boolean
	status: IntegrationStatus
	authConfig: {
		oauthToken?: string
		refreshToken?: string
		tokenExpiry?: number
		clientId?: string
		clientSecret?: string
		// For Jira
		instanceUrl?: string
		// For Slack
		workspaceId?: string
		// For GitHub
		repoOwner?: string
		repoName?: string
	}
	syncConfig: {
		enabled: boolean
		intervalMinutes: number
		lastSync?: number
		nextSync?: number
	}
	filters?: {
		// GitHub filters
		labels?: string[]
		state?: "open" | "closed" | "all"
		// Jira filters
		projectKeys?: string[]
		issueTypes?: string[]
		// Slack filters
		channels?: string[]
		timeRange?: number // days
	}
}

export interface ExternalContextSource {
	id: string
	type: IntegrationType
	sourceId: string // External ID (e.g., GitHub issue number, Jira key, Slack message timestamp)
	title: string
	url: string
	author: string
	createdAt: number
	updatedAt: number
	content: string // Encrypted if sensitive
	encrypted: boolean
	metadata: {
		// GitHub-specific
		issueNumber?: number
		prNumber?: number
		state?: "open" | "closed"
		labels?: string[]
		// Jira-specific
		issueKey?: string
		issueType?: string
		status?: string
		priority?: string
		// Slack-specific
		channel?: string
		threadTs?: string
		// Common
		mentions?: string[]
		reactions?: string[]
	}
}

export interface ExternalDiscussion {
	id: string
	sourceId: string
	sourceType: IntegrationType
	comments: ExternalComment[]
	relatedFiles: string[] // File paths
	relatedSymbols: string[] // Symbol IDs
	relevanceScore: number
}

export interface ExternalComment {
	id: string
	author: string
	content: string // Encrypted if sensitive
	encrypted: boolean
	createdAt: number
	metadata?: {
		// GitHub-specific
		isCodeReview?: boolean
		commitId?: string
		// Jira-specific
		isInternal?: boolean
		// Slack-specific
		reactions?: Array<{ name: string; count: number; users: string[] }>
	}
}

export interface ExternalRelationship {
	id: string
	sourceId: string // ExternalContextSource.id
	targetType: "file" | "symbol"
	targetId: string // File path or symbol ID
	relationshipType: "mentions" | "discusses" | "implements" | "references" | "fixes"
	confidence: number // 0-1
	createdAt: number
	metadata?: {
		matchedText?: string
		similarityScore?: number
	}
}

export interface SyncResult {
	sourceType: IntegrationType
	success: boolean
	itemsSynced: number
	itemsFailed: number
	itemsSkipped: number
	duration: number
	error?: string
	lastSyncTimestamp: number
}

export interface RateLimiterConfig {
	maxRequests: number
	windowMs: number
}

export interface EncryptionConfig {
	algorithm: string
	keyLength: number
	ivLength: number
}
