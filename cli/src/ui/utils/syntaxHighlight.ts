/**
 * Syntax highlighting utility for CLI diff views using Shiki
 *
 * This module provides syntax highlighting for code diffs in the CLI.
 * It uses Shiki for accurate, language-aware syntax coloring.
 *
 * Language detection uses GitHub's Linguist library data (via linguist-languages)
 * which provides comprehensive file extension and filename mappings used by
 * GitHub for syntax highlighting. This is the same data source used by VS Code,
 * GitHub, and many other editors.
 */
import {
	createHighlighter,
	type Highlighter,
	type BundledLanguage,
	type BundledTheme,
	bundledLanguagesInfo,
} from "shiki"
import * as linguist from "linguist-languages"
import path from "path"

/**
 * Type definition for Linguist language data.
 * This matches the structure exported by linguist-languages.
 */
interface LinguistLanguage {
	name: string
	type: "programming" | "markup" | "data" | "prose"
	aceMode?: string
	aliases?: string[]
	extensions?: string[]
	filenames?: string[]
	languageId?: number
	tmScope?: string
	codemirrorMode?: string
	codemirrorMimeType?: string
	color?: string
	interpreters?: string[]
}

// Token with color information
export interface HighlightedToken {
	content: string
	color?: string
}

// Theme type for selecting Shiki theme - matches CLI theme.type values
export type ThemeType = "light" | "dark" | "custom"

/**
 * Map CLI theme types to Shiki themes.
 * We use GitHub themes as they provide good coverage and readability.
 * Custom themes default to dark since they're typically dark-based.
 */
const SHIKI_THEMES: Record<ThemeType, BundledTheme> = {
	dark: "github-dark",
	light: "github-light",
	custom: "github-dark", // Custom themes default to dark
}

/**
 * Build a map from Shiki language aliases to canonical language IDs.
 * This allows us to look up languages by their aliases (e.g., "js" -> "javascript").
 */
function buildShikiAliasMap(): Map<string, BundledLanguage> {
	const aliasMap = new Map<string, BundledLanguage>()
	for (const lang of bundledLanguagesInfo) {
		// Map the canonical ID
		aliasMap.set(lang.id.toLowerCase(), lang.id as BundledLanguage)
		// Map the display name
		aliasMap.set(lang.name.toLowerCase(), lang.id as BundledLanguage)
		// Map all aliases
		if (lang.aliases) {
			for (const alias of lang.aliases) {
				aliasMap.set(alias.toLowerCase(), lang.id as BundledLanguage)
			}
		}
	}
	return aliasMap
}

/**
 * Languages to skip when building extension maps.
 * These are obscure languages that conflict with more common ones.
 * For example, "GCC Machine Description" uses .md but we want Markdown.
 */
const SKIP_LANGUAGES = new Set([
	"GCC Machine Description", // Uses .md, conflicts with Markdown
])

/**
 * Extension overrides for optimal Shiki highlighting.
 * Linguist sometimes maps extensions to language names that don't give
 * the best Shiki highlighting. For example, .jsx maps to "JavaScript"
 * but Shiki's "jsx" language provides better JSX element highlighting.
 */
const EXTENSION_OVERRIDES: Record<string, BundledLanguage> = {
	".jsx": "jsx", // Linguist maps to JavaScript, but Shiki's jsx has better JSX support
	".tsx": "tsx", // Linguist maps to TypeScript, but Shiki's tsx has better JSX support
	".vue": "vue", // Ensure Vue files use Shiki's vue language
	".php": "php", // Linguist may map to Hack for some PHP files
}

/**
 * Build extension-to-language and filename-to-language maps from Linguist data.
 * Linguist is GitHub's library for language detection, providing comprehensive
 * and well-maintained mappings.
 *
 * We prioritize programming languages over markup/data languages when there
 * are conflicts (e.g., .ts is both TypeScript and XML), but skip certain
 * obscure languages that would conflict with common ones.
 */
