import React, { useState, useEffect, useRef, useCallback } from "react"
import { Text } from "ink"
import { parse, setOptions } from "marked"
import TerminalRenderer, { type TerminalRendererOptions } from "marked-terminal"
import chalk, { type ChalkInstance } from "chalk"
import type { Theme } from "../../types/theme.js"

export type MarkdownTextProps = TerminalRendererOptions & {
	children: string
	theme?: Theme
}

/**
 * Named chalk color methods that return ChalkInstance
 */
type ChalkColorMethod =
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "gray"
	| "grey"
	| "blackBright"
	| "redBright"
	| "greenBright"
	| "yellowBright"
	| "blueBright"
	| "magentaBright"
	| "cyanBright"
	| "whiteBright"

/**
 * Convert a color string (hex or named) to a chalk function
 */
const colorToChalk = (color: string): ChalkInstance => {
	// If it starts with #, it's a hex color
	if (color.startsWith("#")) {
		return chalk.hex(color)
	}
	// Otherwise, it's a named color - use chalk's named color methods
	// Check if it's a valid color method name
	if (isChalkColorMethod(color)) {
		return chalk[color]
	}
	return chalk.white
}

/**
 * Type guard to check if a string is a valid chalk color method
 */
const isChalkColorMethod = (color: string): color is ChalkColorMethod => {
	const validColors: ChalkColorMethod[] = [
		"black",
		"red",
		"green",
		"yellow",
		"blue",
		"magenta",
		"cyan",
		"white",
		"gray",
		"grey",
		"blackBright",
		"redBright",
		"greenBright",
		"yellowBright",
		"blueBright",
		"magentaBright",
		"cyanBright",
		"whiteBright",
	]
	return validColors.includes(color as ChalkColorMethod)
}

/**
 * Calculate adaptive animation speed based on chunk timing and remaining unrendered text
 * Returns both interval duration and characters per update to match streaming speed
 *
 * @param timeSinceLastChunk - Milliseconds since last chunk arrived
 * @param remainingChars - Number of characters still to be rendered (not just new chunk)
 * @returns Object with intervalMs (update frequency) and charsPerUpdate (chars per interval)
 */
const calculateAdaptiveSpeed = (
	timeSinceLastChunk: number,
	remainingChars: number,
): { intervalMs: number; charsPerUpdate: number } => {
	// Calculate how much time we have per character based on remaining work
	const timePerChar = timeSinceLastChunk / Math.max(remainingChars, 1)

	// Use 98% of available time to aggressively match streaming speed
	const targetTimePerChar = timePerChar * 0.98

	// Keep update intervals smooth but allow faster updates
	let intervalMs: number
	let charsPerUpdate: number

	if (targetTimePerChar < 8) {
		// Very fast streaming: show many chars per update
		intervalMs = 8
		charsPerUpdate = Math.max(1, Math.ceil(intervalMs / targetTimePerChar))
	} else if (targetTimePerChar < 15) {
		// Fast streaming: show 2-3 chars per update
		intervalMs = 10
		charsPerUpdate = Math.max(2, Math.ceil(intervalMs / targetTimePerChar))
	} else if (targetTimePerChar > 30) {
		// Slow streaming: one char per slower update
		intervalMs = Math.min(targetTimePerChar, 40)
		charsPerUpdate = 1
	} else {
		// Normal streaming: one char per update at natural pace
		intervalMs = targetTimePerChar
		charsPerUpdate = 1
	}

	return { intervalMs, charsPerUpdate }
}

