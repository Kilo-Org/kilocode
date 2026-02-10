// kilocode_change - file added
import { ovhCloudAiEndpointsDefaultModelId, ovhCloudAiEndpointsDefaultModelInfo } from "@roo-code/types"
import type { ApiHandlerOptions } from "../../shared/api"

import { RouterProvider } from "./router-provider"
import { ApiHandlerCreateMessageMetadata, SingleCompletionHandler } from ".."
import OpenAI from "openai"
import Anthropic from "@anthropic-ai/sdk"
import { ApiStream } from "../transform/stream"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { calculateApiCostOpenAI } from "../../shared/cost"
import { convertToR1Format } from "../transform/r1-format"
import { XmlMatcher } from "../../utils/xml-matcher"
import { verifyFinishReason } from "./kilocode/verifyFinishReason"

export class OVHcloudAIEndpointsHandler extends RouterProvider implements SingleCompletionHandler {
	constructor(options: ApiHandlerOptions) {
		super({
			options,
			name: "ovhcloud",
			baseURL: `${options.ovhCloudAiEndpointsBaseUrl || "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1"}`,
			apiKey: options.ovhCloudAiEndpointsApiKey,
			modelId: options.ovhCloudAiEndpointsModelId,
			defaultModelId: ovhCloudAiEndpointsDefaultModelId,
			defaultModelInfo: ovhCloudAiEndpointsDefaultModelInfo,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const { id: modelId, info } = await this.fetchModel()

		const useR1Format = modelId.toLowerCase().includes("deepseek-r1")
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
			...(useR1Format ? convertToR1Format(messages) : convertToOpenAiMessages(messages)),
		]

		const body: OpenAI.Chat.ChatCompletionCreateParams = {
			model: modelId,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			...(metadata?.tools && { tools: metadata.tools }),
			...(metadata?.tool_choice && { tool_choice: metadata.tool_choice }),
		}

		const completion = await this.client.chat.completions.create(body)

		const matcher = new XmlMatcher(
			"think",
			(chunk) =>
				({
					type: chunk.matched ? "reasoning" : "text",
					text: chunk.data,
				}) as const,
		)

		const activeToolCallIds = new Set<string>()

		for await (const chunk of completion) {
			verifyFinishReason(chunk.choices[0])
			const delta = chunk.choices[0]?.delta
			const finishReason = chunk.choices[0]?.finish_reason

			if (delta?.content) {
				for (const matcherChunk of matcher.update(delta.content)) {
					yield matcherChunk
				}
			}

			if (delta?.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					if (toolCall.id) {
						activeToolCallIds.add(toolCall.id)
					}
					yield {
						type: "tool_call_partial",
						index: toolCall.index,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}

			// Emit tool_call_end events when finish_reason is "tool_calls"
			// This ensures tool calls are finalized even if the stream doesn't properly close
			if (finishReason === "tool_calls" && activeToolCallIds.size > 0) {
				for (const id of activeToolCallIds) {
					yield { type: "tool_call_end", id }
				}
				activeToolCallIds.clear()
			}

			if (chunk.usage) {
				const usage = chunk.usage as OpenAI.CompletionUsage
				yield {
					type: "usage",
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
					totalCost:
						calculateApiCostOpenAI(info, usage.prompt_tokens || 0, usage.completion_tokens || 0)
							.totalCost || undefined,
				}
			}
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		const { id: modelId } = await this.fetchModel()

		try {
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: modelId,
				messages: [{ role: "user", content: prompt }],
			}

			if (this.supportsTemperature(modelId)) {
				requestOptions.temperature = this.options.modelTemperature ?? 0.7
			}

			const response = await this.client.chat.completions.create(requestOptions)
			return response.choices[0]?.message.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`OVHcloud AI Endpoints completion error: ${error.message}`)
			}

			throw error
		}
	}
}
