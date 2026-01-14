/**
 * Syntax highlighting utility for CLI diff views using Shiki
 *
 * This module provides syntax highlighting for code diffs in the CLI.
 * It uses Shiki for accurate, language-aware syntax coloring.
 *
 * Language detection leverages Shiki's bundledLanguages for comprehensive
 * coverage without maintaining a separate mapping. Special filenames and
 * common extensions are handled explicitly for reliability.
 */
import { createHighlighter, type Highlighter, type BundledLanguage, type BundledTheme, bundledLanguages } from "shiki"
import path from "path"

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
 * Common languages to pre-load at startup for instant highlighting.
 * These are the most frequently used languages in typical development.
 * Other languages are loaded on-demand when first encountered.
 */
const COMMON_LANGUAGES: BundledLanguage[] = [
	"javascript",
	"typescript",
	"tsx",
	"jsx",
	"python",
	"json",
	"html",
	"css",
	"markdown",
	"yaml",
	"bash",
	"shellscript",
	"go",
	"rust",
	"java",
	"c",
	"cpp",
]

/**
 * Extension to language mapping for common file types.
 * This provides explicit mappings for extensions that don't directly
 * match Shiki language names or need special handling.
 *
 * For extensions not listed here, we fall back to checking if the
 * extension itself is a valid Shiki language name (e.g., ".py" -> "python"
 * won't work, but ".lua" -> "lua" will).
 */
const extensionToLanguage: Record<string, BundledLanguage> = {
	// JavaScript/TypeScript variants
	".js": "javascript",
	".jsx": "jsx",
	".ts": "typescript",
	".tsx": "tsx",
	".mjs": "javascript",
	".cjs": "javascript",
	".mts": "typescript",
	".cts": "typescript",
	// Python
	".py": "python",
	".pyi": "python",
	".pyw": "python",
	".ipynb": "python",
	// Ruby
	".rb": "ruby",
	".rake": "ruby",
	".gemspec": "ruby",
	// Shell
	".sh": "shellscript",
	".bash": "shellscript",
	".zsh": "shellscript",
	// C/C++ header disambiguation
	".h": "c",
	".hpp": "cpp",
	".hxx": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	// Common config formats
	".yml": "yaml",
	".jsonc": "jsonc",
	// Kotlin
	".kt": "kotlin",
	".kts": "kotlin",
	// Elixir
	".ex": "elixir",
	".exs": "elixir",
	// Erlang
	".erl": "erlang",
	".hrl": "erlang",
	// Clojure
	".clj": "clojure",
	".cljs": "clojure",
	".cljc": "clojure",
	".edn": "clojure",
	// F#
	".fs": "fsharp",
	".fsi": "fsharp",
	".fsx": "fsharp",
	// Objective-C
	".m": "objective-c",
	".mm": "objective-cpp",
	// GraphQL
	".gql": "graphql",
	// Terraform
	".tf": "terraform",
	".tfvars": "terraform",
}

/**
 * Special filename mappings for files without extensions or with
 * non-standard naming conventions.
 */
const specialFilenames: Record<string, BundledLanguage> = {
	makefile: "makefile",
	gnumakefile: "makefile",
	dockerfile: "dockerfile",
	containerfile: "dockerfile",
	"docker-compose.yml": "yaml",
	"docker-compose.yaml": "yaml",
	".gitignore": "ini", // gitignore files use ini-like syntax
	".gitattributes": "ini",
	".dockerignore": "ini",
	".editorconfig": "ini",
	".prettierrc": "json",
	".eslintrc": "json",
	".babelrc": "json",
	"tsconfig.json": "jsonc",
	"jsconfig.json": "jsonc",
	"package.json": "json",
	"package-lock.json": "json",
	"composer.json": "json",
	"cargo.toml": "toml",
	"pyproject.toml": "toml",
	"go.mod": "go",
	"go.sum": "go",
	gemfile: "ruby",
	rakefile: "ruby",
	vagrantfile: "ruby",
	brewfile: "ruby",
	podfile: "ruby",
	cmakelists: "cmake",
	"cmakelists.txt": "cmake",
}

// Singleton highlighter state
let highlighter: Highlighter | null = null
let highlighterPromise: Promise<Highlighter> | null = null
let initializationComplete = false
const loadedLanguages = new Set<string>(["plaintext"])
const pendingLoads = new Map<string, Promise<void>>()

/**
 * Get or create the singleton highlighter instance
 * Loads both light and dark themes for theme switching
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
 * Initialize the syntax highlighter with common languages.
 * Call this early in the application lifecycle for instant highlighting.
 */
export async function initializeSyntaxHighlighter(): Promise<void> {
	if (initializationComplete) {
		return
	}

	try {
		await getHighlighter()
		initializationComplete = true
	} catch (error) {
		// Silently fail - highlighting will fall back to plain text
		console.error("[SyntaxHighlight] Failed to initialize:", error)
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
		} finally {
			pendingLoads.delete(lang)
		}
	})()

	pendingLoads.set(lang, loadPromise)
	return loadPromise
}

/**
 * Detect language from file path using multiple strategies:
 * 1. Check explicit extension mappings for common/ambiguous extensions
 * 2. Check special filename mappings (Makefile, Dockerfile, etc.)
 * 3. Fall back to Shiki's bundledLanguages using the extension as language name
 *
 * This approach leverages Shiki's comprehensive language support while
 * providing explicit mappings for cases where the extension doesn't
 * directly match the language name.
 *
 * @param filePath - The file path to detect language for
 * @returns The detected BundledLanguage or null if unknown
 */
export function detectLanguage(filePath: string): BundledLanguage | null {
	const ext = path.extname(filePath).toLowerCase()
	const basename = path.basename(filePath).toLowerCase()

	// 1. Check special filenames first (highest priority)
	const langFromFilename = specialFilenames[basename]
	if (langFromFilename) {
		// Verify the language is actually available in Shiki
		if (Object.prototype.hasOwnProperty.call(bundledLanguages, langFromFilename)) {
			return langFromFilename
		}
	}

	// 2. Check explicit extension mappings
	const langFromMap = extensionToLanguage[ext]
	if (langFromMap) {
		return langFromMap
	}

	// 3. Try extension (without dot) as language name
	// This leverages Shiki's bundledLanguages which includes many languages
	// where the extension matches the language name (e.g., .lua -> lua, .go -> go)
	const extWithoutDot = ext.slice(1)
	if (extWithoutDot && Object.prototype.hasOwnProperty.call(bundledLanguages, extWithoutDot)) {
		return extWithoutDot as BundledLanguage
	}

	// 4. Handle some common cases where extension differs from language name
	// These are languages where the extension is commonly used but doesn't
	// match Shiki's language identifier
	const fallbackMappings: Record<string, BundledLanguage> = {
		htm: "html",
		hs: "haskell",
		rs: "rust",
		cs: "csharp",
		vb: "vb",
		pl: "perl",
		pm: "perl",
		r: "r",
		jl: "julia",
		sc: "scala",
		sol: "solidity",
		asm: "asm",
		s: "asm",
		v: "v",
		nim: "nim",
		rkt: "racket",
		scm: "scheme",
		lisp: "lisp",
		el: "elisp",
		vim: "viml",
		proto: "protobuf",
		hcl: "hcl",
		nix: "nix",
		rst: "rst",
		tex: "latex",
		cls: "latex",
		sty: "latex",
	}

	const langFromFallback = fallbackMappings[extWithoutDot]
	if (langFromFallback && Object.prototype.hasOwnProperty.call(bundledLanguages, langFromFallback)) {
		return langFromFallback
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
