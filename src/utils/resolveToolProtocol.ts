import { ToolProtocol, TOOL_PROTOCOL } from "@roo-code/types"
import type { ProviderSettings } from "@roo-code/types"
import type { Anthropic } from "@anthropic-ai/sdk"
import { findLast, findLastIndex } from "../shared/array"

/**
 * Represents an API message in the conversation history.
 * This is a minimal type definition for the detection function.
 */
type ApiMessageForDetection = Anthropic.MessageParam & {
	ts?: number
}

/**
 * Resolve the effective tool protocol.
 *
 * **Deprecation Note (XML Protocol):**
 * XML tool protocol has been deprecated. Most models now use Native tool calling.
 * User/profile preferences (`providerSettings.toolProtocol`) and model defaults
 * (`modelInfo.defaultToolProtocol`) are ignored.
 *
 * **Exception: Claude Code Provider**
 * Claude Code CLI uses `--disallowedTools` which prevents native tool_use blocks.
 * Therefore, Claude Code must use XML protocol for tool calls.
 *
 * Precedence:
 * 1. Locked Protocol (task-level lock for resumed tasks - highest priority)
 * 2. XML (for claude-code provider - required due to CLI limitations)
 * 3. Native (for all other providers)
 *
 * @param providerSettings - The provider settings (used to check apiProvider)
 * @param _modelInfo - Unused, kept for API compatibility
 * @param lockedProtocol - Optional task-locked protocol that takes absolute precedence
 * @returns The resolved tool protocol (either "xml" or "native")
 */
export function resolveToolProtocol(
	providerSettings: ProviderSettings,
	_modelInfo?: unknown,
	lockedProtocol?: ToolProtocol,
): ToolProtocol {
	// 1. Locked Protocol - task-level lock takes absolute precedence
	// This ensures resumed tasks continue using their original protocol
	if (lockedProtocol) {
		return lockedProtocol
	}

	// 2. Claude Code provider MUST use XML protocol
	// Claude Code CLI uses --disallowedTools which prevents native tool_use blocks.
	// The model must use XML-formatted tool calls in the text response instead.
	if (providerSettings.apiProvider === "claude-code") {
		return TOOL_PROTOCOL.XML
	}

	// 3. All other providers use Native protocol
	return TOOL_PROTOCOL.NATIVE
}

/**
 * Detect the tool protocol used in an existing conversation history.
 *
 * This function scans the API conversation history for tool_use blocks
 * and determines which protocol was used based on their structure:
 *
 * - Native protocol: tool_use blocks ALWAYS have an `id` field
 * - XML protocol: tool_use blocks NEVER have an `id` field
 *
 * This is critical for task resumption: if a task previously used tools
 * with a specific protocol, we must continue using that protocol even
 * if the user's NTC settings have changed.
 *
 * The function searches from the most recent message backwards to find
 * the last tool call, which represents the task's current protocol state.
 *
 * @param messages - The API conversation history to scan
 * @returns The detected protocol, or undefined if no tool calls were found
 */
export function detectToolProtocolFromHistory(messages: ApiMessageForDetection[]): ToolProtocol | undefined {
	// Find the last assistant message that contains a tool_use block
	const lastAssistantWithTool = findLast(messages, (message) => {
		if (message.role !== "assistant") {
			return false
		}
		const content = message.content
		if (!Array.isArray(content)) {
			return false
		}
		return content.some((block) => block.type === "tool_use")
	})

	if (!lastAssistantWithTool) {
		return undefined
	}

	// Find the last tool_use block in that message's content
	const content = lastAssistantWithTool.content as Anthropic.ContentBlock[]
	const lastToolUseIndex = findLastIndex(content, (block) => block.type === "tool_use")

	if (lastToolUseIndex === -1) {
		return undefined
	}

	const lastToolUse = content[lastToolUseIndex]

	// The presence or absence of `id` determines the protocol:
	// - Native protocol tool calls ALWAYS have an ID (set when parsed from tool_call chunks)
	// - XML protocol tool calls NEVER have an ID (parsed from XML text)
	// This pattern is used in presentAssistantMessage.ts:497-500
	const hasId = "id" in lastToolUse && !!lastToolUse.id
	return hasId ? TOOL_PROTOCOL.NATIVE : TOOL_PROTOCOL.XML
}
