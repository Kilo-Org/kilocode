import { OpenAI } from "openai/index"
import {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionContentPartImage,
	ChatCompletionCreateParams,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionCreateParamsStreaming,
	Completion,
	CompletionCreateParamsNonStreaming,
	CompletionCreateParamsStreaming,
	CompletionUsage,
	Model,
} from "openai/resources/index"

import { streamResponse } from "../../../fetch/stream.js"
import { GeminiConfig } from "../types.js"
import { chatChunk, usageChatChunk } from "../util.js"
import {
	convertOpenAIToolToGeminiFunction,
	GeminiChatContent,
	GeminiChatContentPart,
	GeminiToolFunctionDeclaration,
} from "../util/gemini-types.js"
import { BaseLlmApi, CreateRerankResponse, FimCreateParamsStreaming, RerankCreateParams } from "./base.js"

type UsageInfo = Pick<CompletionUsage, "total_tokens" | "completion_tokens" | "prompt_tokens">

export class GeminiApi implements BaseLlmApi {
	apiBase: string = "https://generativelanguage.googleapis.com/v1beta/"

	constructor(protected config: GeminiConfig) {
		this.apiBase = config.apiBase ?? this.apiBase
	}

	private _oaiPartToGeminiPart(
		part:
			| OpenAI.Chat.Completions.ChatCompletionContentPart
			| OpenAI.Chat.Completions.ChatCompletionContentPartRefusal,
	): GeminiChatContentPart {
		switch (part.type) {
			case "refusal":
				return {
					text: part.refusal,
				}
			case "text":
				return {
					text: part.text,
				}
			case "input_audio":
				throw new Error("Unsupported part type: input_audio")
			case "image_url":
			default:
				return {
					inlineData: {
						mimeType: "image/jpeg",
						data: (part as ChatCompletionContentPartImage).image_url?.url.split(",")[1],
					},
				}
		}
	}

	public _convertBody(oaiBody: ChatCompletionCreateParams, url: string) {
		const generationConfig: any = {}

		if (oaiBody.top_p) {
			generationConfig.topP = oaiBody.top_p
		}
		if (oaiBody.temperature !== undefined && oaiBody.temperature !== null) {
			generationConfig.temperature = oaiBody.temperature
		}
		if (oaiBody.max_tokens) {
			generationConfig.maxOutputTokens = oaiBody.max_tokens
		}
		if (oaiBody.stop) {
			const stop = Array.isArray(oaiBody.stop) ? oaiBody.stop : [oaiBody.stop]
			generationConfig.stopSequences = stop.filter((x) => x.trim() !== "")
		}

		const isV1API = url.includes("/v1/")

		const contents: (GeminiChatContent | null)[] = oaiBody.messages
			.map((msg) => {
				if (msg.role === "system" && !isV1API) {
					return null // Don't include system message in contents
				}

				if (msg.role === "assistant") {
					return {
						role: "model" as const,
						parts: [
							{
								text:
									typeof msg.content === "string"
										? msg.content
										: (msg.content ?? [])
												.filter((part) => part.type === "text")
												.map((part) => part.text)
												.join(""),
							},
						],
					}
				}

				if (msg.role === "user") {
					return {
						role: "user" as const,
						parts: [
							{
								text:
									typeof msg.content === "string"
										? msg.content
										: msg.content
												.filter((part) => part.type === "text")
												.map((part) => part.text)
												.join(""),
							},
						],
					}
				}

				if (!msg.content) {
					return null
				}

				return {
					role: "user" as const,
					parts:
						typeof msg.content === "string"
							? [{ text: msg.content }]
							: msg.content.map(this._oaiPartToGeminiPart),
				}
			})
			.filter((c) => c !== null)

		const sysMsg = oaiBody.messages.find((msg) => msg.role === "system")
		const finalBody: any = {
			generationConfig,
			contents,
			// if there is a system message, reformat it for Gemini API
			...(sysMsg &&
				!isV1API && {
					systemInstruction: { parts: [{ text: sysMsg.content }] },
				}),
		}

		if (!isV1API) {
			// Convert and add tools if present
			if (oaiBody.tools?.length) {
				// Choosing to map all tools to the functionDeclarations of one tool
				// Rather than map each tool to its own tool + functionDeclaration
				// Same difference
				const functions: GeminiToolFunctionDeclaration[] = []
				oaiBody.tools.forEach((tool) => {
					try {
						functions.push(convertOpenAIToolToGeminiFunction(tool))
					} catch {
						console.warn(
							`Failed to convert tool to gemini function definition. Skipping: ${JSON.stringify(tool, null, 2)}`,
						)
					}
				})

				if (functions.length) {
					finalBody.tools = [
						{
							functionDeclarations: functions,
						},
					]
				}
			}
		}

		return finalBody
	}

