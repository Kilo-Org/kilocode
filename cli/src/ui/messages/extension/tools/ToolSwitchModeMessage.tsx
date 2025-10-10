import React from "react"
import { Box, Text } from "ink"
import type { ToolMessageProps } from "../types.js"
import { getToolIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"

/**
 * Display mode switching request
 */
export const ToolSwitchModeMessage: React.FC<ToolMessageProps> = ({ toolData }) => {
	const theme = useTheme()
	const icon = getToolIcon("switchMode")

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.ui.text.highlight} bold>
					{icon} Switch Mode
				</Text>
			</Box>

			<Box marginLeft={2} flexDirection="column">
				<Box>
					<Text color={theme.ui.text.dimmed} dimColor>
						To:{" "}
					</Text>
					<Text color={theme.semantic.info}>{toolData.mode || ""}</Text>
				</Box>
				{toolData.reason && (
					<Box marginTop={1}>
						<Text color={theme.ui.text.dimmed} dimColor>
							Reason:{" "}
						</Text>
						<Text color={theme.ui.text.primary}>{toolData.reason}</Text>
					</Box>
				)}
			</Box>
		</Box>
	)
}
