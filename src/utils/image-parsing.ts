// kilocode_change - new file
import type { Anthropic } from "@anthropic-ai/sdk"

type AnthropicMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp"

/**
 * Parses a data URL into an Anthropic ImageBlockParam.
 * Returns null if the data URL is invalid or malformed.
 *
 * @param dataUrl - A data URL string in format: data:image/png;base64,<base64string>
 * @returns An Anthropic ImageBlockParam or null if invalid
 */
export function parseDataUrlToImageBlock(dataUrl: string): Anthropic.ImageBlockParam | null {
	if (!dataUrl || typeof dataUrl !== "string") {
		return null
	}

	// Format: data:image/png;base64,<base64string>
	const commaIndex = dataUrl.indexOf(",")
	if (commaIndex === -1) {
		return null
	}

	const metadata = dataUrl.slice(0, commaIndex)
	const base64 = dataUrl.slice(commaIndex + 1)

	// Extract mime type from "data:image/png;base64"
	const mimeMatch = metadata.match(/^data:([^;]+)/)
	const mimeType = mimeMatch?.[1]

	if (!mimeType || !base64) {
		return null
	}

	return {
		type: "image",
		source: { type: "base64", media_type: mimeType as AnthropicMediaType, data: base64 },
	}
}

/**
 * Converts an array of data URLs to Anthropic ImageBlockParams.
 * Filters out any invalid/malformed URLs.
 *
 * @param dataUrls - Array of data URL strings
 * @returns Array of valid Anthropic ImageBlockParams
 */
export function parseDataUrlsToImageBlocks(dataUrls?: string[]): Anthropic.ImageBlockParam[] {
	if (!dataUrls || dataUrls.length === 0) {
		return []
	}

	return dataUrls.map(parseDataUrlToImageBlock).filter((block): block is Anthropic.ImageBlockParam => block !== null)
}
