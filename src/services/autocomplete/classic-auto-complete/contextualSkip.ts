/**
 * Contextual skip logic for autocomplete.
 *
 * This module provides smart skip logic to determine when autocomplete
 * should be skipped based on the current context.
 */

interface LanguageFamilyConfig {
	/** VS Code language IDs that belong to this family */
	languages: string[]
	/** Statement terminators for this language family */
	terminators: string[]
}

const LANGUAGE_CONFIGS: LanguageFamilyConfig[] = [
	{
		languages: [
			"javascript",
			"javascriptreact",
			"typescript",
			"typescriptreact",
			"c",
			"cpp",
			"csharp",
			"java",
			"kotlin",
			"scala",
			"swift",
			"php",
			"dart",
			"css",
			"scss",
			"less",
			"json",
			"jsonc",
			"go",
			"rust",
		],
		terminators: [";", "}", ")"],
	},
	{
		languages: ["python"],
		terminators: [")", "]", "}"],
	},
	{
		languages: ["ruby"],
		terminators: [")", "]", "}", "end"],
	},
	{
		languages: ["shellscript", "bash", "zsh", "sh"],
		terminators: [";", "fi", "done", "esac"],
	},
	{
		languages: ["sql", "mysql", "postgresql", "plsql"],
		terminators: [";"],
	},
	{
		languages: ["lisp", "clojure", "scheme", "elisp", "racket"],
		terminators: [],
	},
	{
		languages: ["html", "xml", "svg", "vue", "svelte"],
		terminators: [],
	},
]

const DEFAULT_TERMINATORS = [";", "}", ")"]

/**
 * Maps VS Code language IDs to their statement terminators, precomputed for quick lookup.
 */
const LANGUAGE_TERMINATORS: Record<string, string[]> = LANGUAGE_CONFIGS.reduce(
	(map, config) => {
		for (const lang of config.languages) {
			map[lang] = config.terminators
		}
		return map
	},
	{} as Record<string, string[]>,
)

export function getTerminatorsForLanguage(languageId: string | undefined): string[] {
	if (!languageId) {
		return DEFAULT_TERMINATORS
	}
	return LANGUAGE_TERMINATORS[languageId] ?? DEFAULT_TERMINATORS
}

function isAtEndOfStatement(prefix: string, suffix: string, languageId?: string): boolean {
	// Get the current line's content after the cursor
	const suffixFirstLine = suffix.split("\n")[0]

	// If there's non-whitespace content after the cursor, we're not at end of line
	if (suffixFirstLine.trim().length > 0) {
		return false
	}

	// Get the last character before the cursor (excluding trailing whitespace)
	const prefixLines = prefix.split("\n")
	const currentLinePrefix = prefixLines[prefixLines.length - 1]
	const trimmedLinePrefix = currentLinePrefix.trimEnd()

	// Empty line - not at end of statement
	if (trimmedLinePrefix.length === 0) {
		return false
	}

	// Get language-specific terminators
	const terminators = getTerminatorsForLanguage(languageId)

	// Check if line ends with any terminator (single or multi-character)
	for (const terminator of terminators) {
		if (trimmedLinePrefix.endsWith(terminator)) {
			return true
		}
	}

	return false
}

function isMidWordTyping(prefix: string, suffix: string): boolean {
	if (prefix.length === 0) {
		return false
	}

	const suffixStartsWithWordChar = /^[a-zA-Z0-9_]/.test(suffix)

	const wordMatch = prefix.match(/([a-zA-Z_][a-zA-Z0-9_]*)$/)
	const lengthOfWordAtEndOfPrefix = wordMatch ? wordMatch[1].length : 0

	return lengthOfWordAtEndOfPrefix > 2 || suffixStartsWithWordChar
}

export function shouldSkipAutocomplete(prefix: string, suffix: string, languageId?: string): boolean {
	return isAtEndOfStatement(prefix, suffix, languageId) || isMidWordTyping(prefix, suffix)
}
