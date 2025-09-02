// kilocode_change - new file: SVG-based syntax highlighting for ghost decorations
import * as vscode from "vscode"
import { getSingletonHighlighter, type Highlighter } from "shiki"
import { VS_CODE_TO_SHIKI_LANGUAGE_MAP } from "./constants"

export interface CharacterRange {
	start: number
	end: number
	type: "unchanged" | "modified"
}

export interface DiffLine {
	type: "new" | "old" | "same"
	line: string
	characterRanges?: CharacterRange[]
}

export interface ThemeColors {
	background: string
	foreground: string
	modifiedBackground: string // Light green for modified characters
	border: string
}

export interface HighlightedResult {
	html: string
	themeColors: ThemeColors
}

let highlighter: Highlighter | null = null

/**
 * Initialize the Shiki highlighter with VS Code themes
 */
export async function initializeHighlighter(): Promise<void> {
	if (highlighter) {
		return
	}

	try {
		highlighter = await getSingletonHighlighter({
			themes: ["dark-plus", "light-plus", "github-dark", "github-light"],
			langs: [
				"typescript",
				"javascript",
				"python",
				"java",
				"cpp",
				"c",
				"csharp",
				"go",
				"rust",
				"php",
				"ruby",
				"swift",
				"kotlin",
				"scala",
				"html",
				"css",
				"json",
				"yaml",
				"xml",
				"markdown",
				"bash",
				"shell",
				"sql",
				"dockerfile",
				"plaintext",
			],
		})
	} catch (error) {
		console.error("Failed to initialize Shiki highlighter:", error)
		throw error
	}
}

/**
 * Get the appropriate language identifier for Shiki based on VS Code document
 */
export function getLanguageForDocument(document: vscode.TextDocument): string {
	const languageId = document.languageId
	return VS_CODE_TO_SHIKI_LANGUAGE_MAP[languageId] || "plaintext"
}

/**
 * Get current VS Code theme colors
 */
function getThemeColors(): ThemeColors {
	const currentTheme = vscode.window.activeColorTheme
	const isDark = currentTheme?.kind === vscode.ColorThemeKind.Dark

	// Default colors based on theme type
	if (isDark) {
		return {
			background: "#1e1e1e",
			foreground: "#d4d4d4",
			modifiedBackground: "#33333333",
			border: "#3c3c3c",
		}
	} else {
		return {
			background: "#ffffff",
			foreground: "#24292e",
			modifiedBackground: "#dddddd30",
			border: "#e1e4e8",
		}
	}
}

/**
 * Get appropriate Shiki theme based on VS Code theme
 */
function getShikiTheme(): string {
	const currentTheme = vscode.window.activeColorTheme
	const isDark = currentTheme.kind === vscode.ColorThemeKind.Dark

	// Use GitHub themes as they're more similar to VS Code
	return isDark ? "github-dark" : "github-light"
}

/**
 * Generate syntax-highlighted HTML (character-level highlighting handled in HtmlToSvgRenderer)
 */
export async function generateHighlightedHtml(
	code: string,
	language: string,
	startLine: number,
	diffLines: DiffLine[],
): Promise<HighlightedResult> {
	if (!highlighter) {
		await initializeHighlighter()
	}

	if (!highlighter) {
		throw new Error("Failed to initialize highlighter")
	}

	try {
		const theme = getShikiTheme()
		const themeColors = getThemeColors()

		// Simple syntax highlighting - diff highlighting is handled at character level in HtmlToSvgRenderer
		const html = highlighter.codeToHtml(code, {
			lang: language,
			theme: theme,
		})

		return {
			html,
			themeColors,
		}
	} catch (error) {
		console.error("Failed to generate highlighted HTML:", error)
		// Fallback to plain text
		const themeColors = getThemeColors()
		const escapedCode = code
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;")

		return {
			html: `<pre style="background: ${themeColors.background}; color: ${themeColors.foreground}; padding: 8px; margin: 0;"><code>${escapedCode}</code></pre>`,
			themeColors,
		}
	}
}