/**
 * MarkdownText Component with Adaptive Typewriter Effect
 *
 * A wrapper component that renders markdown text in Ink terminals with an intelligent
 * typewriter animation that adapts to streaming content speed.
 *
 * ## Features
 *
 * ### Adaptive Speed Animation
 * The typewriter effect dynamically adjusts speed based on ALL remaining unrendered text:
 *
 * - **Speed calculation**: Uses time since last chunk ÷ remaining unrendered characters
 * - **Dynamic adjustment**: Recalculates on each new chunk to catch up if needed
 * - **Very fast** (< 8ms/char): Shows many characters per 8ms update
 * - **Fast** (8-15ms/char): Shows 2-3 characters per 10ms update
 * - **Normal** (15-30ms/char): Shows 1 character per update at natural pace
 * - **Slow** (> 30ms/char): Shows 1 character per slower update (max 40ms)
 *
 * This ensures the animation stays synchronized even with variable chunk speeds:
 * - If first chunk is slow, starts slow
 * - If next chunk arrives faster, speeds up to catch up with ALL remaining text
 * - Uses 98% of available time per chunk to stay synchronized
 * - No content gets "dumped" at the end when streaming stops
 *
 * ### Intelligent Chunk Detection
 * - Automatically detects when new content is appended (streaming scenario)
 * - Handles complete content replacement (new message scenario)
 * - Shows initial content immediately without animation
 *
 * ### Performance Optimizations
 * - Markdown parsing occurs once per displayed text update (not per character)
 * - Uses refs to track state without causing unnecessary re-renders
 * - Efficient timer cleanup on unmount
 *
 * ### Edge Case Handling
 * - Empty or whitespace content: Returns null immediately
 * - Content replacement: Shows new content right away
 * - Rapid updates: Continues animation smoothly through new chunks
 *
 * ## Usage
 *
 * ```tsx
 * // Basic usage
 * <MarkdownText>**Hello** World</MarkdownText>
 *
 * // With streaming updates
 * <MarkdownText>{streamingContent}</MarkdownText>
 *
 * // With TerminalRenderer options
 * <MarkdownText width={80} reflowText={true}>
 *   # Heading
 * </MarkdownText>
 * ```
 *
 * @param children - The markdown content to render
 * @param options - Optional TerminalRenderer configuration
 * @returns Rendered markdown text with typewriter animation for streaming content
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({ children, theme, ...options }) => {
	// State for displayed text (what user sees)
	const [displayedText, setDisplayedText] = useState("")

	// Refs for tracking without causing re-renders
	const previousContentRef = useRef("")
	const lastChunkTimeRef = useRef(Date.now())
	const animationTimerRef = useRef<NodeJS.Timeout | null>(null)
	const targetTextRef = useRef("")
	const currentIndexRef = useRef(0)
	const charsPerUpdateRef = useRef(1) // How many characters to show per interval

	// Cleanup animation timer on unmount
	useEffect(() => {
		return () => {
			if (animationTimerRef.current) {
				clearInterval(animationTimerRef.current)
			}
		}
	}, [])

	/**
	 * Start animation at the specified interval, showing N characters per update
	 */
	const startAnimation = useCallback((intervalMs: number) => {
		if (animationTimerRef.current) {
			clearInterval(animationTimerRef.current)
		}

		animationTimerRef.current = setInterval(() => {
			if (currentIndexRef.current < targetTextRef.current.length) {
				// Show N characters per update based on streaming speed
				currentIndexRef.current = Math.min(
					currentIndexRef.current + charsPerUpdateRef.current,
					targetTextRef.current.length,
				)
				setDisplayedText(targetTextRef.current.slice(0, currentIndexRef.current))
			} else {
				// Animation complete - clear the timer
				if (animationTimerRef.current) {
					clearInterval(animationTimerRef.current)
					animationTimerRef.current = null
				}
			}
		}, intervalMs)
	}, [])

	// Handle new content arrival
	useEffect(() => {
		// If the text is empty or just whitespace, reset state
		if (!children || !children.trim()) {
			setDisplayedText("")
			previousContentRef.current = ""
			targetTextRef.current = ""
			currentIndexRef.current = 0
			if (animationTimerRef.current) {
				clearInterval(animationTimerRef.current)
				animationTimerRef.current = null
			}
			return
		}

		// Check if content has actually changed
		if (children === previousContentRef.current) {
			return
		}

		// First render - show content immediately without animation
		if (previousContentRef.current === "") {
			setDisplayedText(children)
			currentIndexRef.current = children.length
			targetTextRef.current = children
			previousContentRef.current = children
			return
		}

		// Detect if this is a new chunk (content grew and old content is a prefix)
		const isNewChunk =
			children.length > previousContentRef.current.length && children.startsWith(previousContentRef.current)

		if (isNewChunk) {
			// New chunk detected - calculate adaptive speed
			const now = Date.now()
			const timeSinceLastChunk = now - lastChunkTimeRef.current
			lastChunkTimeRef.current = now

			// Update target text
			targetTextRef.current = children

			// Calculate remaining unrendered text
			// This is key: we base speed on ALL remaining text, not just the new chunk
			const remainingChars = children.length - currentIndexRef.current

			// Calculate adaptive speed and chars per update based on remaining work
			const { intervalMs, charsPerUpdate } = calculateAdaptiveSpeed(timeSinceLastChunk, remainingChars)
			charsPerUpdateRef.current = charsPerUpdate

			// If not currently animating, start animation from current position
			if (!animationTimerRef.current) {
				startAnimation(intervalMs)
			} else {
				// Already animating - restart with new speed for remaining text
				clearInterval(animationTimerRef.current)
				startAnimation(intervalMs)
			}
		} else {
			// Content changed completely (not a chunk append) - show immediately
			setDisplayedText(children)
			currentIndexRef.current = children.length
			targetTextRef.current = children
			if (animationTimerRef.current) {
				clearInterval(animationTimerRef.current)
				animationTimerRef.current = null
			}
		}

		previousContentRef.current = children
	}, [children, startAnimation])

	// Determine what text to actually display
	// On initial render before effect runs, use children directly
	// After that, use the animated displayedText
	const textToDisplay = displayedText || children

	// If nothing to display, return null
	if (!textToDisplay || !textToDisplay.trim()) {
		return null
	}

	try {
		// Merge theme colors with user options if theme is provided
		const rendererOptions: TerminalRendererOptions = theme
			? {
					...options,
					text: colorToChalk(theme.markdown.text),
					heading: colorToChalk(theme.markdown.heading),
					strong: colorToChalk(theme.markdown.strong),
					em: colorToChalk(theme.markdown.em),
					code: colorToChalk(theme.markdown.code),
					blockquote: colorToChalk(theme.markdown.blockquote),
					link: colorToChalk(theme.markdown.link),
					list: colorToChalk(theme.markdown.list),
				}
			: options

		// Configure marked to use the terminal renderer
		setOptions({
			renderer: new TerminalRenderer(rendererOptions),
		})

		// Parse markdown on the displayed text (efficient - only once per update)
		const rendered = parse(textToDisplay) as string
		return <Text>{rendered.trim()}</Text>
	} catch {
		// Fallback to plain text if markdown parsing fails
		return <Text>{textToDisplay}</Text>
	}
}
