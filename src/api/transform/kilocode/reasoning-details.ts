// Originally from Cline: https://github.com/cline/cline/blob/ba98b44504d81ea2a261a7a18bf894b4893579c3/src/core/api/transform/openai-format.ts#L181

import { ProviderName } from "@roo-code/types"
import { ApiMessage } from "../../../core/task-persistence"

// Type for OpenRouter's reasoning detail elements
// https://openrouter.ai/docs/use-cases/reasoning-tokens#streaming-response
export type ReasoningDetail = {
	// https://openrouter.ai/docs/use-cases/reasoning-tokens#reasoning-detail-types
	type: string // "reasoning.summary" | "reasoning.encrypted" | "reasoning.text"
	text?: string
	data?: string // Encrypted reasoning data
	signature?: string | null
	id?: string | null // Unique identifier for the reasoning detail
	/*
	 The format of the reasoning detail, with possible values:
	 	"unknown" - Format is not specified
		"openai-responses-v1" - OpenAI responses format version 1
		"anthropic-claude-v1" - Anthropic Claude format version 1 (default)
	 */
	format: string //"unknown" | "openai-responses-v1" | "anthropic-claude-v1" | "xai-responses-v1"
	index?: number // Sequential index of the reasoning detail
}

// Helper function to convert reasoning_details array to the format OpenRouter API expects
// Takes an array of reasoning detail objects and consolidates them by index
export function consolidateReasoningDetails(reasoningDetails: ReasoningDetail[]): ReasoningDetail[] {
	if (!reasoningDetails || reasoningDetails.length === 0) {
		return []
	}

	// Group by index
	const groupedByIndex = new Map<number, ReasoningDetail[]>()

	for (const detail of reasoningDetails) {
		const index = detail.index ?? 0
		if (!groupedByIndex.has(index)) {
			groupedByIndex.set(index, [])
		}
		groupedByIndex.get(index)!.push(detail)
	}

	// Consolidate each group
	const consolidated: ReasoningDetail[] = []

	for (const [index, details] of groupedByIndex.entries()) {
		// Concatenate all text parts
		let concatenatedText = ""
		let signature: string | undefined
		let id: string | undefined
		let format = "unknown"
		let type = "reasoning.text"

		for (const detail of details) {
			if (detail.text) {
				concatenatedText += detail.text
			}
			// Keep the signature from the last item that has one
			if (detail.signature) {
				signature = detail.signature
			}
			// Keep the id from the last item that has one
			if (detail.id) {
				id = detail.id
			}
			// Keep format and type from any item (they should all be the same)
			if (detail.format) {
				format = detail.format
			}
			if (detail.type) {
				type = detail.type
			}
		}

		// Create consolidated entry for text
		if (concatenatedText) {
			const consolidatedEntry: ReasoningDetail = {
				type: type,
				text: concatenatedText,
				signature: signature,
				id: id,
				format: format,
				index: index,
			}
			consolidated.push(consolidatedEntry)
		}

		// For encrypted chunks (data), only keep the last one
		let lastDataEntry: ReasoningDetail | undefined
		for (const detail of details) {
			if (detail.data) {
				lastDataEntry = {
					type: detail.type,
					data: detail.data,
					signature: detail.signature,
					id: detail.id,
					format: detail.format,
					index: index,
				}
			}
		}
		if (lastDataEntry) {
			consolidated.push(lastDataEntry)
		}
	}

	return consolidated
}

const supportsReasoningDetails = ["openrouter", "kilocode"] satisfies ProviderName[] as ProviderName[]

export function maybeRemoveReasoningDetails_kilocode(
	messages: ApiMessage[],
	provider: ProviderName | undefined,
): ApiMessage[] {
	if (provider && supportsReasoningDetails.includes(provider)) {
		return messages
	}
	return messages
		.map((message) => {
			let { content } = message
			if (Array.isArray(content)) {
				content = content
					.map((block) => ("reasoning_details" in block ? { ...block, reasoning_details: undefined } : block))
					.filter((block) => block.type !== "text" || !!block.text)
			}
			return { ...message, content }
		})
		.filter((message) => !Array.isArray(message.content) || message.content.length > 0)
}
