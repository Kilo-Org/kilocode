// kilocode_change - new file: SVG-based syntax highlighting for ghost decorations
import * as vscode from "vscode"
import { getSingletonHighlighter, type Highlighter, type ThemedToken, type BundledLanguage } from "shiki"
import { VS_CODE_TO_SHIKI_LANGUAGE_MAP } from "./constants"
import { getShikiTheme, getThemeColors, SUPPORTED_SHIKI_THEMES, type ThemeColors } from "./ThemeMapper"
import { type BackgroundRange } from "./CharacterDiff"
import { escapeHtml } from "../../../shared/utils/escapeHtml"

export type { ThemeColors, BackgroundRange }

export interface HighlightedResult {
	html: string
	themeColors: ThemeColors
}

let highlighter: Highlighter | null = null

/**
 * Initialize the Shiki highlighter with VS Code themes
 */
export async function initializeHighlighter(): Promise<Highlighter> {
	if (highlighter) {
		return highlighter
	}

	highlighter = await getSingletonHighlighter({
		themes: SUPPORTED_SHIKI_THEMES,
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

	return highlighter
}

export function getLanguageForDocument(document: vscode.TextDocument): string {
	return VS_CODE_TO_SHIKI_LANGUAGE_MAP[document.languageId] || "plaintext"
}

export async function generateHighlightedHtmlWithRanges(
	code: string,
	language: string,
	backgroundRanges: BackgroundRange[],
): Promise<HighlightedResult> {
	if (!highlighter) {
		highlighter = await initializeHighlighter()
	}

	const theme = getShikiTheme()
	const themeColors = getThemeColors()

	const tokensResult = highlighter.codeToTokens(code, { lang: language as BundledLanguage, theme: theme })
	const html = renderTokensToHtmlWithBackgrounds(tokensResult.tokens, backgroundRanges, themeColors)

	return { html, themeColors }
}

function renderTokensToHtmlWithBackgrounds(
	lines: ThemedToken[][],
	backgroundRanges: BackgroundRange[],
	themeColors: ThemeColors,
): string {
	let html = '<pre class="shiki"><code>'
	let globalOffset = 0

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex]
		html += '<span class="line">'

		for (const token of line) {
			const tokenStart = globalOffset
			const tokenEnd = globalOffset + token.content.length

			const overlappingRanges = backgroundRanges.filter(
				(range) => range.start < tokenEnd && range.end > tokenStart,
			)

			if (overlappingRanges.length > 0) {
				html += renderTokenWithCharacterRanges(
					token.content,
					token.color || themeColors.foreground,
					tokenStart,
					backgroundRanges,
					themeColors,
				)
			} else {
				html += `<span style="color:${token.color || themeColors.foreground}">${escapeHtml(token.content)}</span>`
			}

			globalOffset += token.content.length
		}

		html += "</span>"
		if (lineIndex < lines.length - 1) {
			html += "\n"
			globalOffset += 1
		}
	}

	html += "</code></pre>"

	return html
}

function renderTokenWithCharacterRanges(
	text: string,
	tokenColor: string,
	offset: number,
	ranges: BackgroundRange[],
	themeColors: ThemeColors,
): string {
	let html = ""
	let currentIndex = 0

	const segments: Array<{ text: string; hasBackground: boolean; rangeType?: string }> = []

	while (currentIndex < text.length) {
		const globalPos = offset + currentIndex
		const affectingRange = ranges.find((range) => range.start <= globalPos && range.end > globalPos)

		if (affectingRange) {
			const rangeStart = Math.max(0, affectingRange.start - offset)
			const rangeEnd = Math.min(text.length, affectingRange.end - offset)

			if (currentIndex < rangeStart) {
				segments.push({
					text: text.slice(currentIndex, rangeStart),
					hasBackground: false,
				})
			}

			segments.push({
				text: text.slice(Math.max(currentIndex, rangeStart), rangeEnd),
				hasBackground: affectingRange.type !== "unchanged",
				rangeType: affectingRange.type,
			})

			currentIndex = rangeEnd
		} else {
			const nextRangeStart = ranges
				.filter((range) => range.start > globalPos && range.type === "modified")
				.reduce((min, range) => Math.min(min, range.start - offset), text.length)

			segments.push({
				text: text.slice(currentIndex, Math.min(nextRangeStart, text.length)),
				hasBackground: false,
			})

			currentIndex = Math.min(nextRangeStart, text.length)
		}
	}

	for (const segment of segments) {
		if (segment.hasBackground) {
			const rangeType = segment.rangeType || "modified"
			const cssClass = `diff-${rangeType}`

			html += `<span class="${cssClass}" style="color:${tokenColor};background-color:${themeColors.modifiedBackground}">${escapeHtml(segment.text)}</span>`
		} else {
			html += `<span style="color:${tokenColor}">${escapeHtml(segment.text)}</span>`
		}
	}

	return html
}
