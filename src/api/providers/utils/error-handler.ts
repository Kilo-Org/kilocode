/**
 * General error handler for API provider errors
 * Transforms technical errors into user-friendly messages while preserving metadata
 *
 * This utility ensures consistent error handling across all API providers:
 * - Preserves HTTP status codes for UI-aware error display
 * - Maintains error details for retry logic (e.g., RetryInfo for 429 errors)
 * - Provides consistent error message formatting
 * - Enables telemetry and debugging with complete error context
 */

import i18n from "../../../i18n/setup"

// kilocode_change start
const NO_OUTPUT_GENERATED_MESSAGE = "No output generated. Check the stream for errors."

type ExtractedErrorPayload = {
	message?: string
	errorDetails?: unknown
	status?: number
}

function safeJsonParse(value: string): unknown {
	try {
		return JSON.parse(value)
	} catch {
		return undefined
	}
}

function getFirstNonEmptyString(values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim()
		}
	}
	return undefined
}

function extractErrorPayload(payload: unknown): ExtractedErrorPayload {
	if (payload === null || payload === undefined) {
		return {}
	}

	let normalizedPayload: unknown = payload
	if (typeof normalizedPayload === "string") {
		const parsed = safeJsonParse(normalizedPayload)
		if (parsed === undefined) {
			return { message: normalizedPayload.trim() || undefined }
		}
		normalizedPayload = parsed
	}

	if (typeof normalizedPayload !== "object" || normalizedPayload === null) {
		return {}
	}

	const root = normalizedPayload as Record<string, unknown>
	const nestedError =
		typeof root.error === "object" && root.error !== null ? (root.error as Record<string, unknown>) : undefined

	const message = getFirstNonEmptyString([
		nestedError?.message,
		root.message,
		root.detail,
		root.error_description,
		typeof root.error === "string" ? root.error : undefined,
	])

	const rawStatus = root.status ?? root.statusCode ?? nestedError?.status ?? nestedError?.statusCode
	const status = typeof rawStatus === "number" ? rawStatus : undefined

	return {
		message,
		errorDetails: nestedError?.details ?? root.errorDetails ?? root.details,
		status,
	}
}

function resolveErrorStatus(error: any, fallbackStatus?: number): number | undefined {
	if (typeof error?.status === "number") {
		return error.status
	}
	if (typeof error?.statusCode === "number") {
		return error.statusCode
	}
	if (typeof error?.$metadata?.httpStatusCode === "number") {
		return error.$metadata.httpStatusCode
	}
	return fallbackStatus
}
// kilocode_change end

/**
 * Handles API provider errors and transforms them into user-friendly messages
 * while preserving important metadata for retry logic and UI display.
 *
 * @param error - The error to handle
 * @param providerName - The name of the provider for context in error messages
 * @param options - Optional configuration for error handling
 * @returns A wrapped Error with preserved metadata (status, errorDetails, code)
 *
 * @example
 * // Basic usage
 * try {
 *   await apiClient.createMessage(...)
 * } catch (error) {
 *   throw handleProviderError(error, "OpenAI")
 * }
 *
 * @example
 * // With custom message prefix
 * catch (error) {
 *   throw handleProviderError(error, "Anthropic", { messagePrefix: "streaming" })
 * }
 */
export function handleProviderError(
	error: unknown,
	providerName: string,
	options?: {
		/** Custom message prefix (default: "completion") */
		messagePrefix?: string
		/** Custom message transformer */
		messageTransformer?: (msg: string) => string
	},
): Error {
	const messagePrefix = options?.messagePrefix || "completion"

	if (error instanceof Error) {
		const anyErr = error as any
		// kilocode_change start
		const metadataRaw =
			typeof anyErr?.error?.metadata?.raw === "string" && anyErr.error.metadata.raw.trim().length > 0
				? anyErr.error.metadata.raw
				: undefined
		const responsePayload = extractErrorPayload(anyErr?.responseBody ?? anyErr?.data)
		const nestedPayload = extractErrorPayload(anyErr?.cause)

		const nestedMessage = responsePayload.message ?? nestedPayload.message
		let msg = metadataRaw || nestedMessage || error.message || ""

		// AI SDK can emit generic "No output generated" while nested payload has the real provider failure.
		if (msg.includes(NO_OUTPUT_GENERATED_MESSAGE) && nestedMessage) {
			msg = nestedMessage
		}

		const status = resolveErrorStatus(anyErr, responsePayload.status ?? nestedPayload.status)
		const errorDetails = anyErr.errorDetails ?? responsePayload.errorDetails ?? nestedPayload.errorDetails
		// kilocode_change end

		// Log the original error details for debugging
		console.error(`[${providerName}] API error:`, {
			message: msg,
			name: error.name,
			stack: error.stack,
			// kilocode_change
			status,
		})

		let wrapped: Error

		// Special case: Invalid character/ByteString conversion error in API key
		// This is specific to OpenAI-compatible SDKs
		if (msg.includes("Cannot convert argument to a ByteString")) {
			wrapped = new Error(i18n.t("common:errors.api.invalidKeyInvalidChars"))
		} else {
			// Apply custom transformer if provided, otherwise use default format
			const finalMessage = options?.messageTransformer
				? options.messageTransformer(msg)
				: `${providerName} ${messagePrefix} error: ${msg}`
			wrapped = new Error(finalMessage)
		}

		// Preserve HTTP status and structured details for retry/backoff + UI
		// These fields are used by Task.backoffAndAnnounce() and ChatRow/ErrorRow
		// to provide status-aware error messages and handling
		// kilocode_change start
		if (status !== undefined) {
			;(wrapped as any).status = status
		}
		if (errorDetails !== undefined) {
			;(wrapped as any).errorDetails = errorDetails
		}
		// kilocode_change end
		if (anyErr.code !== undefined) {
			;(wrapped as any).code = anyErr.code
		}
		// Preserve AWS-specific metadata if present (for Bedrock)
		if (anyErr.$metadata !== undefined) {
			;(wrapped as any).$metadata = anyErr.$metadata
		}

		return wrapped
	}

	// Non-Error: wrap with provider-specific prefix
	console.error(`[${providerName}] Non-Error exception:`, error)
	const wrapped = new Error(`${providerName} ${messagePrefix} error: ${String(error)}`)

	// Also try to preserve status for non-Error exceptions (e.g., plain objects with status)
	const anyErr = error as any
	// kilocode_change start
	const status = resolveErrorStatus(anyErr)
	if (status !== undefined) {
		;(wrapped as any).status = status
	}
	// kilocode_change end

	return wrapped
}

/**
 * Specialized handler for OpenAI-compatible providers
 * Re-exports with OpenAI-specific defaults for backward compatibility
 */
export function handleOpenAIError(error: unknown, providerName: string): Error {
	return handleProviderError(error, providerName, { messagePrefix: "completion" })
}
