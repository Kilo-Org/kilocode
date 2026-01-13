import type { ILogger } from "../types/ILogger.js"

/**
 * Fetch a JSON blob from a signed URL with optional logging.
 */
export async function fetchSignedBlob(
	url: string,
	urlType: string,
	logger?: ILogger,
	context: string = "fetchSignedBlob",
) {
	try {
		logger?.debug?.(`Fetching blob from signed URL`, context, { url, urlType })

		const response = await fetch(url)

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = await response.json()

		logger?.debug?.(`Successfully fetched blob`, context, { url, urlType })

		return data
	} catch (error) {
		logger?.error?.(`Failed to fetch blob from signed URL`, context, {
			url,
			urlType,
			error: error instanceof Error ? error.message : String(error),
		})
		throw error
	}
}
