import { ChatCompletionCreateParams, ChatCompletionMessageParam } from "openai/resources/index"

import { streamSse } from "../../fetch/stream.js"
import { ChatMessage, CompletionOptions, LLMOptions } from "../../index.js"
import { renderChatMessage } from "../../util/messageContent.js"
import { BaseLLM } from "../index.js"
import { fromChatCompletionChunk, LlmApiRequestType, toChatBody } from "../openaiTypeConverters.js"

const NON_CHAT_MODELS = [
	"text-davinci-002",
	"text-davinci-003",
	"code-davinci-002",
	"text-ada-001",
	"text-babbage-001",
	"text-curie-001",
	"davinci",
	"curie",
	"babbage",
	"ada",
]

function isChatOnlyModel(model: string): boolean {
	// gpt and o-series models
	return model.startsWith("gpt") || model.startsWith("o")
}

const formatMessageForO1OrGpt5 = (messages: ChatCompletionMessageParam[]) => {
	return messages?.map((message: any) => {
		if (message?.role === "system") {
			return {
				...message,
				role: "developer",
			}
		}

		return message
	})
}

export class OpenAI extends BaseLLM {
	public useLegacyCompletionsEndpoint: boolean | undefined = undefined

	constructor(options: LLMOptions) {
		super({
			apiBase: "https://api.openai.com/v1/",
			...options,
		})
		this.useLegacyCompletionsEndpoint = options.useLegacyCompletionsEndpoint
		// Azure apiVersion removed from narrowed LLMOptions; not used
	}

	static override providerName = "openai"

	protected override useOpenAIAdapterFor: (LlmApiRequestType | "*")[] = ["chat", "rerank", "streamChat", "streamFim"]

	protected _convertModelName(model: string): string {
		return model
	}

	public isOSeriesOrGpt5Model(model?: string): boolean {
		return !!model && (!!model.match(/^o[0-9]+/) || model.includes("gpt-5"))
	}

	protected extraBodyProperties(): Record<string, any> {
		return {}
	}

	protected getMaxStopWords(): number {
		const url = new URL(this.apiBase!)

		if (this.maxStopWords !== undefined) {
			return this.maxStopWords
		} else if (url.host === "api.deepseek.com") {
			return 16
		} else if (url.port === "1337" || url.host === "api.openai.com" || url.host === "api.groq.com") {
			return 4
		} else {
			return Infinity
		}
	}

	protected _convertArgs(options: CompletionOptions, messages: ChatMessage[]): ChatCompletionCreateParams {
		const finalOptions = toChatBody(messages, options)

		finalOptions.stop = options.stop?.slice(0, this.getMaxStopWords())

		// OpenAI o1-preview and o1-mini or o3-mini:
		if (this.isOSeriesOrGpt5Model(options.model)) {
			// a) use max_completion_tokens instead of max_tokens
			finalOptions.max_completion_tokens = options.maxTokens
			finalOptions.max_tokens = undefined

			// b) don't support system message
			finalOptions.messages = formatMessageForO1OrGpt5(finalOptions.messages)
		}

		if (options.model === "o1") {
			finalOptions.stream = false
		}

		return finalOptions
	}

	protected _getHeaders() {
		return {
			"Content-Type": "application/json",
			...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` }),
			"api-key": this.apiKey ?? "", // For Azure
		}
	}

	protected override async _complete(
		prompt: string,
		signal: AbortSignal,
		options: CompletionOptions,
	): Promise<string> {
		let completion = ""
		for await (const chunk of this._streamChat([{ role: "user", content: prompt }], signal, options)) {
			completion += chunk.content
		}

		return completion
	}

	protected _getEndpoint(endpoint: "chat/completions" | "completions" | "models") {
		if (!this.apiBase) {
			throw new Error("No API base URL provided. Please set the 'apiBase' option in config.json")
		}
		return new URL(endpoint, this.apiBase)
	}

	protected override async *_streamComplete(
		prompt: string,
		signal: AbortSignal,
		options: CompletionOptions,
	): AsyncGenerator<string> {
		for await (const chunk of this._streamChat([{ role: "user", content: prompt }], signal, options)) {
			yield renderChatMessage(chunk)
		}
	}

	protected override modifyChatBody(body: ChatCompletionCreateParams): ChatCompletionCreateParams {
		body.stop = body.stop?.slice(0, this.getMaxStopWords())

		// OpenAI o1-preview and o1-mini or o3-mini:
		if (this.isOSeriesOrGpt5Model(body.model)) {
			// a) use max_completion_tokens instead of max_tokens
			body.max_completion_tokens = body.max_tokens
			body.max_tokens = undefined

			// b) don't support system message
			body.messages = formatMessageForO1OrGpt5(body.messages)
		}

		if (body.model === "o1") {
			// o1 doesn't support streaming
			body.stream = false
		}

		return body
	}

	protected async *_legacystreamComplete(
		prompt: string,
		signal: AbortSignal,
		options: CompletionOptions,
	): AsyncGenerator<string> {
		const args: any = this._convertArgs(options, [])
		args.prompt = prompt
		args.messages = undefined

		const response = await fetch(this._getEndpoint("completions"), {
			method: "POST",
			headers: this._getHeaders(),
			body: JSON.stringify({
				...args,
				stream: true,
				...this.extraBodyProperties(),
			}),
			signal,
		})

		for await (const value of streamSse(response)) {
			if (value.choices?.[0]?.text && value.finish_reason !== "eos") {
				yield value.choices[0].text
			}
		}
	}

	protected override async *_streamChat(
		messages: ChatMessage[],
		signal: AbortSignal,
		options: CompletionOptions,
	): AsyncGenerator<ChatMessage> {
		if (
			!isChatOnlyModel(options.model) &&
			this.supportsCompletions() &&
			(NON_CHAT_MODELS.includes(options.model) || this.useLegacyCompletionsEndpoint || options.raw)
		) {
			for await (const content of this._legacystreamComplete(
				renderChatMessage(messages[messages.length - 1]),
				signal,
				options,
			)) {
				yield {
					role: "assistant",
					content,
				}
			}
			return
		}

		const body = this._convertArgs(options, messages)

		const response = await fetch(this._getEndpoint("chat/completions"), {
			method: "POST",
			headers: this._getHeaders(),
			body: JSON.stringify({
				...body,
				...this.extraBodyProperties(),
			}),
			signal,
		})

		// Handle non-streaming response
		if (body.stream === false) {
			if (response.status === 499) {
				return // Aborted by user
			}
			const data = await response.json()
			yield data.choices[0].message
			return
		}

		for await (const value of streamSse(response)) {
			const chunk = fromChatCompletionChunk(value)
			if (chunk) {
				yield chunk
			}
		}
	}

	protected override async *_streamFim(
		prefix: string,
		suffix: string,
		signal: AbortSignal,
		options: CompletionOptions,
	): AsyncGenerator<string> {
		const endpoint = new URL("fim/completions", this.apiBase)
		const resp = await fetch(endpoint, {
			method: "POST",
			body: JSON.stringify({
				model: options.model,
				prompt: prefix,
				suffix,
				max_tokens: options.maxTokens,
				temperature: options.temperature,
				top_p: options.topP,
				frequency_penalty: options.frequencyPenalty,
				presence_penalty: options.presencePenalty,
				stop: options.stop,
				stream: true,
				...this.extraBodyProperties(),
			}),
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				"x-api-key": this.apiKey ?? "",
				Authorization: `Bearer ${this.apiKey}`,
			},
			signal,
		})
		for await (const chunk of streamSse(resp)) {
			yield chunk.choices[0].delta.content
		}
	}
}
