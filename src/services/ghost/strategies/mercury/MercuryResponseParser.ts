/**
 * Handles parsing and cleaning Mercury's responses to extract the updated code.
 * Following Continue's approach: extract code from markdown blocks, rely on clear
 * prompting to prevent line numbers in responses.
 */
export class MercuryResponseParser {
	private static readonly MERCURY_MARKERS = {
		OPEN: "<|code_to_edit|>",
		CLOSE: "<|/code_to_edit|>",
	}

	/**
	 * Extract clean code content from Mercury's response.
	 * Matches Continue's extractCompletion method.
	 */
	public extractCleanCode(response: string): string {
		return this.extractFromCodeBlocks(response).trim()
	}

	/**
	 * Extract content from markdown code blocks.
	 * Matches Continue's slice-based extraction approach.
	 */
	private extractFromCodeBlocks(message: string): string {
		// Continue's exact approach: extract between ``` markers
		const startMarker = "```\n"
		const endMarker = "\n\n```"

		const startIndex = message.indexOf(startMarker)
		const endIndex = message.lastIndexOf(endMarker)

		if (startIndex !== -1 && endIndex !== -1 && startIndex < endIndex) {
			return message.slice(startIndex + startMarker.length, endIndex)
		}

		// Fallback: try without the newlines
		const simpleStart = message.indexOf("```")
		const simpleEnd = message.lastIndexOf("```")

		if (simpleStart !== -1 && simpleEnd !== -1 && simpleStart !== simpleEnd) {
			let contentStart = message.indexOf("\n", simpleStart)
			if (contentStart === -1) {
				contentStart = simpleStart + 3
			} else {
				contentStart += 1
			}
			return message.slice(contentStart, simpleEnd).trim()
		}

		// No code blocks found, return original
		return message.trim()
	}

	/**
	 * Check if response appears to be empty or just whitespace
	 */
	public isEmpty(response: string): boolean {
		return !this.extractCleanCode(response).trim()
	}

	/**
	 * Get debug info about the parsing process
	 */
	public getParsingDebugInfo(response: string): {
		originalLength: number
		hasCodeBlocks: boolean
		hasMercuryMarkers: boolean
		extractedLength: number
	} {
		const { OPEN, CLOSE } = MercuryResponseParser.MERCURY_MARKERS

		return {
			originalLength: response.length,
			hasCodeBlocks: response.includes("```"),
			hasMercuryMarkers: response.includes(OPEN) || response.includes(CLOSE),
			extractedLength: this.extractCleanCode(response).length,
		}
	}
}
