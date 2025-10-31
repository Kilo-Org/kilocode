import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display semantic codebase search
 */
export const ToolCodebaseSearchMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("codebaseSearch")

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.info} bold>
					{icon} Codebase Search
				</Text>
			</Box>

			<Box marginLeft={2} flexDirection="column">
				<Box>
					<Text color={theme.ui.text.dimmed} dimColor>
						Query:{" "}
					</Text>
					<Text color={theme.ui.text.primary}>{toolData.query || ""}</Text>
				</Box>
				{toolData.path && (
					<Box>
						<Text color={theme.ui.text.dimmed} dimColor>
							Path:{" "}
						</Text>
						<Text color={theme.semantic.info}>{toolData.path}</Text>
					</Box>
				)}
			</Box>
		</Box>
	)
}
