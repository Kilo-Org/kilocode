// kilocode_change - new file: High-level SVG rendering orchestration for ghost decorations
import { generateHighlightedHtml, DiffLine, CharacterRange } from "./CodeHighlighter"
import { convertHtmlToSvg, SvgConversionOptions } from "./HtmlToSvgRenderer"

export interface SVGRenderOptions {
	fontSize: number
	fontFamily: string
	dimensions: { width: number; height: number }
	lineHeight: number
}

/**
 * Generate SVG data URI for code with syntax highlighting and diff visualization
 */
export async function generateCodeSVG(
	text: string,
	language: string,
	options: SVGRenderOptions,
	currLineOffsetFromTop: number,
	newDiffLines: DiffLine[],
): Promise<string> {
	const { fontSize, fontFamily, dimensions, lineHeight } = options
	const { width, height } = dimensions

	try {
		const highlightedCode = await generateHighlightedHtml(text, language, currLineOffsetFromTop, newDiffLines)

		const conversionOptions: SvgConversionOptions = {
			width,
			height,
			fontSize,
			fontFamily,
			lineHeight,
		}

		// Extract character ranges from the first diff line if available
		const characterRanges = newDiffLines.length > 0 ? newDiffLines[0].characterRanges : undefined

		const svg = convertHtmlToSvg(
			highlightedCode.html,
			conversionOptions,
			highlightedCode.themeColors,
			characterRanges,
		)

		return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
	} catch (error) {
		console.error("Failed to generate syntax-highlighted SVG:", error)
		throw error
	}
}