function buildLanguageMaps(shikiAliasMap: Map<string, BundledLanguage>): {
	extensionMap: Map<string, BundledLanguage>
	filenameMap: Map<string, BundledLanguage>
} {
	const extensionMap = new Map<string, BundledLanguage>()
	const filenameMap = new Map<string, BundledLanguage>()

	// Helper to find Shiki language for a Linguist language
	const findShikiLanguage = (lang: LinguistLanguage): BundledLanguage | null => {
		// Try language name
		const byName = shikiAliasMap.get(lang.name.toLowerCase())
		if (byName) return byName

		// Try ace mode (often matches Shiki IDs)
		if (lang.aceMode) {
			const byAce = shikiAliasMap.get(lang.aceMode.toLowerCase())
			if (byAce) return byAce
		}

		// Try aliases
		if (lang.aliases) {
			for (const alias of lang.aliases) {
				const byAlias = shikiAliasMap.get(alias.toLowerCase())
				if (byAlias) return byAlias
			}
		}

		return null
	}

	// Process languages in priority order: programming > markup > data > prose
	const typeOrder = ["programming", "markup", "data", "prose"]

	for (const type of typeOrder) {
		for (const lang of Object.values(linguist) as LinguistLanguage[]) {
			if (lang.type !== type) continue

			// Skip obscure languages that conflict with common ones
			if (SKIP_LANGUAGES.has(lang.name)) continue

			const shikiLang = findShikiLanguage(lang)
			if (!shikiLang) continue

			// Map extensions (only if not already mapped by higher priority type)
			if (lang.extensions) {
				for (const ext of lang.extensions) {
					const normalizedExt = ext.toLowerCase()
					if (!extensionMap.has(normalizedExt)) {
						extensionMap.set(normalizedExt, shikiLang)
					}
				}
			}

			// Map filenames
			if (lang.filenames) {
				for (const filename of lang.filenames) {
					const normalizedFilename = filename.toLowerCase()
					if (!filenameMap.has(normalizedFilename)) {
						filenameMap.set(normalizedFilename, shikiLang)
					}
				}
			}
		}
	}

	return { extensionMap, filenameMap }
}

// Initialize maps lazily
let shikiAliasMap: Map<string, BundledLanguage> | null = null
let extensionMap: Map<string, BundledLanguage> | null = null
let filenameMap: Map<string, BundledLanguage> | null = null

function ensureMapsInitialized(): void {
	if (!shikiAliasMap) {
		shikiAliasMap = buildShikiAliasMap()
		const maps = buildLanguageMaps(shikiAliasMap)
		extensionMap = maps.extensionMap
		filenameMap = maps.filenameMap
	}
}

/**
 * Common languages to pre-load for instant highlighting.
 * These are loaded at startup to ensure synchronous highlighting works
 * immediately for the most frequently used languages.
 *
 * This list covers:
 * - Web development: JavaScript, TypeScript, JSX, TSX, HTML, CSS, SCSS, Vue, Svelte
 * - Backend: Python, Ruby, PHP, Go, Rust, Java, Kotlin, C#, C, C++
 * - Data/Config: JSON, YAML, TOML, XML, GraphQL, SQL
 * - Shell/Scripts: Bash, PowerShell, Dockerfile, Makefile
 * - Documentation: Markdown
 */
const COMMON_LANGUAGES: BundledLanguage[] = [
	// Web frontend
	"javascript",
	"typescript",
	"jsx",
	"tsx",
	"html",
	"css",
	"scss",
	"vue",
	"svelte",
	// Backend languages
	"python",
	"ruby",
	"php",
	"go",
	"rust",
	"java",
	"kotlin",
	"csharp",
	"c",
	"cpp",
	// Data and config formats
	"json",
	"jsonc",
	"yaml",
	"toml",
	"xml",
	"graphql",
	"sql",
	// Shell and scripts
	"bash",
	"shellscript",
	"powershell",
	"dockerfile",
	"makefile",
	// Documentation
	"markdown",
	"mdx",
]

// Singleton highlighter state
let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
let initializationComplete = false
const loadedLanguages = new Set<string>(["plaintext"])
const pendingLoads = new Map<string, Promise<void>>()

/**
 * Get or create the singleton highlighter instance.
 * Pre-loads common languages for instant highlighting.
 * Additional languages are loaded on-demand via ensureLanguageLoaded().
 */
async function getHighlighter(): Promise<Highlighter> {
	if (highlighter) {
		return highlighter
	}

	if (highlighterPromise) {
		return highlighterPromise
	}

	highlighterPromise = createHighlighter({
		themes: [SHIKI_THEMES.dark, SHIKI_THEMES.light],
		langs: ["plaintext", ...COMMON_LANGUAGES],
	}).then((h) => {
		highlighter = h
		// Mark common languages as loaded
		for (const lang of COMMON_LANGUAGES) {
			loadedLanguages.add(lang)
		}
		return h
	})

	return highlighterPromise
}

/**
 * Initialize the syntax highlighter.
 * Call this early in the application lifecycle.
 * Languages are loaded on-demand, so this just initializes the highlighter.
 */
