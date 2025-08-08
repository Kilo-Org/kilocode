/**
 * Tiktoken mock for CLI environment
 * Provides token counting without WASM dependencies
 */

const TOKEN_FUDGE_FACTOR = 1.5

// Type definitions to avoid importing @anthropic-ai/sdk
interface TextBlock {
	type: "text"
	text: string
}

interface ImageBlock {
	type: "image"
	source:
		| {
				type: string
				data: string
		  }
		| any
}

type ContentBlock = TextBlock | ImageBlock

/**
 * Mock tiktoken implementation that estimates token count without WASM
 * Uses character-based estimation which is reasonably accurate for most use cases
 */
export async function tiktoken(content: ContentBlock[]): Promise<number> {
	if (content.length === 0) {
		return 0
	}

	let totalTokens = 0

	// Process each content block using character-based estimation
	for (const block of content) {
		if (block.type === "text") {
			const text = block.text || ""

			if (text.length > 0) {
				// Rough estimation: ~4 characters per token for English text
				// This is a reasonable approximation for most use cases
				totalTokens += Math.ceil(text.length / 4)
			}
		} else if (block.type === "image") {
			// For images, calculate based on data size (same as original)
			const imageSource = block.source

			if (imageSource && typeof imageSource === "object" && "data" in imageSource) {
				const base64Data = imageSource.data as string
				totalTokens += Math.ceil(Math.sqrt(base64Data.length))
			} else {
				totalTokens += 300 // Conservative estimate for unknown images
			}
		}
	}

	// Add a fudge factor to account for estimation inaccuracy
	return Math.ceil(totalTokens * TOKEN_FUDGE_FACTOR)
}

/**
 * Mock encoder class for compatibility
 */
export class MockTiktoken {
	encode(text: string): number[] {
		// Return array of estimated token count length
		const tokenCount = Math.ceil(text.length / 4)
		return new Array(tokenCount).fill(0).map((_, i) => i)
	}

	decode(tokens: number[]): string {
		// Simple mock decode - return placeholder text
		return tokens.map(() => "tok").join("")
	}
}

// Export mock encoder data for compatibility
export const mockEncoderData = {
	bpe_ranks: new Map(),
	special_tokens: new Map(),
	pat_str: "",
}
