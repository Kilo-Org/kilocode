import React from "react"
import { Box, Text } from "ink"
import type { ParsedDiffLine } from "../diff.js"
import type { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Render a single diff line with appropriate coloring
 */
export const DiffLine: React.FC<{
	line: ParsedDiffLine
	theme: ReturnType<typeof useTheme>
	showLineNumbers?: boolean
}> = ({ line, theme, showLineNumbers = true }) => {
	// Determine color based on line type
	const color =
		line.type === "addition"
			? theme.code.addition
			: line.type === "deletion"
				? theme.code.deletion
				: line.type === "header" || line.type === "marker"
					? theme.semantic.info
					: theme.code.context

	// Format line number display
	const oldNum = line.oldLineNum?.toString().padStart(4, " ") ?? "    "
	const newNum = line.newLineNum?.toString().padStart(4, " ") ?? "    "

	// Determine sign prefix
	const sign = line.type === "addition" ? "+" : line.type === "deletion" ? "-" : " "

	// Skip line numbers for markers and headers
	if (line.type === "marker" || line.type === "header") {
		return (
			<Text color={color} dimColor>
				{line.content}
			</Text>
		)
	}

	return (
		<Box>
			{showLineNumbers && (
				<Text color={theme.ui.text.dimmed} dimColor>
					{oldNum} {newNum}{" "}
				</Text>
			)}
			<Text color={color}>
				{sign} {line.content}
			</Text>
		</Box>
	)
}