export async function initializeSyntaxHighlighter(): Promise<void> {
	if (initializationComplete) {
		return
	}

	try {
		// Initialize language maps
		ensureMapsInitialized()
		// Initialize highlighter
		await getHighlighter()
		initializationComplete = true
	} catch {
		// Silently fail - highlighting will fall back to plain text
	}
}

/**
 * Check if the highlighter is ready for synchronous highlighting
 */
export function isHighlighterReady(): boolean {
	return highlighter !== null
}

/**
 * Ensure a language is loaded
 */
async function ensureLanguageLoaded(lang: BundledLanguage): Promise<void> {
	if (loadedLanguages.has(lang)) {
		return
	}

	let loadPromise = pendingLoads.get(lang)
	if (loadPromise) {
		return loadPromise
	}

	loadPromise = (async () => {
		try {
			const h = await getHighlighter()
			await h.loadLanguage(lang)
			loadedLanguages.add(lang)
		} catch {
			// Silently fail - highlighting will fall back to plain text
		} finally {
			pendingLoads.delete(lang)
		}
	})()

	pendingLoads.set(lang, loadPromise)
	return loadPromise
}

/**
 * Detect language from file path using GitHub's Linguist data.
 *
 * This uses the same language detection data that GitHub uses for syntax
 * highlighting, providing comprehensive coverage of file extensions and
 * special filenames.
 *
 * @param filePath - The file path to detect language for
 * @returns The detected BundledLanguage or null if unknown
 */
export function detectLanguage(filePath: string): BundledLanguage | null {
	ensureMapsInitialized()

	const ext = path.extname(filePath).toLowerCase()
	const basename = path.basename(filePath).toLowerCase()

	// 0. Check extension overrides first (highest priority)
	// These are cases where Linguist's mapping doesn't give optimal Shiki highlighting
	const langFromOverride = EXTENSION_OVERRIDES[ext]
	if (langFromOverride) {
		return langFromOverride
	}

	// 1. Check special filenames (high priority)
	// This handles files like Makefile, Dockerfile, .gitignore, etc.
	const langFromFilename = filenameMap!.get(basename)
	if (langFromFilename) {
		return langFromFilename
	}

	// 2. Check extension mapping from Linguist
	const langFromExt = extensionMap!.get(ext)
	if (langFromExt) {
		return langFromExt
	}

	// 3. Try extension (without dot) as Shiki language alias
	// This catches cases where the extension directly matches a Shiki language
	const extWithoutDot = ext.slice(1)
	if (extWithoutDot) {
		const langFromAlias = shikiAliasMap!.get(extWithoutDot)
		if (langFromAlias) {
			return langFromAlias
		}
	}

	return null
}

/**
 * Highlight a single line of code and return colored tokens
 */
export async function highlightLine(
	line: string,
	language: BundledLanguage | null,
	themeType: ThemeType = "dark",
): Promise<HighlightedToken[]> {
	// If no language or empty line, return plain text
	if (!language || !line) {
		return [{ content: line }]
	}

	try {
		// Ensure language is loaded
		await ensureLanguageLoaded(language)

		const h = await getHighlighter()
		const shikiTheme = SHIKI_THEMES[themeType]

		// Get tokens from Shiki
		const tokens = h.codeToTokensBase(line, {
			lang: language,
			theme: shikiTheme,
		})

		// Convert to our format
		const result: HighlightedToken[] = []
		for (const lineTokens of tokens) {
			for (const token of lineTokens) {
				const tokenEntry: HighlightedToken = { content: token.content }
				if (token.color) {
					tokenEntry.color = token.color
				}
				result.push(tokenEntry)
			}
		}

		return result.length > 0 ? result : [{ content: line }]
	} catch {
		// On error, return plain text
		return [{ content: line }]
	}
}

/**
 * Synchronously highlight a line using cached highlighter
 * Returns null if highlighter is not ready (caller should fall back to plain text)
 */
export function highlightLineSync(
	line: string,
	language: BundledLanguage | null,
	themeType: ThemeType = "dark",
): HighlightedToken[] | null {
	if (!language || !line || !highlighter || !loadedLanguages.has(language)) {
		return null
	}

	try {
		const shikiTheme = SHIKI_THEMES[themeType]
		const tokens = highlighter.codeToTokensBase(line, {
			lang: language,
			theme: shikiTheme,
		})

		const result: HighlightedToken[] = []
		for (const lineTokens of tokens) {
			for (const token of lineTokens) {
				const tokenEntry: HighlightedToken = { content: token.content }
				if (token.color) {
					tokenEntry.color = token.color
				}
				result.push(tokenEntry)
			}
		}

		return result.length > 0 ? result : [{ content: line }]
	} catch {
		return null
	}
}

