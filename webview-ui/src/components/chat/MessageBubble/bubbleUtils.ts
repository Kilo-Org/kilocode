// kilocode_change - new file
/**
 * Utility functions for message bubble handling.
 */

import type { ClineMessage } from "@roo-code/types"
import type { BubbleVariant } from "./bubbleStyles"

/**
 * Determines the bubble variant based on message type and content.
 *
 * @param message - The ClineMessage to analyze
 * @returns The appropriate bubble variant
 */
export function getBubbleVariant(message: ClineMessage): BubbleVariant {
	// User-initiated messages (user input, follow-up responses)
	if (message.type === "ask") {
		// These are typically user-facing questions or prompts
		const userAskTypes = ["followup", "completion_result", "resume_task", "resume_completed_task"]
		if (message.ask && userAskTypes.includes(message.ask)) {
			// completion_result and resume are actually AI-generated
			return "ai"
		}
	}

	// Check for user text messages (the actual user input)
	// User messages are typically the first message or responses to asks
	if (message.say === "user_feedback" || message.say === "user_feedback_diff") {
		return "user"
	}

	// AI text responses
	if (message.say === "text") {
		return "ai"
	}

	// System messages: tool outputs, commands, API requests, errors
	const systemSayTypes = [
		"api_req_started",
		"api_req_finished",
		"api_req_retry_delayed",
		"command_output",
		"mcp_server_request_started",
		"mcp_server_response",
		"browser_action",
		"browser_action_result",
		"shell_integration_warning",
		"checkpoint_saved",
		"condense_context",
		"condense_context_error",
	]

	if (message.say && systemSayTypes.includes(message.say)) {
		return "system"
	}

	// Tool-related asks are system messages
	const systemAskTypes = [
		"tool",
		"command",
		"command_output",
		"browser_action_launch",
		"use_mcp_server",
		"api_req_failed",
		"mistake_limit_reached",
		"report_bug",
		"condense",
	]

	if (message.ask && systemAskTypes.includes(message.ask)) {
		return "system"
	}

	// Error messages
	if (message.say === "error") {
		return "system"
	}

	// Default to system for unknown types
	return "system"
}

/**
 * Checks if two consecutive messages are from the same sender type.
 * Used to determine if reduced spacing should be applied.
 *
 * @param currentMessage - The current message
 * @param previousMessage - The previous message (if any)
 * @returns True if messages are from the same sender type
 */
export function isSameSender(currentMessage: ClineMessage, previousMessage?: ClineMessage): boolean {
	if (!previousMessage) {
		return false
	}

	const currentVariant = getBubbleVariant(currentMessage)
	const previousVariant = getBubbleVariant(previousMessage)

	return currentVariant === previousVariant
}

/**
 * Determines if a message should be displayed as a bubble.
 * Some message types may not need bubble styling.
 *
 * @param message - The message to check
 * @returns True if the message should have bubble styling
 */
export function shouldShowBubble(message: ClineMessage): boolean {
	// API request messages are typically collapsed/hidden
	if (message.say === "api_req_started" || message.say === "api_req_finished") {
		return false
	}

	// Most other messages should show bubbles
	return true
}

/**
 * Gets the ARIA label for a message bubble for accessibility.
 *
 * @param variant - The bubble variant
 * @param isStreaming - Whether the message is currently streaming
 * @returns The ARIA label string
 */
export function getBubbleAriaLabel(variant: BubbleVariant, isStreaming: boolean = false): string {
	const senderLabels: Record<BubbleVariant, string> = {
		user: "Your message",
		ai: "Assistant message",
		system: "System message",
	}

	const label = senderLabels[variant]
	return isStreaming ? `${label}, currently streaming` : label
}
