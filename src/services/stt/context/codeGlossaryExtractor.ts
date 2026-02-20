// kilocode_change - new file: Extract code identifiers from visible code for STT context
import type { VisibleCodeContext } from "../../autocomplete/types"

export interface CodeGlossary {
	identifiers: string[] // Unique code identifiers from visible code
}

/**
 * Core terms that should always be included in the glossary
 * These are Kilocode-specific or commonly spoken technical terms
 */
const CORE_TERMS = ["Kilocode", "Kilo Code", "VSCode", "MCP"]

/**
 * Extract code identifiers from visible editors
 * Uses regex-based extraction (fast, language-agnostic)
 * Always includes core Kilocode-related terms
 */
export function extractCodeGlossary(visibleCode: VisibleCodeContext): CodeGlossary {
	const identifiers = new Set<string>()

	// Always include core terms
	for (const term of CORE_TERMS) {
		identifiers.add(term)
	}

	for (const editor of visibleCode.editors) {
		for (const range of editor.visibleRanges) {
			// Extract identifiers using regex: camelCase, PascalCase, snake_case
			const regex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g
			const matches = range.content.match(regex) || []

			for (const match of matches) {
				if (isValidIdentifier(match)) {
					identifiers.add(match)
				}
			}
		}
	}

	return {
		identifiers: Array.from(identifiers),
	}
}

/**
 * Format glossary as OpenAI Whisper prompt
 * Optimized for Whisper's ~224 token limit (~150-200 words)
 * Prioritizes core terms, then longer identifiers
 */
export function formatGlossaryAsPrompt(glossary: CodeGlossary, limitCount: number = 50): string {
	if (glossary.identifiers.length === 0) {
		return ""
	}

	// Sort extracted terms by length (longer first)
	const sortedExtracted = glossary.identifiers.sort((a, b) => b.length - a.length)

	// Always include core terms first, then fill remaining space with extracted terms
	const remainingSlots = Math.max(0, limitCount - CORE_TERMS.length)
	const prioritized = [...CORE_TERMS, ...sortedExtracted.slice(0, remainingSlots)]

	return `Context: The user is a software developer. Terms that MAY appear in their speech include: ${prioritized.join(", ")}.`
}

function isValidIdentifier(word: string): boolean {
	return word.length >= 4
}
