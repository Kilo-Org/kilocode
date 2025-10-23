import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon, formatFilePath } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"

/**
 * Display file reading (single or batch)
 */
export const ToolReadFileMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("readFile")
	const isBatch = toolData.batchFiles && toolData.batchFiles.length > 0

	if (isBatch) {
		const totalFiles = toolData.batchFiles!.length + (toolData.additionalFileCount || 0)
		return (
			<Box
				width={getBoxWidth(1)}
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.messages.user}
				paddingX={1}
				marginY={1}>
				<Box>
					<Text color={theme.messages.user} bold>
						{icon} Read Files ({totalFiles} files)
					</Text>
				</Box>
				<Box flexDirection="column" marginTop={1}>
					{toolData.batchFiles!.map((file, index) => (
						<Text key={index} color={theme.semantic.info}>
							- {formatFilePath(file.path)}
						</Text>
					))}
					{toolData.additionalFileCount && toolData.additionalFileCount > 0 && (
						<Text color={theme.ui.text.dimmed} dimColor>
							... and {toolData.additionalFileCount} more files
						</Text>
					)}
				</Box>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.messages.user} bold>
					{icon} Read File
				</Text>
			</Box>
			<Box marginLeft={2}>
				<Text color={theme.semantic.info}>{formatFilePath(toolData.path || "")}</Text>
				{toolData.isOutsideWorkspace && (
					<Text color={theme.semantic.warning} dimColor>
						{" "}
						⚠ Outside workspace
					</Text>
				)}
			</Box>
			{toolData.reason && (
				<Box marginLeft={2}>
					<Text color={theme.ui.text.dimmed} dimColor>
						Reason: {toolData.reason}
					</Text>
				</Box>
			)}
		</Box>
	)
}
