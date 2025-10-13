import React from "react"
import { Text } from "ink"
import { parse, setOptions } from "marked"
import TerminalRenderer, { type TerminalRendererOptions } from "marked-terminal"

export type MarkdownTextProps = TerminalRendererOptions & {
	children: string
}

/**
 * Wrapper component for rendering markdown text in Ink
 * Falls back to plain Text if markdown parsing fails
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({ children, ...options }) => {
	// If the text is empty or just whitespace, don't render anything
	if (!children || !children.trim()) {
		return null
	}

	try {
		// Configure marked to use the terminal renderer
		setOptions({
			renderer: new TerminalRenderer(options),
		})

		// Parse markdown and render with terminal-friendly formatting
		const rendered = parse(children) as string
		return <Text>{rendered.trim()}</Text>
	} catch (error) {
		// Fallback to plain text if markdown parsing fails
		return <Text>{children}</Text>
	}
}
