import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display slash command execution
 */
export const ToolRunSlashCommandMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("runSlashCommand")

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.ui.text.highlight} bold>
					{icon} Run Slash Command
				</Text>
			</Box>

			<Box marginLeft={2} flexDirection="column">
				<Box>
					<Text color={theme.ui.text.dimmed} dimColor>
						Command:{" "}
					</Text>
					<Text color={theme.semantic.info}>/{toolData.command || ""}</Text>
				</Box>
				{toolData.args && (
					<Box>
						<Text color={theme.ui.text.dimmed} dimColor>
							Args:{" "}
						</Text>
						<Text color={theme.ui.text.primary}>{toolData.args}</Text>
					</Box>
				)}
				{toolData.description && (
					<Box marginTop={1}>
						<Text color={theme.ui.text.dimmed} dimColor>
							Description:{" "}
						</Text>
						<Text color={theme.ui.text.primary}>{toolData.description}</Text>
					</Box>
				)}
				{toolData.source && (
					<Box>
						<Text color={theme.ui.text.dimmed} dimColor>
							Source:{" "}
						</Text>
						<Text color={theme.ui.text.dimmed}>{toolData.source}</Text>
					</Box>
				)}
			</Box>
		</Box>
	)
}