/**
 * Highlight an entire code block and return tokens for each line.
 * This is the preferred method for diff highlighting as it preserves
 * multiline context (e.g., template literals, multiline strings, comments).
 *
 * Unlike highlightLineSync which tokenizes each line independently,
 * this function tokenizes the entire block together, ensuring proper
 * highlighting of constructs that span multiple lines.
 *
 * @param lines - Array of code lines to highlight
 * @param language - The language to use for highlighting
 * @param themeType - The theme type (dark, light, custom)
 * @returns Array of token arrays, one per input line. Returns null if highlighter not ready.
 *
 * @example
 * ```typescript
 * const lines = [
 *   'const msg = `Hello',
 *   'World',
 *   '`;'
 * ]
 * const tokens = highlightCodeBlockSync(lines, 'javascript', 'dark')
 * // tokens[0] = tokens for 'const msg = `Hello'
 * // tokens[1] = tokens for 'World' (highlighted as string content)
 * // tokens[2] = tokens for '`;'
 * ```
 */
export function highlightCodeBlockSync(
	lines: string[],
	language: BundledLanguage | null,
	themeType: ThemeType = "dark",
): HighlightedToken[][] | null {
	if (!language || lines.length === 0 || !highlighter || !loadedLanguages.has(language)) {
		return null
	}

	try {
		const shikiTheme = SHIKI_THEMES[themeType]
		// Join lines with newlines to preserve multiline context
		const code = lines.join("\n")
		const tokenLines = highlighter.codeToTokensBase(code, {
			lang: language,
			theme: shikiTheme,
		})

		// Convert Shiki tokens to our format, one array per line
		const result: HighlightedToken[][] = []
		for (const lineTokens of tokenLines) {
			const lineResult: HighlightedToken[] = []
			for (const token of lineTokens) {
				const tokenEntry: HighlightedToken = { content: token.content }
				if (token.color) {
					tokenEntry.color = token.color
				}
				lineResult.push(tokenEntry)
			}
			// If line has no tokens, add empty content
			result.push(lineResult.length > 0 ? lineResult : [{ content: "" }])
		}

		return result
	} catch {
		return null
	}
}

/**
 * Async version of highlightCodeBlock that ensures language is loaded first.
 *
 * @param lines - Array of code lines to highlight
 * @param language - The language to use for highlighting
 * @param themeType - The theme type (dark, light, custom)
 * @returns Promise resolving to array of token arrays, one per input line
 */
export async function highlightCodeBlock(
	lines: string[],
	language: BundledLanguage | null,
	themeType: ThemeType = "dark",
): Promise<HighlightedToken[][]> {
	// If no language or empty lines, return plain text tokens
	if (!language || lines.length === 0) {
		return lines.map((line) => [{ content: line }])
	}

	try {
		// Ensure language is loaded
		await ensureLanguageLoaded(language)

		const h = await getHighlighter()
		const shikiTheme = SHIKI_THEMES[themeType]
		// Join lines with newlines to preserve multiline context
		const code = lines.join("\n")
		const tokenLines = h.codeToTokensBase(code, {
			lang: language,
			theme: shikiTheme,
		})

		// Convert Shiki tokens to our format, one array per line
		const result: HighlightedToken[][] = []
		for (const lineTokens of tokenLines) {
			const lineResult: HighlightedToken[] = []
			for (const token of lineTokens) {
				const tokenEntry: HighlightedToken = { content: token.content }
				if (token.color) {
					tokenEntry.color = token.color
				}
				lineResult.push(tokenEntry)
			}
			// If line has no tokens, add empty content
			result.push(lineResult.length > 0 ? lineResult : [{ content: "" }])
		}

		return result
	} catch {
		// On error, return plain text tokens
		return lines.map((line) => [{ content: line }])
	}
}

/**
 * Pre-load a language for later sync use
 */
export async function preloadLanguage(language: BundledLanguage | null): Promise<void> {
	if (!language) return
	await ensureLanguageLoaded(language)
}

/**
 * Check if a language is ready for sync highlighting
 */
export function isLanguageReady(language: BundledLanguage | null): boolean {
	return !!language && !!highlighter && loadedLanguages.has(language)
}