	async chatCompletionNonStream(
		body: ChatCompletionCreateParamsNonStreaming,
		signal: AbortSignal,
	): Promise<ChatCompletion> {
		let completion = ""
		let usage: UsageInfo | undefined = undefined
		for await (const chunk of this.chatCompletionStream(
			{
				...body,
				stream: true,
			},
			signal,
		)) {
			if (chunk.choices.length > 0) {
				completion += chunk.choices[0].delta.content || ""
			}
			if (chunk.usage) {
				usage = chunk.usage
			}
		}
		return {
			id: "",
			object: "chat.completion",
			model: body.model,
			created: Date.now(),
			choices: [
				{
					index: 0,
					logprobs: null,
					finish_reason: "stop",
					message: {
						role: "assistant",
						content: completion,
						refusal: null,
					},
				},
			],
			usage,
		}
	}

	async *handleStreamResponse(response: Response, model: string) {
		let buffer = ""
		let usage: UsageInfo | undefined = undefined
		for await (const chunk of streamResponse(response)) {
			buffer += chunk
			if (buffer.startsWith("[")) {
				buffer = buffer.slice(1)
			}
			if (buffer.endsWith("]")) {
				buffer = buffer.slice(0, -1)
			}
			if (buffer.startsWith(",")) {
				buffer = buffer.slice(1)
			}

			const parts = buffer.split("\n,")

			let foundIncomplete = false
			for (let i = 0; i < parts.length; i++) {
				const part = parts[i]
				let data
				try {
					data = JSON.parse(part)
				} catch {
					foundIncomplete = true
					continue // yo!
				}
				if (data.error) {
					throw new Error(data.error.message)
				}

				// Check for usage metadata
				if (data.usageMetadata) {
					usage = {
						prompt_tokens: data.usageMetadata.promptTokenCount || 0,
						completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
						total_tokens: data.usageMetadata.totalTokenCount || 0,
					}
				}

				// In case of max tokens reached, gemini will sometimes return content with no parts, even though that doesn't match the API spec
				const contentParts = data?.candidates?.[0]?.content?.parts
				if (contentParts) {
					for (const part of contentParts) {
						if ("text" in part) {
							yield chatChunk({
								content: part.text,
								model,
							})
						}
					}
				} else {
					console.warn("Unexpected response format:", data)
				}
			}
			if (foundIncomplete) {
				buffer = parts[parts.length - 1]
			} else {
				buffer = ""
			}
		}

		// Emit usage at the end if we have it
		if (usage) {
			yield usageChatChunk({
				model,
				usage,
			})
		}
	}

	async *chatCompletionStream(
		body: ChatCompletionCreateParamsStreaming,
		signal: AbortSignal,
	): AsyncGenerator<ChatCompletionChunk> {
		const apiURL = new URL(
			`models/${body.model}:streamGenerateContent?key=${this.config.apiKey}`,
			this.apiBase,
		).toString()
		const convertedBody = this._convertBody(body, apiURL)
		const resp = await fetch(apiURL, {
			method: "POST",
			body: JSON.stringify(convertedBody),
			signal,
		})
		yield* this.handleStreamResponse(resp, body.model)
	}
	completionNonStream(_body: CompletionCreateParamsNonStreaming): Promise<Completion> {
		throw new Error("Method not implemented.")
	}
	completionStream(_body: CompletionCreateParamsStreaming): AsyncGenerator<Completion> {
		throw new Error("Method not implemented.")
	}
	fimStream(_body: FimCreateParamsStreaming): AsyncGenerator<ChatCompletionChunk> {
		throw new Error("Method not implemented.")
	}
	async rerank(_body: RerankCreateParams): Promise<CreateRerankResponse> {
		throw new Error("Method not implemented.")
	}

	list(): Promise<Model[]> {
		throw new Error("Method not implemented.")
	}
}
