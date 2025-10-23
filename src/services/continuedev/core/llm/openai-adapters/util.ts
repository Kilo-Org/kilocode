import { ChatCompletionChunk, CompletionUsage } from "openai/resources/index"

import { ChatCompletion } from "openai/resources/index.js"
import { CreateRerankResponse } from "./apis/base.js"

export function chatChunk(options: {
	content: string | null | undefined
	model: string
	finish_reason?: ChatCompletionChunk.Choice["finish_reason"]
	id?: string | null
	usage?: CompletionUsage
}): ChatCompletionChunk {
	return {
		choices: [
			{
				delta: {
					content: options.content,
					role: "assistant",
				},
				finish_reason: options.finish_reason ?? "stop",
				index: 0,
				logprobs: null,
			},
		],
		usage: options.usage,
		created: Date.now(),
		id: options.id ?? "",
		model: options.model,
		object: "chat.completion.chunk",
	}
}

export function usageChatChunk(options: {
	model: string
	id?: string | null
	usage?: CompletionUsage
}): ChatCompletionChunk {
	return {
		choices: [],
		usage: options.usage,
		created: Date.now(),
		id: options.id ?? "",
		model: options.model,
		object: "chat.completion.chunk",
	}
}

export function chatCompletion(options: {
	content: string | null | undefined
	model: string
	finish_reason?: ChatCompletion.Choice["finish_reason"]
	id?: string | null
	usage?: CompletionUsage
	index?: number | null
}): ChatCompletion {
	return {
		choices: [
			{
				finish_reason: options.finish_reason ?? "stop",
				index: options.index ?? 0,
				logprobs: null,
				message: {
					content: options.content ?? null,
					role: "assistant",
					refusal: null,
				},
			},
		],
		usage: options.usage,
		created: Date.now(),
		id: options.id ?? "",
		model: options.model,
		object: "chat.completion",
	}
}

export function rerank(options: {
	model: string
	data: number[]
	usage?: CreateRerankResponse["usage"]
}): CreateRerankResponse {
	return {
		data: options.data.map((score, index) => ({
			index,
			relevance_score: score,
		})),
		model: options.model,
		object: "list" as const,
		usage: options.usage ?? {
			total_tokens: 0,
		},
	}
}
