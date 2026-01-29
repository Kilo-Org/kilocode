import { FimCreateParamsStreaming } from "./openai-adapters/apis/base"
import {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionCreateParams,
	ChatCompletionMessageParam,
	CompletionCreateParams,
} from "openai/resources/index"

import { ChatMessage, CompletionOptions, TextMessagePart } from ".."

function toChatMessage(message: ChatMessage): ChatCompletionMessageParam {
	if (message.role === "system") {
		return {
			role: "system",
			content: message.content,
		}
	}

	if (message.role === "assistant") {
		return {
			role: "assistant",
			content:
				typeof message.content === "string"
					? message.content || " " // LM Studio (and other providers) don't accept empty content
					: message.content.filter((part) => part.type === "text").map((part) => part as TextMessagePart), // can remove with newer typescript version
		}
	} else {
		if (typeof message.content === "string") {
			return {
				role: "user",
				content: message.content ?? " ", // LM Studio (and other providers) don't accept empty content
			}
		}

		// Extract text from message parts
		return {
			role: "user",
			content: message.content.map((item) => (item as TextMessagePart).text).join("") || " ",
		}
	}
}

export function toChatBody(messages: ChatMessage[], options: CompletionOptions): ChatCompletionCreateParams {
	return {
		messages: messages.map(toChatMessage),
		model: options.model,
		max_tokens: options.maxTokens,
		temperature: options.temperature,
		top_p: options.topP,
		frequency_penalty: options.frequencyPenalty,
		presence_penalty: options.presencePenalty,
		stream: options.stream ?? true,
		stop: options.stop,
	}
}

export function toCompleteBody(prompt: string, options: CompletionOptions): CompletionCreateParams {
	return {
		prompt,
		model: options.model,
		max_tokens: options.maxTokens,
		temperature: options.temperature,
		top_p: options.topP,
		frequency_penalty: options.frequencyPenalty,
		presence_penalty: options.presencePenalty,
		stream: options.stream ?? true,
		stop: options.stop,
	}
}

export function toFimBody(prefix: string, suffix: string, options: CompletionOptions): FimCreateParamsStreaming {
	return {
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
	} as any
}

export function fromChatResponse(response: ChatCompletion): ChatMessage {
	const message = response.choices[0].message

	return {
		role: "assistant",
		content: message.content ?? "",
	}
}

export function fromChatCompletionChunk(chunk: ChatCompletionChunk): ChatMessage | undefined {
	const delta = chunk.choices?.[0]?.delta

	if (delta?.content) {
		return {
			role: "assistant",
			content: delta.content,
		}
	}

	return undefined
}

export type LlmApiRequestType = "chat" | "streamChat" | "streamComplete" | "streamFim" | "rerank"
