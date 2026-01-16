import React from "react"
import { Box, Text, type TextProps } from "ink"
import type { ParsedDiffLine } from "../diff.js"
import type { useTheme } from "../../../../state/hooks/useTheme.js"
import type { HighlightedToken } from "../../../utils/syntaxHighlight.js"

// Background colors for diff lines - theme-aware
// Dark theme: subtle dark tints
// Light theme: subtle light tints
const DARK_THEME_ADDITION_BG = "#0d2818" // Very dark green
const DARK_THEME_DELETION_BG = "#2d1515" // Very dark red
const LIGHT_THEME_ADDITION_BG = "#d4edda" // Light green
const LIGHT_THEME_DELETION_BG = "#f8d7da" // Light red

/**
 * Render a single diff line with appropriate coloring and optional syntax highlighting
 */
export const DiffLine: React.FC<{
	line: ParsedDiffLine
	theme: ReturnType<typeof useTheme>
	showLineNumbers?: boolean
	highlightedTokens?: HighlightedToken[] | null
}> = ({ line, theme, showLineNumbers = true, highlightedTokens }) => {
	const isAddition = line.type === "addition"
	const isDeletion = line.type === "deletion"
	const isChange = isAddition || isDeletion
	const isLightTheme = theme.type === "light"

	// Select background colors based on theme
	const additionBg = isLightTheme ? LIGHT_THEME_ADDITION_BG : DARK_THEME_ADDITION_BG
	const deletionBg = isLightTheme ? LIGHT_THEME_DELETION_BG : DARK_THEME_DELETION_BG

	// Determine diff foreground color (used when no syntax highlighting)
	const diffFgColor = isAddition
		? theme.code.addition
		: isDeletion
			? theme.code.deletion
			: line.type === "header" || line.type === "marker"
				? theme.semantic.info
				: theme.code.context

	// Format line number display
	const oldNum = line.oldLineNum?.toString().padStart(4, " ") ?? "    "
	const newNum = line.newLineNum?.toString().padStart(4, " ") ?? "    "

	// Determine sign prefix
	const sign = isAddition ? "+" : isDeletion ? "-" : " "
	const signColor = isAddition ? theme.code.addition : isDeletion ? theme.code.deletion : theme.code.context

	// Skip line numbers for markers and headers
	if (line.type === "marker" || line.type === "header") {
		return (
			<Text color={diffFgColor} dimColor>
				{line.content}
			</Text>
		)
	}

	// Build text props conditionally to avoid undefined values
	const buildTextProps = (color: string, withBg: boolean): TextProps => {
		if (withBg && isAddition) {
			return { color, backgroundColor: additionBg }
		} else if (withBg && isDeletion) {
			return { color, backgroundColor: deletionBg }
		}
		return { color }
	}

	// Render content with syntax highlighting if available
	const renderContent = () => {
		if (highlightedTokens && highlightedTokens.length > 0) {
			return (
				<>
					{highlightedTokens.map((token, idx) => {
						const props = buildTextProps(token.color || diffFgColor, isChange)
						return (
							<Text key={idx} {...props}>
								{token.content}
							</Text>
						)
					})}
				</>
			)
		}

		// Fallback to plain text with diff color
		const props = buildTextProps(diffFgColor, isChange)
		return <Text {...props}>{line.content}</Text>
	}

	return (
		<Box>
			{showLineNumbers && (
				<Text color={theme.ui.text.dimmed} dimColor>
					{oldNum} {newNum}{" "}
				</Text>
			)}
			<Text {...buildTextProps(signColor, isChange)}>{sign} </Text>
			{renderContent()}
		</Box>
	)
}
