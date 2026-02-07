import React, { useMemo } from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { formatFilePath, getToolIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display file or directory deletion
 * Uses compact format: 🗑️ Delete(filename) or 🗑️ Delete(dirname) ⎿ X files, Y dirs
 */
export const ToolDeleteFileMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()

	// Format stats summary for directory deletion
	const statsSummary = useMemo(() => {
		if (!toolData.stats) {
			return null
		}

		const { files, directories, isComplete } = toolData.stats

		if (!isComplete) {
			return "scanning..."
		}

		const parts: string[] = []
		if (files > 0 || directories === 0) {
			parts.push(`${files} ${files === 1 ? "file" : "files"}`)
		}
		if (directories > 0) {
			parts.push(`${directories} ${directories === 1 ? "dir" : "dirs"}`)
		}

		return parts.length > 0 ? `⎿ ${parts.join(", ")}` : null
	}, [toolData.stats])

	const icon = getToolIcon("deleteFile")

	return (
		<Box flexDirection="column" marginY={1}>
			{/* Compact header: 🗑️ Delete(filename) ⎿ X files, Y dirs */}
			<Box>
				<Text color={theme.semantic.error} bold>
					{icon} Delete(
				</Text>
				<Text color={theme.semantic.error} bold>
					{formatFilePath(toolData.path || "")}
				</Text>
				<Text color={theme.semantic.error} bold>
					)
				</Text>
				{toolData.isOutsideWorkspace && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						⚠
					</Text>
				)}
				{statsSummary && (
					<Text color={theme.ui.text.dimmed} dimColor>
						{" "}
						{statsSummary}
					</Text>
				)}
			</Box>
		</Box>
	)
}
