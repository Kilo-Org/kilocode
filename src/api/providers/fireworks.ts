import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { ApiHandler, SingleCompletionHandler } from "../"
import {
	ApiHandlerOptions,
	FireworksModelId,
	ModelInfo,
	fireworksDefaultModelId,
	fireworksModels,
} from "../../shared/api"
import { calculateApiCostOpenAI } from "../../utils/cost"
import { convertToOpenAiMessages } from "../transform/openai-format"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"

export class FireworksHandler extends BaseProvider implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	private client: OpenAI
	private baseUrl: string = "https://api.fireworks.ai/inference/v1"

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		this.client = new OpenAI({
			baseURL: this.baseUrl,
			apiKey: this.options.fireworksApiKey,
		})
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()

		if (!this.options.fireworksApiKey) {
			yield {
				type: "text",
				text:
					"ERROR: Fireworks API key is required but was not provided.\n\n" +
					"Please set your API key in the extension settings:\n" +
					"1. Open the KiloCode settings panel\n" +
					"2. Select 'Fireworks' as your provider\n" +
					"3. Enter your API key\n\n" +
					"You can get your API key from: https://fireworks.ai/account/api-keys",
			}
			return
		}

		// Format the messages according to OpenAI format, with special handling for DeepSeek models
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []
		const isDeepSeek = model.id.includes("deepseek")

		if (isDeepSeek) {
			// DeepSeek models handle system prompts differently
			if (systemPrompt.trim() !== "") {
				openAiMessages.push({ role: "system", content: systemPrompt })
			}
			openAiMessages = [...openAiMessages, ...convertToOpenAiMessages(messages)]
		} else {
			// Standard OpenAI format
			openAiMessages = [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
		}

		// Calculate token usage for prompt size limits
		let estimatedTokens = 0
		const contextWindow = model.info.contextWindow || 8191

		try {
			const contentBlocks = openAiMessages.map((msg) => ({
				text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
			}))

			estimatedTokens = await this.countTokens(contentBlocks as any)
		} catch (error) {
			// Silently handle token counting errors
		}

		// Calculate max output tokens based on context window and input size
		const maxOutputTokens = Math.min(model.info.maxTokens || 4096, Math.max(100, contextWindow - estimatedTokens))

		try {
			// Prepare request parameters
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
				model: model.id,
				messages: openAiMessages,
				max_tokens: maxOutputTokens,
				temperature: isDeepSeek ? 0.7 : 0.6, // DeepSeek works better with slightly higher temperature
				top_p: 1,
				presence_penalty: 0,
				frequency_penalty: 0,
				stream: true,
				stream_options: { include_usage: true },
			}

			// Send the request
			const stream = await this.client.chat.completions.create(requestOptions)

			// Process the streaming response
			let contentStarted = false
			let accumulatedText = ""

			for await (const chunk of stream) {
				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					contentStarted = true
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					accumulatedText += delta.content
					yield {
						type: "text",
						text: delta.content,
					}
				}

				// Process usage information if available
				if (chunk.usage) {
					yield {
						type: "usage",
						inputTokens: chunk.usage.prompt_tokens || 0,
						outputTokens: chunk.usage.completion_tokens || 0,
						totalCost: calculateApiCostOpenAI(
							model.info,
							chunk.usage.prompt_tokens || 0,
							chunk.usage.completion_tokens || 0,
						),
					}
				}
			}

			// Handle the case where no content was received
			if (!contentStarted) {
				yield {
					type: "text",
					text: "No content was received from the model. This could be an issue with the API or the model.",
				}
			}
		} catch (error: any) {
			// Other Providers provide these instructions in their JSON errors, but Fireworks doesn't, so we do it here
			if (error.status === 401) {
				yield {
					type: "text",
					text:
						"ERROR: Invalid Fireworks API key.\n\n" +
						"Please check your API key in the extension settings and make sure it is correct.\n" +
						"You can find or create a new API key at: https://fireworks.ai/account/api-keys",
				}
			} else if (error.status === 429) {
				yield {
					type: "text",
					text:
						"ERROR: Rate limit exceeded.\n\n" +
						"You have sent too many requests to the Fireworks API in a short period of time.\n" +
						"Please try again later or consider upgrading your Fireworks AI plan at:\n" +
						"https://fireworks.ai/pricing",
				}
			} else if (error.status === 400) {
				yield {
					type: "text",
					text:
						"ERROR: Bad request to Fireworks API.\n\n" +
						"This might be due to invalid parameters or a prompt that's too large.\n" +
						"Please try again with a shorter prompt or different parameters.",
				}
			} else if (error.status === 403) {
				yield {
					type: "text",
					text:
						"ERROR: Forbidden request to Fireworks API.\n\n" +
						"The model name may be incorrect, or the model does not exist.\n" +
						"This error is also returned to avoid leaking information about model availability.\n",
				}
			} else {
				yield {
					type: "text",
					text:
						`ERROR: ${error.message || "Failed to communicate with Fireworks API"}\n\n` +
						"Please, check https://docs.fireworks.ai/troubleshooting/status_error_codes for more information.",
				}
			}
		}
	}

	getModel(): { id: FireworksModelId; info: ModelInfo } {
		const modelId =
			((this.options.apiModelId || this.options.fireworksModelId) as FireworksModelId) || fireworksDefaultModelId
		return {
			id: modelId,
			info: fireworksModels[modelId] || fireworksModels[fireworksDefaultModelId],
		}
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		return super.countTokens(content)
	}

	async completePrompt(prompt: string): Promise<string> {
		try {
			const model = this.getModel()

			if (!this.options.fireworksApiKey) {
				throw new Error("Fireworks API key is required but was not provided")
			}

			// Special handling for DeepSeek models
			const isDeepSeek = model.id.includes("deepseek")

			// Prepare request parameters
			const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
				model: model.id,
				messages: [{ role: "user", content: prompt }],
				max_tokens: model.info.maxTokens || 4096,
				temperature: isDeepSeek ? 0.7 : 0.6, // DeepSeek works better with slightly higher temperature
				top_p: 1,
				presence_penalty: 0,
				frequency_penalty: 0,
			}

			// Send the request
			const response = await this.client.chat.completions.create(requestOptions)

			return response.choices[0]?.message?.content || ""
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Fireworks completion error: ${error.message}`)
			}
			throw error
		}
	}
}
