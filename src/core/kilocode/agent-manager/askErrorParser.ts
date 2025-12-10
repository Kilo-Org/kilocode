import { KilocodePayload } from "./CliOutputParser"

type DebugLogger = (message: string) => void

export function extractPayloadMessage(
	payload: KilocodePayload,
	defaultMessage: string,
	_debugLog?: DebugLogger,
): string {
	const rawText =
		(typeof payload.text === "string" && payload.text) ||
		(typeof payload.content === "string" && payload.content) ||
		""

	// If raw text looks like JSON, avoid showing it and use fallback
	if (rawText.trim().startsWith("{") || rawText.trim().startsWith("[")) {
		return defaultMessage
	}

	return rawText || defaultMessage
}

export function extractApiReqFailedMessage(
	payload: KilocodePayload,
	_debugLog?: DebugLogger,
): { message: string; authError: boolean } {
	const rawText =
		(typeof payload.text === "string" && payload.text) ||
		(typeof payload.content === "string" && payload.content) ||
		""

	const statusMatch = rawText.match(/^\s*(\d{3})\b/)
	const statusCode = statusMatch ? Number(statusMatch[1]) : undefined
	const authError = statusCode === 401

	const looksJson = rawText.trim().startsWith("{") || rawText.includes("{")
	let message = rawText && !looksJson ? rawText : "API request failed."

	if (!message.trim()) {
		message = "API request failed."
	}

	if (authError && !/^Authentication failed:/i.test(message)) {
		message = `Authentication failed: ${message}`
	}

	return { message, authError }
}
