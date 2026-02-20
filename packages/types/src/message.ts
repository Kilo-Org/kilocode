import { z } from "zod"
import { kiloCodeMetaDataSchema } from "./kilocode/kilocode.js"

/**
 * ClineAsk
 */

/**
 * Array of possible ask types that the LLM can use to request user interaction or approval.
 * These represent different scenarios where the assistant needs user input to proceed.
 *
 * @constant
 * @readonly
 *
 * Ask type descriptions:
 * - `followup`: LLM asks a clarifying question to gather more information needed to complete the task
 * - `command`: Permission to execute a terminal/shell command
 * - `command_output`: Permission to read the output from a previously executed command
 * - `completion_result`: Task has been completed, awaiting user feedback or a new task
 * - `tool`: Permission to use a tool for file operations (read, write, search, etc.)
 * - `api_req_failed`: API request failed, asking user whether to retry
 * - `resume_task`: Confirmation needed to resume a previously paused task
 * - `resume_completed_task`: Confirmation needed to resume a task that was already marked as completed
 * - `mistake_limit_reached`: Too many errors encountered, needs user guidance on how to proceed
 * - `browser_action_launch`: Permission to open or interact with a browser
 * - `use_mcp_server`: Permission to use Model Context Protocol (MCP) server functionality
 * - `auto_approval_max_req_reached`: Auto-approval limit has been reached, manual approval required
 */
export const clineAsks = [
	"followup",
	"command",
	"command_output",
	"completion_result",
	"tool",
	"api_req_failed",
	"resume_task",
	"resume_completed_task",
	"mistake_limit_reached",
	"browser_action_launch",
	"use_mcp_server",
	"auto_approval_max_req_reached",
	// kilocode_change start
	"payment_required_prompt", // Added for the low credits dialog
	"unauthorized_prompt", // Added for unauthorized error when using paid models
	"promotion_model_sign_up_required_prompt",
	"invalid_model",
	"report_bug",
	"condense",
	"checkpoint_restore", // Added for checkpoint restore approval
	// kilocode_change end
] as const

export const clineAskSchema = z.enum(clineAsks)

export type ClineAsk = z.infer<typeof clineAskSchema>
/**
 * IdleAsk
 *
 * Asks that put the task into an "idle" state.
 */

export const idleAsks = [
	// kilocode_change start
	"payment_required_prompt",
	"unauthorized_prompt",
	"promotion_model_sign_up_required_prompt",
	"invalid_model",
	// kilocode_change end
	"completion_result",
	"api_req_failed",
	"resume_completed_task",
	"mistake_limit_reached",
	"auto_approval_max_req_reached",
] as const satisfies readonly ClineAsk[]

export type IdleAsk = (typeof idleAsks)[number]

export function isIdleAsk(ask: ClineAsk): ask is IdleAsk {
	return (idleAsks as readonly ClineAsk[]).includes(ask)
}

/**
 * ResumableAsk
 *
 * Asks that put the task into an "resumable" state.
 */

export const resumableAsks = ["resume_task"] as const satisfies readonly ClineAsk[]

export type ResumableAsk = (typeof resumableAsks)[number]

export function isResumableAsk(ask: ClineAsk): ask is ResumableAsk {
	return (resumableAsks as readonly ClineAsk[]).includes(ask)
}

/**
 * InteractiveAsk
 *
 * Asks that put the task into an "user interaction required" state.
 */

export const interactiveAsks = [
	// kilocode_change start
	"report_bug",
	"condense",
	"checkpoint_restore",
	// kilocode_change end
	"followup",
	"command",
	"tool",
	"browser_action_launch",
	"use_mcp_server",
] as const satisfies readonly ClineAsk[]

export type InteractiveAsk = (typeof interactiveAsks)[number]

export function isInteractiveAsk(ask: ClineAsk): ask is InteractiveAsk {
	return (interactiveAsks as readonly ClineAsk[]).includes(ask)
}

/**
 * NonBlockingAsk
 *
 * Asks that are not associated with an actual approval, and are only used
 * to update chat messages.
 */

export const nonBlockingAsks = ["command_output"] as const satisfies readonly ClineAsk[]

export type NonBlockingAsk = (typeof nonBlockingAsks)[number]

export function isNonBlockingAsk(ask: ClineAsk): ask is NonBlockingAsk {
	return (nonBlockingAsks as readonly ClineAsk[]).includes(ask)
}

/**
 * ClineSay
 */

/**
 * Array of possible say types that represent different kinds of messages the assistant can send.
 * These are used to categorize and handle various types of communication from the LLM to the user.
 *
 * @constant
 * @readonly
 *
 * Say type descriptions:
 * - `error`: General error message
 * - `api_req_started`: Indicates an API request has been initiated
 * - `api_req_finished`: Indicates an API request has completed successfully
 * - `api_req_retried`: Indicates an API request is being retried after a failure
 * - `api_req_retry_delayed`: Indicates an API request retry has been delayed
 * - `api_req_rate_limit_wait`: Indicates a configured rate-limit wait (not an error)
 * - `api_req_deleted`: Indicates an API request has been deleted/cancelled
 * - `text`: General text message or assistant response
 * - `reasoning`: Assistant's reasoning or thought process (often hidden from user)
 * - `completion_result`: Final result of task completion
 * - `user_feedback`: Message containing user feedback
 * - `user_feedback_diff`: Diff-formatted feedback from user showing requested changes
 * - `command_output`: Output from an executed command
 * - `shell_integration_warning`: Warning about shell integration issues or limitations
 * - `browser_action`: Action performed in the browser
 * - `browser_action_result`: Result of a browser action
 * - `mcp_server_request_started`: MCP server request has been initiated
 * - `mcp_server_response`: Response received from MCP server
 * - `subtask_result`: Result of a completed subtask
 * - `checkpoint_saved`: Indicates a checkpoint has been saved
 * - `rooignore_error`: Error related to .rooignore file processing
 * - `diff_error`: Error occurred while applying a diff/patch
 * - `condense_context`: Context condensation/summarization has started
 * - `condense_context_error`: Error occurred during context condensation
 * - `codebase_search_result`: Results from searching the codebase
 */
