import { z } from "zod"

/**
 * Cloud Agent V2 API Types
 *
 * These types define the request/response schemas for the Kilo Code Cloud Agent V2 API.
 * The API allows starting and managing cloud-based agent sessions.
 */

// =============================================================================
// Agent Mode Schema
// =============================================================================

/**
 * Valid agent execution modes
 */
export const AgentModeSchema = z.enum(["architect", "code", "ask", "debug", "orchestrator"])
export type AgentMode = z.infer<typeof AgentModeSchema>

// =============================================================================
// Prepare Session
// =============================================================================

/**
 * Request body for preparing a cloud agent session.
 *
 * Uses the public API schema from kilocode-backend which requires:
 * - githubRepo in "owner/repo" format (NOT a full URL)
 * - prompt, mode, model are required
 * - organizationId is optional for team/org sessions
 */
export const CloudAgentPrepareRequestSchema = z.object({
	/** GitHub repository in "owner/repo" format (e.g., "kilocode/kilocode") */
	githubRepo: z
		.string()
		.regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/, "Invalid repository format. Expected: owner/repo"),
	/** The initial prompt/task for the agent */
	prompt: z.string().min(1, "Prompt is required").max(100_000, "Prompt must be at most 100,000 characters"),
	/** Kilo Code execution mode */
	mode: AgentModeSchema,
	/** AI model to use (e.g., "claude-sonnet-4-20250514") */
	model: z.string().min(1, "Model is required"),
	/** Organization ID (optional, for team/org sessions) */
	organizationId: z.string().uuid("Invalid organization ID format").optional(),
})

export type CloudAgentPrepareRequest = z.infer<typeof CloudAgentPrepareRequestSchema>

/**
 * Response from preparing a cloud agent session
 */
export const CloudAgentPrepareResponseSchema = z.object({
	/** The Kilo CLI session UUID */
	kiloSessionId: z.string().uuid(),
	/** The unique cloud agent session ID */
	cloudAgentSessionId: z.string(),
})

export type CloudAgentPrepareResponse = z.infer<typeof CloudAgentPrepareResponseSchema>

// =============================================================================
// Initiate Session
// =============================================================================

/**
 * Request body for initiating a prepared cloud agent session
 */
export const CloudAgentInitiateRequestSchema = z.object({
	/** The session ID from the prepare step */
	cloudAgentSessionId: z.string(),
})

export type CloudAgentInitiateRequest = z.infer<typeof CloudAgentInitiateRequestSchema>

/**
 * Response from initiating a cloud agent session
 */
export const CloudAgentInitiateResponseSchema = z.object({
	/** Whether the session was successfully initiated */
	success: z.boolean(),
})

export type CloudAgentInitiateResponse = z.infer<typeof CloudAgentInitiateResponseSchema>

// =============================================================================
// Send Message
// =============================================================================

/**
 * Request body for sending a follow-up message to a cloud agent session
 */
export const CloudAgentSendMessageRequestSchema = z.object({
	/** The session ID */
	cloudAgentSessionId: z.string(),
	/** The message content */
	message: z.string().min(1),
})

export type CloudAgentSendMessageRequest = z.infer<typeof CloudAgentSendMessageRequestSchema>

/**
 * Response from sending a message
 */
export const CloudAgentSendMessageResponseSchema = z.object({
	/** Whether the message was successfully queued */
	success: z.boolean(),
	/** Position in the message queue (messages run sequentially) */
	queuePosition: z.number().optional(),
})

export type CloudAgentSendMessageResponse = z.infer<typeof CloudAgentSendMessageResponseSchema>

// =============================================================================
// WebSocket Stream Events
// =============================================================================

/**
 * Base schema for all WebSocket stream events
 */
export const CloudAgentStreamEventBaseSchema = z.object({
	/** Event type identifier */
	type: z.string(),
	/** Timestamp of the event */
	timestamp: z.number(),
})

/**
 * Text output event from the cloud agent
 */
export const CloudAgentTextEventSchema = CloudAgentStreamEventBaseSchema.extend({
	type: z.literal("text"),
	/** The text content */
	content: z.string(),
})

export type CloudAgentTextEvent = z.infer<typeof CloudAgentTextEventSchema>

/**
 * Tool use event from the cloud agent
 */
export const CloudAgentToolUseEventSchema = CloudAgentStreamEventBaseSchema.extend({
	type: z.literal("tool_use"),
	/** Tool name */
	tool: z.string(),
	/** Tool input parameters */
	input: z.record(z.unknown()),
})

export type CloudAgentToolUseEvent = z.infer<typeof CloudAgentToolUseEventSchema>

/**
 * Tool result event from the cloud agent
 */
export const CloudAgentToolResultEventSchema = CloudAgentStreamEventBaseSchema.extend({
	type: z.literal("tool_result"),
	/** Tool name */
	tool: z.string(),
	/** Tool output */
	output: z.unknown(),
	/** Whether the tool execution was successful */
	success: z.boolean(),
})

export type CloudAgentToolResultEvent = z.infer<typeof CloudAgentToolResultEventSchema>

/**
 * Session status event
 */
export const CloudAgentStatusEventSchema = CloudAgentStreamEventBaseSchema.extend({
	type: z.literal("status"),
	/** Session status */
	status: z.enum(["running", "completed", "error", "cancelled"]),
	/** Optional error message */
	error: z.string().optional(),
})

export type CloudAgentStatusEvent = z.infer<typeof CloudAgentStatusEventSchema>

/**
 * Union of all possible stream events
 */
export const CloudAgentStreamEventSchema = z.discriminatedUnion("type", [
	CloudAgentTextEventSchema,
	CloudAgentToolUseEventSchema,
	CloudAgentToolResultEventSchema,
	CloudAgentStatusEventSchema,
])

export type CloudAgentStreamEvent = z.infer<typeof CloudAgentStreamEventSchema>

// =============================================================================
// API URLs
// =============================================================================

/**
 * Cloud Agent API base URLs
 */
export const CLOUD_AGENT_API_URL = "https://api.kilo.ai"
export const CLOUD_AGENT_SESSION_URL = "https://cloud-agent.kilosessions.ai"

/**
 * Get the URL for preparing a cloud agent session
 */
export function getCloudAgentPrepareUrl(): string {
	return `${CLOUD_AGENT_API_URL}/api/cloud-agent/sessions/prepare`
}

/**
 * Get the URL for initiating a cloud agent session
 */
export function getCloudAgentInitiateUrl(): string {
	return `${CLOUD_AGENT_SESSION_URL}/trpc/initiateFromKilocodeSessionV2`
}

/**
 * Get the URL for sending a message to a cloud agent session
 */
export function getCloudAgentSendMessageUrl(): string {
	return `${CLOUD_AGENT_SESSION_URL}/trpc/sendMessageV2`
}

/**
 * Get the WebSocket URL for streaming cloud agent events
 */
export function getCloudAgentStreamUrl(sessionId: string): string {
	return `wss://cloud-agent.kilosessions.ai/stream?sessionId=${encodeURIComponent(sessionId)}`
}
