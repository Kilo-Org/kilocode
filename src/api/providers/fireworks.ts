import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
// import { withRetry } from "../retry"
import { ApiHandler } from "../"
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
import { convertToR1Format } from "../transform/r1-format"
import { BaseProvider } from "./base-provider"

interface FireworksCompletionParams {
	model: string
	messages: OpenAI.Chat.ChatCompletionMessageParam[]
	max_tokens: number
	temperature: number
	top_p: number
	top_k: number
	presence_penalty: number
	frequency_penalty: number
	stream?: boolean
}

export class FireworksHandler extends BaseProvider implements ApiHandler {
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
		console.log("Fireworks handler initialized with model:", fireworksDefaultModelId)
	}

	private async *yieldUsage(info: ModelInfo, usage: OpenAI.Completions.CompletionUsage | undefined): ApiStream {
		const inputTokens = usage?.prompt_tokens || 0
		const outputTokens = usage?.completion_tokens || 0
		const totalCost = calculateApiCostOpenAI(info, inputTokens, outputTokens)
		yield {
			type: "usage",
			inputTokens: inputTokens,
			outputTokens: outputTokens,
			totalCost: totalCost,
		}
	}

	// Custom method to make direct fetch request to Fireworks API
	private async fireworksFetch(params: FireworksCompletionParams, apiKey: string): Promise<Response> {
		if (!apiKey) {
			throw new Error("Fireworks API key is required but was not provided")
		}

		console.log(
			`Making request to Fireworks API with key: ${apiKey.substring(0, 3)}...${apiKey.substring(apiKey.length - 3)}`,
		)

		// Simple retry logic since we're not using the decorator
		const maxRetries = 2
		let lastError: Error | null = null

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				// If this isn't the first attempt, log and wait before retrying
				if (attempt > 0) {
					console.log(`Retry attempt ${attempt}/${maxRetries} for Fireworks API request`)
					await new Promise((resolve) => setTimeout(resolve, 1000 * attempt)) // Exponential backoff
				}

				const response = await fetch(`${this.baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						Accept: "application/json",
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(params),
				})

				// Check for rate limiting or server errors that should trigger a retry
				if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
					if (attempt < maxRetries) {
						console.warn(`Received status ${response.status}, will retry...`)
						lastError = new Error(`HTTP error ${response.status}`)
						continue // Retry
					}
				}

				return response
			} catch (error: any) {
				console.error(`Attempt ${attempt + 1} failed:`, error.message)
				lastError = error

				// Only continue retrying if we haven't exceeded max retries
				if (attempt >= maxRetries) {
					break
				}
			}
		}

		// If we've exhausted all retries, throw the last error
		throw lastError || new Error("Failed to connect to Fireworks API after multiple attempts")
	}

	// Method to parse SSE stream from Fireworks API
	private async *parseFireworksSSE(response: Response): AsyncGenerator<any> {
		if (!response.ok) {
			let errorText = ""
			try {
				// Try to get the error details
				const errorJson = await response.json()
				errorText = JSON.stringify(errorJson)
				console.error("Fireworks API error details:", errorJson)
			} catch (e) {
				// If we can't parse JSON, get the text
				errorText = await response.text().catch(() => "Unknown error")
				console.error("Fireworks API error text:", errorText)
			}
			console.error("Response status:", response.status)
			throw new Error(`Fireworks API error (${response.status}): ${errorText}`)
		}

		if (!response.body) {
			throw new Error("Response body is null")
		}

		// Simpler streaming approach
		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) {
					console.log("Stream done")
					break
				}

				// Decode the chunk and add to buffer
				buffer += decoder.decode(value, { stream: true })

				// Process complete messages in buffer
				const lines = buffer.split("\n")
				buffer = lines.pop() || "" // Keep the last (potentially incomplete) line

				for (const line of lines) {
					const trimmedLine = line.trim()
					if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue

					const data = trimmedLine.slice(5).trim()
					if (data === "[DONE]") return

					try {
						const parsed = JSON.parse(data)
						yield parsed
					} catch (e) {
						console.warn("Failed to parse line as JSON:", data, e)
					}
				}
			}

			// Process any remaining data in buffer
			if (buffer.trim()) {
				const lines = buffer.split("\n")
				for (const line of lines) {
					const trimmedLine = line.trim()
					if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue

					const data = trimmedLine.slice(5).trim()
					if (data === "[DONE]") return

					try {
						const parsed = JSON.parse(data)
						yield parsed
					} catch (e) {
						console.warn("Failed to parse line as JSON:", data, e)
					}
				}
			}
		} catch (error) {
			console.error("Error reading from stream:", error)
			throw error
		} finally {
			// Make sure we clean up
			try {
				await reader.cancel()
			} catch (e) {
				// Ignore errors during cleanup
			}
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()

		console.log("Fireworks model ID:", model.id)
		console.log("Using key:", this.options.fireworksApiKey ? "API key provided" : "No API key provided")

		if (!this.options.fireworksApiKey) {
			yield {
				type: "text",
				text: "ERROR: Fireworks API key is required but was not provided. Please check your settings.",
			}
			return
		}

		// Convert to OpenAI format with special handling for DeepSeek models
		let openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = []

		// DeepSeek model may handle system prompts differently
		if (model.id.includes("deepseek")) {
			console.log("Using DeepSeek-specific message formatting")

			// Only add system prompt if it's not empty
			if (systemPrompt.trim() !== "") {
				openAiMessages.push({ role: "system", content: systemPrompt })
			}

			// Convert Anthropic messages to OpenAI format carefully for DeepSeek
			openAiMessages = [...openAiMessages, ...convertToOpenAiMessages(messages)]
		} else {
			// Standard OpenAI format
			openAiMessages = [{ role: "system", content: systemPrompt }, ...convertToOpenAiMessages(messages)]
		}

		// Log the message structure (excluding actual content for privacy)
		console.log(
			"Message structure:",
			openAiMessages.map((m) => ({ role: m.role, contentType: typeof m.content })),
		)

		const totalChars = openAiMessages.reduce((acc, msg) => {
			return acc + (typeof msg.content === "string" ? msg.content.length : 0)
		}, 0)

		// If estimated tokens exceed 75% of context window, apply truncation
		const contextWindow = model.info.contextWindow || 8191
		const estimatedTokens = Math.ceil(totalChars / 4)
		const maxOutputTokens = Math.min(model.info.maxTokens || 4096, Math.floor(contextWindow / 4))

		console.log(
			`Estimated tokens: ${estimatedTokens}, Context window: ${contextWindow}, Max output tokens: ${maxOutputTokens}`,
		)

		if (estimatedTokens > contextWindow * 0.75) {
			console.warn(
				`Warning: Prompt may be too large. Estimated ${estimatedTokens} tokens with context window of ${contextWindow}`,
			)
		}

		try {
			// Use our custom fetch method instead of the OpenAI client
			const params: FireworksCompletionParams = {
				model: model.id,
				messages: openAiMessages,
				max_tokens: maxOutputTokens,
				temperature: 0.6,
				top_p: 1,
				top_k: 40,
				presence_penalty: 0,
				frequency_penalty: 0,
				stream: true,
			}

			// Special handling for DeepSeek models
			if (model.id.includes("deepseek")) {
				// DeepSeek models might perform better with these settings
				params.temperature = 0.7 // Slightly more creative
				params.top_k = 50 // More diverse token selection
			}

			console.log("Sending request to Fireworks API with params:", { ...params, messages: "REDACTED" })

			// First yield a message indicating we're connecting
			yield {
				type: "text",
				text: "Connecting to Fireworks API...\n",
			}

			const response = await this.fireworksFetch(params, this.options.fireworksApiKey || "")
			console.log("Received response from Fireworks API, status:", response.status)

			// Yield a message indicating that we received a response
			yield {
				type: "text",
				text: "Connected to Fireworks API. Waiting for response...\n",
			}

			// Use our custom stream parser
			let contentStarted = false
			let streamError = false

			try {
				for await (const chunk of this.parseFireworksSSE(response)) {
					console.log("Received chunk:", JSON.stringify(chunk).substring(0, 100) + "...")
					const content = chunk.choices?.[0]?.delta?.content
					if (content) {
						contentStarted = true
						yield {
							type: "text",
							text: content,
						}
					}
				}
			} catch (streamErr: any) {
				streamError = true
				console.error("Error while processing stream:", streamErr)
				yield {
					type: "text",
					text: `\n\nERROR: Failed to process response stream: ${streamErr.message}\n`,
				}
			}

			if (!contentStarted && !streamError) {
				yield {
					type: "text",
					text: "No content was received from the model. This could be an issue with the API or the model.",
				}
			}

			yield* this.yieldUsage(model.info, {
				prompt_tokens: estimatedTokens,
				completion_tokens: Math.floor(estimatedTokens / 3), // Rough estimate
				total_tokens: estimatedTokens + Math.floor(estimatedTokens / 3),
			})
		} catch (error: any) {
			console.error("Fireworks API error:", error)

			yield {
				type: "text",
				text: `ERROR: ${error.message || "Failed to communicate with Fireworks API. Please check your API key and try again."}`,
			}
		}
	}

	getModel(): { id: FireworksModelId; info: ModelInfo } {
		console.log("Using Fireworks model:", fireworksDefaultModelId)
		return {
			id: fireworksDefaultModelId,
			info: fireworksModels[fireworksDefaultModelId],
		}
	}

	override async countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		// Use the base provider's implementation which uses tiktoken
		return super.countTokens(content)
	}
}