export const clineSays = [
	"error",
	"api_req_started",
	"api_req_finished",
	"api_req_retried",
	"api_req_retry_delayed",
	"api_req_rate_limit_wait",
	"api_req_deleted",
	"text",
	"image",
	"reasoning",
	"completion_result",
	"user_feedback",
	"user_feedback_diff",
	"command_output",
	"shell_integration_warning",
	"browser_action",
	"browser_action_result",
	"browser_session_status",
	"mcp_server_request_started",
	"mcp_server_response",
	"subtask_result",
	"checkpoint_saved",
	"rooignore_error",
	"diff_error",
	"condense_context",
	"condense_context_error",
	"sliding_window_truncation",
	"codebase_search_result",
	"user_edit_todos",
] as const

export const clineSaySchema = z.enum(clineSays)

export type ClineSay = z.infer<typeof clineSaySchema>

/**
 * ToolProgressStatus
 */

export const toolProgressStatusSchema = z.object({
	icon: z.string().optional(),
	text: z.string().optional(),
})

export type ToolProgressStatus = z.infer<typeof toolProgressStatusSchema>

/**
 * ContextCondense
 *
 * Data associated with a successful context condensation event.
 * This is attached to messages with `say: "condense_context"` when
 * the condensation operation completes successfully.
 *
 * @property cost - The API cost incurred for the condensation operation
 * @property prevContextTokens - Token count before condensation
 * @property newContextTokens - Token count after condensation
 * @property summary - The condensed summary that replaced the original context
 * @property condenseId - Optional unique identifier for this condensation operation
 */
export const contextCondenseSchema = z.object({
	cost: z.number(),
	prevContextTokens: z.number(),
	newContextTokens: z.number(),
	summary: z.string(),
	condenseId: z.string().optional(),
})

export type ContextCondense = z.infer<typeof contextCondenseSchema>

/**
 * ContextTruncation
 *
 * Data associated with a sliding window truncation event.
 * This is attached to messages with `say: "sliding_window_truncation"` when
 * messages are removed from the conversation history to stay within token limits.
 *
 * Unlike condensation, truncation simply removes older messages without
 * summarizing them. This is a faster but less context-preserving approach.
 *
 * @property truncationId - Unique identifier for this truncation operation
 * @property messagesRemoved - Number of conversation messages that were removed
 * @property prevContextTokens - Token count before truncation occurred
 * @property newContextTokens - Token count after truncation occurred
 */
export const contextTruncationSchema = z.object({
	truncationId: z.string(),
	messagesRemoved: z.number(),
	prevContextTokens: z.number(),
	newContextTokens: z.number(),
})

export type ContextTruncation = z.infer<typeof contextTruncationSchema>

/**
 * ClineMessage
 *
 * The main message type used for communication between the extension and webview.
 * Messages can either be "ask" (requiring user response) or "say" (informational).
 *
 * Context Management Fields:
 * - `contextCondense`: Present when `say: "condense_context"` and condensation succeeded
 * - `contextTruncation`: Present when `say: "sliding_window_truncation"` and truncation occurred
 *
 * Note: These fields are mutually exclusive - a message will have at most one of them.
 */
export const clineMessageSchema = z.object({
	ts: z.number(),
	type: z.union([z.literal("ask"), z.literal("say")]),
	ask: clineAskSchema.optional(),
	say: clineSaySchema.optional(),
	text: z.string().optional(),
	images: z.array(z.string()).optional(),
	partial: z.boolean().optional(),
	reasoning: z.string().optional(),
	conversationHistoryIndex: z.number().optional(),
	checkpoint: z.record(z.string(), z.unknown()).optional(),
	progressStatus: toolProgressStatusSchema.optional(),
	/**
	 * Data for successful context condensation.
	 * Present when `say: "condense_context"` and `partial: false`.
	 */
	contextCondense: contextCondenseSchema.optional(),
	/**
	 * Data for sliding window truncation.
	 * Present when `say: "sliding_window_truncation"`.
	 */
	contextTruncation: contextTruncationSchema.optional(),
	isProtected: z.boolean().optional(),
	apiProtocol: z.union([z.literal("openai"), z.literal("anthropic")]).optional(),
	isAnswered: z.boolean().optional(),
	// kilocode_change start
	metadata: z
		.object({
			kiloCode: kiloCodeMetaDataSchema.optional(),
		})
		.optional(),
	// kilocode_change end
})

export type ClineMessage = z.infer<typeof clineMessageSchema>

/**
 * TokenUsage
 */

export const tokenUsageSchema = z.object({
	totalTokensIn: z.number(),
	totalTokensOut: z.number(),
	totalCacheWrites: z.number().optional(),
	totalCacheReads: z.number().optional(),
	totalCost: z.number(),
	contextTokens: z.number(),
})

export type TokenUsage = z.infer<typeof tokenUsageSchema>

/**
 * QueuedMessage
 */

export const queuedMessageSchema = z.object({
	timestamp: z.number(),
	id: z.string(),
	text: z.string(),
	images: z.array(z.string()).optional(),
})

export type QueuedMessage = z.infer<typeof queuedMessageSchema>
