// kilocode_change - new file: HTML to SVG conversion for ghost decorations
import { JSDOM } from "jsdom"
import { ThemeColors, CharacterRange } from "./CodeHighlighter"

export interface SvgConversionOptions {
	width: number
	height: number
	fontSize: number
	fontFamily: string
	lineHeight: number
}

/**
 * Calculate dimensions needed for a text tooltip
 */
export function calculateTipDimensions(
	text: string,
	fontSize: number,
	lineHeight: number,
): { width: number; height: number } {
	const lines = text.split("\n")
	const maxLineLength = Math.max(...lines.map((line) => line.length))

	const charWidth = estimateCharWidth(fontSize)
	const width = Math.max(200, maxLineLength * charWidth + 32) // Add padding for readability

	const lineHeightPx = fontSize * lineHeight
	const totalHeightPx = lines.length * lineHeightPx

	return { width: Math.round(width), height: Math.round(totalHeightPx) }
}

/**
 * Convert highlighted HTML to SVG using JSDOM with character-level highlighting
 */
export function convertHtmlToSvg(
	html: string,
	options: SvgConversionOptions,
	themeColors: ThemeColors,
	characterRanges?: CharacterRange[],
): string {
	const { width, height, fontSize, fontFamily, lineHeight } = options

	try {
		// Create JSDOM instance with minimal HTML document
		const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`)
		const document = dom.window.document

		// Create a container div and set the HTML content
		const container = document.createElement("div")
		container.innerHTML = html
		container.style.fontFamily = fontFamily
		container.style.fontSize = `${fontSize}px`
		container.style.lineHeight = `${lineHeight}`
		container.style.margin = "0"
		container.style.padding = "8px"
		container.style.whiteSpace = "pre"
		container.style.overflow = "hidden"

		// Extract text content and styling information
		const textContent = extractTextWithStyling(container, options, characterRanges)
		const svg = generateSvgFromContent(textContent, options, themeColors)

		// Clean up JSDOM
		dom.window.close()

		return svg
	} catch (error) {
		console.error("Failed to convert HTML to SVG:", error)
		// Fallback to simple SVG with plain text
		return generateFallbackSvg(html, options, themeColors)
	}
}

interface StyledText {
	text: string
	x: number
	y: number
	color?: string
	backgroundColor?: string
	fontWeight?: string
	fontStyle?: string
}

/**
 * Process text node and add styled text to result
 */
function processTextNode(
	textContent: string,
	inheritedStyle: Partial<CSSStyleDeclaration>,
	currentX: { value: number },
	currentY: { value: number },
	fontSize: number,
): StyledText | null {
	if (!textContent.trim()) {
		return null
	}

	const styledText: StyledText = {
		text: textContent,
		x: currentX.value,
		y: currentY.value,
		color: inheritedStyle.color,
		backgroundColor: inheritedStyle.backgroundColor,
		fontWeight: inheritedStyle.fontWeight,
		fontStyle: inheritedStyle.fontStyle,
	}

	currentX.value += textContent.length * estimateCharWidth(fontSize)
	return styledText
}

/**
 * Merge inherited style with element's computed style
 */
function mergeElementStyle(
	element: Element,
	inheritedStyle: Partial<CSSStyleDeclaration>,
): Partial<CSSStyleDeclaration> {
	const computedStyle = getComputedStyleFromElement(element)
	return { ...inheritedStyle, ...computedStyle }
}

/**
 * Handle line break elements by updating position
 */
function handleLineBreakElement(
	element: Element,
	currentX: { value: number },
	currentY: { value: number },
	lineHeightPx: number,
): void {
	if (element.tagName === "BR" || element.tagName === "DIV") {
		currentY.value += lineHeightPx
		currentX.value = 8 // Reset to start
	}
}

/**
 * Helper function to process DOM nodes for fallback HTML parsing
 */
function processNodeForFallback(
	node: Node,
	inheritedStyle: Partial<CSSStyleDeclaration>,
	result: StyledText[],
	currentX: { value: number },
	currentY: { value: number },
	lineHeightPx: number,
	fontSize: number,
): void {
	if (node.nodeType === node.TEXT_NODE) {
		const styledText = processTextNode(node.textContent || "", inheritedStyle, currentX, currentY, fontSize)
		if (styledText) {
			result.push(styledText)
		}
	} else if (node.nodeType === node.ELEMENT_NODE) {
		const element = node as Element
		const mergedStyle = mergeElementStyle(element, inheritedStyle)

		handleLineBreakElement(element, currentX, currentY, lineHeightPx)

		// Process child nodes
		for (const child of Array.from(node.childNodes)) {
			processNodeForFallback(child, mergedStyle, result, currentX, currentY, lineHeightPx, fontSize)
		}
	}
}

/**
 * Apply character-level background highlighting to a text segment
 * Only affects background color, preserves all other styling from Shiki
 */
function applyCharacterHighlightingToText(
	text: string,
	textStartIndex: number,
	characterRanges?: CharacterRange[],
	themeColors?: ThemeColors,
): Array<{ text: string; backgroundColor?: string }> {
	if (!characterRanges || characterRanges.length === 0) {
		return [{ text, backgroundColor: undefined }]
	}

	const result: Array<{ text: string; backgroundColor?: string }> = []
	const textEndIndex = textStartIndex + text.length

	// Find ranges that overlap with this text segment
	const relevantRanges = characterRanges
		.filter((range) => range.start < textEndIndex && range.end > textStartIndex)
		.map((range) => ({
			...range,
			// Adjust range to be relative to this text segment
			start: Math.max(0, range.start - textStartIndex),
			end: Math.min(text.length, range.end - textStartIndex),
		}))
		.sort((a, b) => a.start - b.start)

	if (relevantRanges.length === 0) {
		return [{ text, backgroundColor: undefined }]
	}

	let currentPos = 0

	for (const range of relevantRanges) {
		// Add text before this range (unchanged background)
		if (currentPos < range.start) {
			const beforeText = text.substring(currentPos, range.start)
			if (beforeText) {
				result.push({ text: beforeText, backgroundColor: undefined })
			}
		}

		// Add the highlighted range
		const rangeText = text.substring(range.start, range.end)
		if (rangeText) {
			const backgroundColor =
				range.type === "modified" ? themeColors?.modifiedBackground || "#28a74530" : undefined
			result.push({ text: rangeText, backgroundColor })
		}

		currentPos = Math.max(currentPos, range.end)
	}

	// Add remaining text after all ranges
	if (currentPos < text.length) {
		const remainingText = text.substring(currentPos)
		if (remainingText) {
			result.push({ text: remainingText, backgroundColor: undefined })
		}
	}

	return result
}

/**
 * Process a single text node within a Shiki line
 */
function processShikiTextNode(
	node: Node,
	currentCharIndex: number,
	currentY: number,
	lineStyle: Partial<CSSStyleDeclaration>,
	characterRanges?: CharacterRange[],
): { styledTexts: StyledText[]; charIndexIncrement: number } {
	const text = node.textContent || ""
	if (!text) {
		return { styledTexts: [], charIndexIncrement: 0 }
	}

	const textWithHighlighting = applyCharacterHighlightingToText(text, currentCharIndex, characterRanges)
	const styledTexts = textWithHighlighting.map((part) => ({
		text: part.text,
		x: 0,
		y: currentY,
		color: lineStyle.color,
		backgroundColor: part.backgroundColor || lineStyle.backgroundColor,
		fontWeight: lineStyle.fontWeight,
		fontStyle: lineStyle.fontStyle,
	}))

	return { styledTexts, charIndexIncrement: text.length }
}

/**
 * Process a single element node within a Shiki line
 */
function processShikiElementNode(
	element: Element,
	currentCharIndex: number,
	currentY: number,
	lineStyle: Partial<CSSStyleDeclaration>,
	characterRanges?: CharacterRange[],
): { styledTexts: StyledText[]; charIndexIncrement: number } {
	const computedStyle = getComputedStyleFromElement(element)
	const text = element.textContent || ""

	if (!text) {
		return { styledTexts: [], charIndexIncrement: 0 }
	}

	const textWithHighlighting = applyCharacterHighlightingToText(text, currentCharIndex, characterRanges)
	const styledTexts = textWithHighlighting.map((part) => ({
		text: part.text,
		x: 0,
		y: currentY,
		color: computedStyle.color || lineStyle.color, // Preserve Shiki colors
		backgroundColor: part.backgroundColor || computedStyle.backgroundColor || lineStyle.backgroundColor,
		fontWeight: computedStyle.fontWeight || lineStyle.fontWeight,
		fontStyle: computedStyle.fontStyle || lineStyle.fontStyle,
	}))

	return { styledTexts, charIndexIncrement: text.length }
}

/**
 * Process Shiki HTML structure with .line elements
 */
function processShikiHtmlStructure(
	lines: Element[],
	options: SvgConversionOptions,
	characterRanges?: CharacterRange[],
): StyledText[] {
	const result: StyledText[] = []
	const lineHeightPx = options.fontSize * options.lineHeight

	lines.forEach((line, lineIndex) => {
		// Center the text vertically using proper baseline alignment
		const currentY = lineIndex * lineHeightPx + lineHeightPx / 2
		const lineStyle = getComputedStyleFromElement(line)

		// Process all child nodes of this line to preserve Shiki syntax highlighting
		const childNodes = Array.from(line.childNodes)
		let currentCharIndex = 0

		childNodes.forEach((node) => {
			if (node.nodeType === node.TEXT_NODE) {
				const { styledTexts, charIndexIncrement } = processShikiTextNode(
					node,
					currentCharIndex,
					currentY,
					lineStyle,
					characterRanges,
				)
				result.push(...styledTexts)
				currentCharIndex += charIndexIncrement
			} else if (node.nodeType === node.ELEMENT_NODE) {
				const { styledTexts, charIndexIncrement } = processShikiElementNode(
					node as Element,
					currentCharIndex,
					currentY,
					lineStyle,
					characterRanges,
				)
				result.push(...styledTexts)
				currentCharIndex += charIndexIncrement
			}
		})
	})

	return result
}

/**
 * Process fallback HTML structure for non-Shiki content
 */
function processFallbackHtmlStructure(element: Element, options: SvgConversionOptions): StyledText[] {
	const result: StyledText[] = []
	const lineHeightPx = options.fontSize * options.lineHeight
	const currentX = { value: 8 } // Start with padding
	const currentY = { value: options.fontSize } // Start with font size

	processNodeForFallback(element, {}, result, currentX, currentY, lineHeightPx, options.fontSize)
	return result
}

/**
 * Extract text content with styling information from DOM element with character-level highlighting
 */
function extractTextWithStyling(
	element: Element,
	options: SvgConversionOptions,
	characterRanges?: CharacterRange[],
	themeColors?: ThemeColors,
): StyledText[] {
	// Look for Shiki's .line elements first
	const lines = Array.from(element.querySelectorAll(".line"))

	if (lines.length > 0) {
		return processShikiHtmlStructure(lines, options, characterRanges)
	} else {
		return processFallbackHtmlStructure(element, options)
	}
}

/**
 * Extract basic styling from element attributes and classes
 */
function getComputedStyleFromElement(element: Element): Partial<CSSStyleDeclaration> {
	const style: Partial<CSSStyleDeclaration> = {}

	// Handle inline styles only - we don't need old diff classes anymore
	const inlineStyle = element.getAttribute("style")
	if (inlineStyle) {
		const styleProps = inlineStyle.split(";")
		for (const prop of styleProps) {
			const [key, value] = prop.split(":").map((s) => s.trim())
			if (key && value) {
				switch (key) {
					case "color":
						style.color = value
						break
					case "background-color":
						style.backgroundColor = value
						break
					case "font-weight":
						style.fontWeight = value
						break
					case "font-style":
						style.fontStyle = value
						break
				}
			}
		}
	}

	return style
}

/**
 * Group styled text content by line position
 */
function groupContentByLines(content: StyledText[]): Map<number, StyledText[]> {
	const lineGroups = new Map<number, StyledText[]>()
	content.forEach((item) => {
		if (!lineGroups.has(item.y)) {
			lineGroups.set(item.y, [])
		}
		lineGroups.get(item.y)!.push(item)
	})
	return lineGroups
}

/**
 * Generate single line background path for SVG
 */
function generateSingleLineBackground(y: number, width: number, lineHeightPx: number, bgColor: string): string {
	const radius = 10
	return `<path d="M ${radius} ${y}
		L ${width - radius} ${y}
		Q ${width} ${y} ${width} ${y + radius}
		L ${width} ${y + lineHeightPx - radius}
		Q ${width} ${y + lineHeightPx} ${width - radius} ${y + lineHeightPx}
		L ${radius} ${y + lineHeightPx}
		Q ${0} ${y + lineHeightPx} ${0} ${y + lineHeightPx - radius}
		L ${0} ${y + radius}
		Q ${0} ${y} ${radius} ${y}
		Z" fill="${bgColor}" shape-rendering="crispEdges" />`
}

/**
 * Generate line backgrounds for SVG
 */
function generateLineBackgrounds(
	uniqueYValues: number[],
	width: number,
	lineHeightPx: number,
	themeColors: ThemeColors,
): string {
	return uniqueYValues
		.map((yPos, index) => {
			const bgColor = themeColors.background
			const y = index * lineHeightPx
			const isFirst = index === 0
			const isLast = index === uniqueYValues.length - 1
			const isSingleLine = isFirst && isLast
			const radius = 10

			if (isSingleLine) {
				return generateSingleLineBackground(y, width, lineHeightPx, bgColor)
			}

			return isFirst
				? `<path d="M ${0} ${y + lineHeightPx}
				L ${0} ${y + radius}
				Q ${0} ${y} ${radius} ${y}
				L ${width - radius} ${y}
				Q ${width} ${y} ${width} ${y + radius}
				L ${width} ${y + lineHeightPx}
				Z" fill="${bgColor}" shape-rendering="crispEdges" />`
				: isLast
					? `<path d="M ${0} ${y}
				L ${0} ${y + lineHeightPx - radius}
				Q ${0} ${y + lineHeightPx} ${radius} ${y + lineHeightPx}
				L ${width - radius} ${y + lineHeightPx}
				Q ${width} ${y + lineHeightPx} ${width} ${y + lineHeightPx - radius}
				L ${width} ${y}
				Z" fill="${bgColor}" shape-rendering="crispEdges" />`
					: `<rect x="0" y="${y}" width="100%" height="${lineHeightPx}" fill="${bgColor}" shape-rendering="crispEdges" />`
		})
		.join("\n")
}

/**
 * Generate character-level background rectangles for a line
 */
function generateCharacterBackgrounds(
	lineItems: StyledText[],
	lineIndex: number,
	fontSize: number,
	lineHeightPx: number,
): string {
	let currentX = 8 // Start position
	return lineItems
		.map((item) => {
			const textWidth = estimateTextWidth(item.text, fontSize)
			let rect = ""

			if (item.backgroundColor && item.backgroundColor !== "transparent") {
				const y = lineIndex * lineHeightPx
				rect = `<rect x="${currentX}" y="${y}" width="${textWidth}" height="${lineHeightPx}" fill="${item.backgroundColor}" shape-rendering="crispEdges" />`
			}

			currentX += textWidth
			return rect
		})
		.filter((rect) => rect !== "")
		.join("")
}

/**
 * Generate text elements for SVG
 */
function generateTextElements(
	lineGroups: Map<number, StyledText[]>,
	uniqueYValues: number[],
	options: SvgConversionOptions,
	themeColors: ThemeColors,
): { backgroundRects: string; textElements: string } {
	const { fontSize, fontFamily, lineHeight } = options
	const lineHeightPx = fontSize * lineHeight
	let allBackgroundRects = ""

	const textElements = uniqueYValues
		.map((yPos, lineIndex) => {
			const lineItems = lineGroups.get(yPos) || []
			lineItems.sort((a, b) => a.x - b.x)

			// Generate background rectangles for this line
			const lineBackgroundRects = generateCharacterBackgrounds(lineItems, lineIndex, fontSize, lineHeightPx)
			allBackgroundRects += lineBackgroundRects

			// Generate text spans
			const spans = lineItems
				.map((item) => {
					const color = item.color || themeColors.foreground
					const fill = color ? ` fill="${color}"` : ""
					return `<tspan xml:space="preserve"${fill}>${escapeForSVG(item.text)}</tspan>`
				})
				.join("")

			// Calculate Y position: center the text vertically
			const y = lineIndex * lineHeightPx + lineHeightPx / 2

			return `<text x="8" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" xml:space="preserve" dominant-baseline="central" shape-rendering="crispEdges">${spans}</text>`
		})
		.join("\n")

	return { backgroundRects: allBackgroundRects, textElements }
}

/**
 * Generate SVG from styled text content using Continue's approach
 */
function generateSvgFromContent(
	content: StyledText[],
	options: SvgConversionOptions,
	themeColors: ThemeColors,
): string {
	const { width, height, fontSize, fontFamily, lineHeight } = options
	const lineHeightPx = fontSize * lineHeight

	const lineGroups = groupContentByLines(content)
	const uniqueYValues = Array.from(lineGroups.keys()).sort((a, b) => a - b)

	let svgContent = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
		<rect x="0" y="0" rx="10" ry="10" width="${width}" height="${height}" fill="${themeColors.background}" shape-rendering="crispEdges"/>
		<g font-family="${fontFamily}" font-size="${fontSize}px">`

	// Generate line backgrounds first (behind text)
	const lineBackgrounds = generateLineBackgrounds(uniqueYValues, width, lineHeightPx, themeColors)
	svgContent += lineBackgrounds

	// Generate character-level background rectangles and text elements
	const { backgroundRects, textElements } = generateTextElements(lineGroups, uniqueYValues, options, themeColors)

	// Add background rectangles first (behind text)
	svgContent += backgroundRects
	svgContent += textElements
	svgContent += `</g></svg>`

	return svgContent
}

/**
 * Generate fallback SVG for when HTML parsing fails
 */
function generateFallbackSvg(html: string, options: SvgConversionOptions, themeColors: ThemeColors): string {
	const { width, height, fontSize, fontFamily } = options

	const plainText = html.replace(/<[^>]*>/g, "").trim()
	const lines = plainText.split("\n").slice(0, Math.floor(height / (fontSize * 1.2)))

	let svgContent = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
		<rect width="100%" height="100%" fill="${themeColors.background}" stroke="${themeColors.border}" stroke-width="1"/>
		<g font-family="${fontFamily}" font-size="${fontSize}px" fill="${themeColors.foreground}">`

	lines.forEach((line, index) => {
		const y = 20 + index * (fontSize * 1.2)
		svgContent += `<text x="8" y="${y}">${escapeForSVG(line)}</text>`
	})

	svgContent += `</g></svg>`

	return svgContent
}

/**
 * Escape text for safe use in SVG
 */
function escapeForSVG(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
}

/**
 * Estimate character width for monospace fonts
 */
function estimateCharWidth(fontSize: number): number {
	return fontSize * 0.6
}

/**
 * Estimate text width for positioning
 */
function estimateTextWidth(text: string, fontSize: number): number {
	return text.length * estimateCharWidth(fontSize)
}
