/**
 * Text measurement utilities for consistent SVG rendering and width calculations
 */

/** Character width ratio for monospace fonts - consistent across all components */
const MONOSPACE_CHARACTER_WIDTH_RATIO = 0.6

/** Container padding for SVG decorations */
const CONTAINER_PADDING = 32

/**
 * Calculate character width for given font size
 */
export function calculateCharacterWidth(fontSize: number): number {
	return fontSize * MONOSPACE_CHARACTER_WIDTH_RATIO
}

/**
 * Calculate estimated width for text content
 */
export function calculateTextWidth(text: string, fontSize: number): number {
	return text.length * calculateCharacterWidth(fontSize)
}

/**
 * Calculate container width with proper padding for SVG decorations
 */
export function calculateContainerWidth(text: string, fontSize: number): number {
	const lines = text.split("\n")
	const maxLineLength = Math.max(...lines.map((line) => line.length))
	const baseWidth = maxLineLength * calculateCharacterWidth(fontSize)
	return Math.max(CONTAINER_PADDING, Math.round(baseWidth + CONTAINER_PADDING))
}
