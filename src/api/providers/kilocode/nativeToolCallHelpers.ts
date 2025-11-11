/**
 * Native Tool Call Helpers
 *
 * This module provides helper functions to enable native tool calling support for API providers
 * that use OpenAI-compatible chat completion APIs. Native tool calling allows models to invoke
 * tools directly rather than returning XML-formatted instructions.
 *
 * ## Enabling Native Tool Calling for a Provider
 *
 * To add native tool calling support to a provider, follow these steps:
 *
 * ### 1. Import the helper functions
 * ```typescript
 * import { addNativeToolCallsToParams, processNativeToolCallsFromDelta } from "./kilocode/nativeToolCallHelpers"
 * ```
 *
 * ### 2. Add tool parameters before creating the completion
 * In your provider's `createMessage` method, after constructing the completion parameters object,
 * call `addNativeToolCallsToParams` to add tool calling support:
 *
 * ```typescript
 * const completionParams = {
 *   model: modelId,
 *   messages: openAiMessages,
 *   stream: true,
 *   // ... other params
 * }
 *
 * // Add native tool call support when toolStyle is "json"
 * addNativeToolCallsToParams(completionParams, this.options, metadata)
 *
 * const stream = await this.client.chat.completions.create(completionParams)
 * ```
 *
 * ### 3. Process tool calls in the streaming response
 * In your stream processing loop, after handling reasoning content but before handling regular content,
 * add tool call processing:
 *
 * ```typescript
 * for await (const chunk of stream) {
 *   const delta = chunk.choices[0]?.delta
 *
 *   // Handle reasoning if present
 *   if (delta?.reasoning) {
 *     yield { type: "reasoning", text: delta.reasoning }
 *   }
 *
 *   // Handle native tool calls when toolStyle is "json"
 *   yield* processNativeToolCallsFromDelta(delta, this.options.toolStyle)
 *
 *   // Handle regular content
 *   if (delta?.content) {
 *     yield { type: "text", text: delta.content }
 *   }
 * }
 * ```
 *
 * ## What These Helpers Do
 *
 * - `addNativeToolCallsToParams`: Sets `parallel_tool_calls: false` and adds `tools` and `tool_choice`
 *   parameters when toolStyle is "json" and allowed tools are provided
 *
 * - `processNativeToolCallsFromDelta`: Processes streaming tool call deltas and yields them as
 *   ApiStreamNativeToolCallsChunk objects for the AssistantMessageParser to accumulate
 *
 * ## Example Providers
 *
 * See the following providers for complete implementation examples:
 * - `openrouter.ts` - OpenRouter implementation
 */

import { ProviderSettings, ToolUseStyle } from "@roo-code/types"
import OpenAI from "openai"
import { nativeTools } from "../../../core/prompts/tools/native-tools"
import type { ApiHandlerCreateMessageMetadata } from "../../index"
import type { ApiStreamNativeToolCallsChunk } from "../../transform/kilocode/api-stream-native-tool-calls-chunk"

/**
 * Adds native tool call parameters to OpenAI chat completion params when toolStyle is "json"
 *
 * @param params - The OpenAI chat completion parameters to augment
 * @param options - Provider options containing toolStyle configuration
 * @param metadata - Optional metadata that may contain allowedTools
 * @returns Augmented parameters with native tool call settings
 */
export function addNativeToolCallsToParams<T extends OpenAI.Chat.ChatCompletionCreateParams>(
	params: T,
	_options: ProviderSettings,
	_metadata?: ApiHandlerCreateMessageMetadata,
): T {
	// When toolStyle is "json", always add all native tools

	// Use allowedTools if provided, otherwise use all native tools
	const tools = nativeTools
	if (tools && tools.length > 0) {
		params.tools = tools
		//optimally we'd have tool_choice as 'required', but many providers, especially
		// those using SGlang dont properly handle that setting and barf with a 400.
		params.tool_choice = "auto" as const
		params.parallel_tool_calls = true
	}

	return params
}

/**
 * Processes native tool calls from OpenAI streaming delta responses
 *
 * @param delta - The delta object from a streaming response
 * @param toolStyle - The tool style configuration of the provider
 * @yields ApiStreamNativeToolCallsChunk when valid tool calls are found in JSON mode
 */
export function* processNativeToolCallsFromDelta(
	delta: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta | undefined,
	toolStyle: ToolUseStyle | undefined,
): Generator<ApiStreamNativeToolCallsChunk, void, undefined> {
	// Check if delta contains tool calls
	if (delta && delta.tool_calls && delta.tool_calls.length > 0) {
		// Filter tool calls to keep only those with function data
		// Map to the ApiStreamNativeToolCallsChunk format
		const validToolCalls = delta.tool_calls
			.filter((tc) => tc.function) // Keep any delta with function data
			.map((tc) => ({
				index: tc.index, // Use index to track across deltas
				id: tc.id, // Only present in first delta
				type: tc.type,
				function: {
					name: tc.function!.name || "", // Name only in first delta
					arguments: tc.function!.arguments || "", // Arguments accumulate across deltas
				},
			}))

		if (validToolCalls.length > 0) {
			if (toolStyle !== "json") {
				console.warn(
					"Model produced native tool calls while toolStyle is not 'json'; proceeding to process anyway",
					delta.tool_calls,
				)
			}

			yield {
				type: "native_tool_calls",
				toolCalls: validToolCalls,
			}
		}
	}
}
