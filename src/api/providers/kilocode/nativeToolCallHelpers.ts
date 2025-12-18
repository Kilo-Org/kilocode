import OpenAI from "openai"
import type { ApiHandlerCreateMessageMetadata } from "../../index"
import {
	getModelId,
	nativeFunctionCallingProviders, // kilocode_change
	ProviderName,
	ProviderSettings,
	TOOL_PROTOCOL,
	ToolProtocol,
} from "@roo-code/types"
import Anthropic from "@anthropic-ai/sdk"
import { ApiStreamToolCallChunk } from "../../transform/stream"
import { resolveToolProtocol } from "../../../utils/resolveToolProtocol"

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
	options: ProviderSettings,
	metadata?: ApiHandlerCreateMessageMetadata,
): T {
	// When toolStyle is "native" and allowedTools exist, add them to params
	if (resolveToolProtocol(options) === "native" && metadata?.tools) {
		params.tools = metadata.tools
		//optimally we'd have tool_choice as 'required', but many providers, especially
		// those using SGlang dont properly handle that setting and barf with a 400.
		params.tool_choice = "auto" as const
		params.parallel_tool_calls = false
	}

	return params
}

export class ToolCallAccumulator {
	private accumulator = new Map<number, { id: string; name: string; arguments: string }>();

	*processChunk(chunk: OpenAI.Chat.Completions.ChatCompletionChunk | undefined): Generator<ApiStreamToolCallChunk> {
		const choice = chunk?.choices?.[0]
		const delta = choice?.delta
		if (delta && "tool_calls" in delta && Array.isArray(delta.tool_calls)) {
			for (const toolCall of delta.tool_calls) {
				const index = toolCall.index
				const existing = this.accumulator.get(index)

				if (existing) {
					if (toolCall.function?.arguments) {
						existing.arguments += toolCall.function.arguments
					}
				} else {
					this.accumulator.set(index, {
						id: toolCall.id || "",
						name: toolCall.function?.name || "",
						arguments: toolCall.function?.arguments || "",
					})
				}
			}
		}
		if (choice?.finish_reason === "tool_calls") {
			for (const toolCall of this.accumulator.values()) {
				yield {
					type: "tool_call",
					id: toolCall.id,
					name: toolCall.name,
					arguments: toolCall.arguments,
				}
			}
			this.accumulator.clear()
		}
	}
}

export class ToolCallAccumulatorAnthropic {
	private currentToolCall = { id: "", name: "", arguments: "" };

	*processChunk(chunk: Anthropic.RawMessageStreamEvent): Generator<ApiStreamToolCallChunk> {
		if (chunk.type == "content_block_start" && chunk.content_block.type === "tool_use") {
			this.currentToolCall.id = chunk.content_block.id
			this.currentToolCall.name = chunk.content_block.name
		}
		if (chunk.type === "content_block_delta" && chunk.delta.type === "input_json_delta") {
			this.currentToolCall.arguments += chunk.delta.partial_json
		}
		if (chunk.type === "content_block_stop") {
			if (this.currentToolCall.id) {
				yield {
					type: "tool_call",
					id: this.currentToolCall.id,
					name: this.currentToolCall.name,
					arguments: this.currentToolCall.arguments,
				}
				this.currentToolCall.id = ""
				this.currentToolCall.name = ""
				this.currentToolCall.arguments = ""
			}
		}
	}
}

export function convertOpenAIToolsToAnthropic(allowedTools?: OpenAI.Chat.ChatCompletionTool[]): Anthropic.ToolUnion[] {
	if (!allowedTools) return []

	return allowedTools
		.filter((tool) => tool.type === "function" && "function" in tool && !!tool.function)
		.map((tool) => {
			const func = (tool as any).function
			return {
				name: func.name,
				description: func.description || "",
				input_schema: func.parameters || { type: "object", properties: {} },
			}
		})
}
