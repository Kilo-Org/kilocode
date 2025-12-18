import { z } from "zod"
import { KilocodePayload } from "./CliOutputParser"

/**
 * Schema for parsing JSON content that may contain message/title/buyCreditsUrl fields.
 * Used for payment_required and similar payloads where text field contains JSON.
 */
export const payloadJsonSchema = z.object({
	message: z.string().optional(),
	title: z.string().optional(),
	buyCreditsUrl: z.string().optional(),
})

export type PayloadJson = z.infer<typeof payloadJsonSchema>

/**
 * Extracts raw text from payload, preferring text over content.
 */
export function extractRawText(payload: KilocodePayload | { text?: string; content?: string }): string {
	const text = typeof payload?.text === "string" ? payload.text : undefined
	const content = typeof payload?.content === "string" ? payload.content : undefined
	return text || content || ""
}

/**
 * Attempts to parse JSON from text and validate against schema.
 * Returns undefined if parsing fails or validation fails.
 */
export function tryParsePayloadJson(text: string): PayloadJson | undefined {
	try {
		const result = payloadJsonSchema.safeParse(JSON.parse(text))
		return result.success ? result.data : undefined
	} catch {
		return undefined
	}
}

/**
 * Checks if text contains JSON (has a { character).
 */
function containsJson(text: string): boolean {
	return text.includes("{")
}

export function extractPayloadMessage(payload: KilocodePayload, defaultMessage: string): string {
	const rawText = extractRawText(payload)

	// Try to extract message from JSON, fall back to raw text or default
	return tryParsePayloadJson(rawText)?.message || rawText || defaultMessage
}

export function extractApiReqFailedMessage(payload: KilocodePayload): { message: string; authError: boolean } {
	const rawText = extractRawText(payload)

	// Extract HTTP status code from message. Some errors include a prefix like
	// "Provider error: 401 ..." so we can't rely on the status code being at the beginning.
	// Keep this targeted to avoid matching unrelated 3-digit values (e.g. request ids).
	const statusMatch = rawText.match(/^\s*(\d{3})\b/) ?? rawText.match(/:\s*(\d{3})\b/)
	const authError = statusMatch?.[1] === "401"

	// Use raw text if it's not JSON, otherwise fall back
	let message = rawText && !containsJson(rawText) ? rawText : "API request failed."

	if (!message.trim()) {
		message = "API request failed."
	}

	// Prefix auth errors unless already prefixed
	if (authError && !/^Authentication failed:/i.test(message)) {
		message = `Authentication failed: ${message}`
	}

	return { message, authError }
}
