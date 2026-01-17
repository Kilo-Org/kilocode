import { z } from "zod"

/**
 * Current JSON schema version for CLI output/input
 */
export const JSON_SCHEMA_VERSION = "1.0.0"

/**
 * Unified event types for CLI JSON output
 *
 * These provide semantic categorization of all message types,
 * making it easier for automation tools to handle different events.
 */
export const outputEventSchema = z.enum([
	// System events
	"system.welcome",
	"system.error",
	"system.info",
	"system.ready",
	"system.empty",

	// User interaction
	"user.message",
	"user.approval",

	// Assistant events
	"assistant.message",
	"assistant.reasoning",
	"assistant.completion",

	// Tool events
	"tool.request",
	"tool.approved",
	"tool.rejected",
	"tool.output",

	// API events
	"api.request_started",
	"api.request_completed",
	"api.request_failed",
	"api.request_retried",

	// Task lifecycle
	"task.resumed",
	"task.completed",
	"task.checkpoint",

	// Context management
	"context.condensed",
	"context.truncated",

	// Unknown/unmapped events
	"unknown",
])

export type OutputEvent = z.infer<typeof outputEventSchema>

/**
 * Message status for streaming support
 */
export const messageStatusSchema = z.enum(["partial", "complete"])

export type MessageStatus = z.infer<typeof messageStatusSchema>

/**
 * CLI message types
 */
export const cliMessageTypeSchema = z.enum([
	"user",
	"assistant",
	"system",
	"error",
	"welcome",
	"empty",
	"requestCheckpointRestoreApproval",
])

export type CliMessageType = z.infer<typeof cliMessageTypeSchema>

/**
 * Map CLI message type to unified event
 */
export function mapCliTypeToEvent(type: string): OutputEvent {
	switch (type) {
		case "welcome":
			return "system.welcome"
		case "error":
			return "system.error"
		case "system":
			return "system.info"
		case "empty":
			return "system.empty"
		case "user":
			return "user.message"
		case "assistant":
			return "assistant.message"
		case "requestCheckpointRestoreApproval":
			return "task.checkpoint"
		default:
			return "unknown"
	}
}

/**
 * Map extension "ask" type to unified event
 */
export function mapAskToEvent(ask: string): OutputEvent {
	switch (ask) {
		case "followup":
			return "user.approval"
		case "tool":
		case "command":
		case "browser_action_launch":
		case "use_mcp_server":
			return "tool.request"
		case "api_req_failed":
			return "api.request_failed"
		case "resume_task":
		case "resume_completed_task":
			return "task.resumed"
		case "completion_result":
			return "task.completed"
		case "checkpoint_restore":
			return "task.checkpoint"
		case "command_output":
			return "tool.request"
		case "mistake_limit_reached":
		case "auto_approval_max_req_reached":
		case "payment_required_prompt":
		case "invalid_model":
		case "report_bug":
		case "condense":
			return "user.approval"
		default:
			return "unknown"
	}
}

/**
 * Map extension "say" type to unified event
 */
export function mapSayToEvent(say: string): OutputEvent {
	switch (say) {
		case "text":
			return "assistant.message"
		case "user_feedback":
		case "user_feedback_diff":
			return "user.message"
		case "reasoning":
			return "assistant.reasoning"
		case "completion_result":
			return "assistant.completion"
		case "api_req_started":
			return "api.request_started"
		case "api_req_finished":
			return "api.request_completed"
		case "api_req_retried":
		case "api_req_retry_delayed":
		case "api_req_rate_limit_wait":
			return "api.request_retried"
		case "api_req_deleted":
			return "api.request_failed"
		case "command_output":
		case "browser_action":
		case "browser_action_result":
		case "mcp_server_request_started":
		case "mcp_server_response":
		case "subtask_result":
			return "tool.output"
		case "checkpoint_saved":
			return "task.checkpoint"
		case "condense_context":
			return "context.condensed"
		case "condense_context_error":
			return "system.error"
		case "sliding_window_truncation":
			return "context.truncated"
		case "error":
		case "rooignore_error":
		case "diff_error":
		case "shell_integration_warning":
			return "system.error"
		case "image":
		case "codebase_search_result":
		case "user_edit_todos":
		case "browser_session_status":
			return "assistant.message"
		default:
			return "unknown"
	}
}
