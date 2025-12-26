/**
 * General error handler for OpenAI client errors
 * Transforms technical errors into user-friendly messages
 */

import i18n from "../../../i18n/setup"

/**
 * Handles OpenAI client errors and transforms them into user-friendly messages
 * @param error - The error to handle
 * @param providerName - The name of the provider for context in error messages
 * @returns The original error or a transformed user-friendly error
 */
export function handleOpenAIError(error: unknown, providerName: string): Error {
	if (error instanceof Error) {
		const msg = (error as any)?.error?.metadata?.raw || error.message || ""

		// Log the original error details for debugging
		console.error(`[${providerName}] API error:`, {
			message: msg,
			name: error.name,
			stack: error.stack,
		})

		// Invalid character/ByteString conversion error in API key
		if (msg.includes("Cannot convert argument to a ByteString")) {
			return new Error(i18n.t("common:errors.api.invalidKeyInvalidChars"))
		}

		// For other Error instances, wrap with provider-specific prefix
		return new Error(`${providerName} completion error: ${msg}`)
	}

	// Non-Error: wrap with provider-specific prefix
	console.error(`[${providerName}] Non-Error exception:`, error)
	return new Error(`${providerName} completion error: ${String(error)}`)
}
