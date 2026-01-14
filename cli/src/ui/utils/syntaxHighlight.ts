/**
 * Syntax highlighting utility for CLI diff views using Shiki
 */
import { createHighlighter, type Highlighter, type BundledLanguage, type BundledTheme, bundledLanguages } from "shiki"
import path from "path"

// Token with color information
export interface HighlightedToken {
	content: string
	color?: string
}

// Theme type for selecting Shiki theme
export type ThemeType = "light" | "dark"

// Map CLI theme types to Shiki themes
const SHIKI_THEMES: Record<ThemeType, BundledTheme> = {
	dark: "github-dark",
	light: "github-light",
}

// Common languages to pre-load for instant highlighting
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
]

// Map file extensions to Shiki languages
const extensionToLanguage: Record<string, BundledLanguage> = {
	// JavaScript/TypeScript
	".js": "javascript",
	".jsx": "jsx",
	".ts": "typescript",
	".tsx": "tsx",
	".mjs": "javascript",
	".cjs": "javascript",
	".mts": "typescript",
	".cts": "typescript",
	// Web
	".html": "html",
	".htm": "html",
	".css": "css",
	".scss": "scss",
	".sass": "sass",
	".less": "less",
	".vue": "vue",
	".svelte": "svelte",
	// Data formats
	".json": "json",
	".jsonc": "jsonc",
	".yaml": "yaml",
	".yml": "yaml",
	".toml": "toml",
	".xml": "xml",
	// Systems programming
	".c": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".h": "c",
	".hpp": "cpp",
	".rs": "rust",
	".go": "go",
	".zig": "zig",
	// Scripting
	".py": "python",
	".rb": "ruby",
	".php": "php",
	".pl": "perl",
	".lua": "lua",
	// JVM
	".java": "java",
	".kt": "kotlin",
	".kts": "kotlin",
	".scala": "scala",
	".groovy": "groovy",
	// .NET
	".cs": "csharp",
	".fs": "fsharp",
	".vb": "vb",
	// Shell
	".sh": "shellscript",
	".bash": "shellscript",
	".zsh": "shellscript",
	".fish": "fish",
	".ps1": "powershell",
	".bat": "bat",
	".cmd": "bat",
	// Config files
	".ini": "ini",
	".conf": "properties",
	".env": "properties",
	".dockerfile": "dockerfile",
	".makefile": "makefile",
	// Markup/Docs
	".md": "markdown",
	".mdx": "mdx",
	".tex": "latex",
	".rst": "rst",
	// SQL
	".sql": "sql",
	// Swift/Objective-C
	".swift": "swift",
	".m": "objective-c",
	".mm": "objective-cpp",
	// Other
	".r": "r",
	".R": "r",
	".dart": "dart",
	".elm": "elm",
	".ex": "elixir",
	".exs": "elixir",
	".erl": "erlang",
	".hrl": "erlang",
	".clj": "clojure",
	".hs": "haskell",
	".lisp": "lisp",
	".scm": "scheme",
	".rkt": "racket",
	".nim": "nim",
	".v": "v",
	".asm": "asm",
	".s": "asm",
	".graphql": "graphql",
	".gql": "graphql",
	".proto": "protobuf",
	".tf": "terraform",
	".hcl": "hcl",
	".nix": "nix",
	".vim": "viml",
	".diff": "diff",
	".patch": "diff",
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
 * Detect language from file path
 */
export function detectLanguage(filePath: string): BundledLanguage | null {
	const ext = path.extname(filePath).toLowerCase()

	// Check extension mapping
	const langFromMap = extensionToLanguage[ext]
	if (langFromMap) {
		return langFromMap
	}

	// Check for special filenames
	const basename = path.basename(filePath).toLowerCase()
	const specialFiles: Record<string, BundledLanguage> = {
		makefile: "makefile",
		dockerfile: "dockerfile",
		containerfile: "dockerfile",
		cmakelists: "cmake",
		"cmakelists.txt": "cmake",
		".gitignore": "shellscript", // Use shellscript as fallback for gitignore files
		".dockerignore": "shellscript",
		".editorconfig": "ini",
		".prettierrc": "json",
		".eslintrc": "json",
		"tsconfig.json": "jsonc",
		"jsconfig.json": "jsonc",
		"package.json": "json",
		"cargo.toml": "toml",
		"go.mod": "go",
		"go.sum": "go",
		gemfile: "ruby",
		rakefile: "ruby",
		vagrantfile: "ruby",
	}

	const lang = specialFiles[basename]
	if (lang) {
		return lang
	}

	// Check if extension (without dot) is a valid language
	const langFromExt = ext.slice(1)
	if (langFromExt && Object.prototype.hasOwnProperty.call(bundledLanguages, langFromExt)) {
		return langFromExt as BundledLanguage
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
