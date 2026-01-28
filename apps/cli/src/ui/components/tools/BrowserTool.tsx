import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import { Icon } from "../Icon.js"

import type { ToolRendererProps } from "./types.js"
import { getToolDisplayName, getToolIconName } from "./utils.js"

const ACTION_LABELS: Record<string, string> = {
	launch: "Launch Browser",
	click: "Click",
	hover: "Hover",
	type: "Type Text",
	press: "Press Key",
	scroll_down: "Scroll Down",
	scroll_up: "Scroll Up",
	resize: "Resize Window",
	close: "Close Browser",
	screenshot: "Take Screenshot",
}

export function BrowserTool({ toolData }: ToolRendererProps) {
	const iconName = getToolIconName(toolData.tool)
	const displayName = getToolDisplayName(toolData.tool)
	const action = toolData.action || ""
	const url = toolData.url || ""
	const coordinate = toolData.coordinate || ""
	const content = toolData.content || "" // May contain text for type action.

	const actionLabel = ACTION_LABELS[action] || action

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Header */}
			<Box>
				<Icon name={iconName} color={theme.toolHeader} />
				<Text bold color={theme.toolHeader}>
					{" "}
					{displayName}
				</Text>
				{action && (
					<Text color={theme.focusColor} bold>
						{" "}
						→ {actionLabel}
					</Text>
				)}
			</Box>

			{/* Action details */}
			<Box flexDirection="column" marginLeft={2}>
				{/* URL for launch action */}
				{url && (
					<Box>
						<Text color={theme.dimText}>url: </Text>
						<Text color={theme.text} underline>
							{url}
						</Text>
					</Box>
				)}

				{/* Coordinates for click/hover actions */}
				{coordinate && (
					<Box>
						<Text color={theme.dimText}>at: </Text>
						<Text color={theme.warningColor}>{coordinate}</Text>
					</Box>
				)}

				{/* Text content for type action */}
				{content && action === "type" && (
					<Box>
						<Text color={theme.dimText}>text: </Text>
						<Text color={theme.text}>"{content}"</Text>
					</Box>
				)}

				{/* Key for press action */}
				{content && action === "press" && (
					<Box>
						<Text color={theme.dimText}>key: </Text>
						<Text color={theme.successColor}>{content}</Text>
					</Box>
				)}
			</Box>
		</Box>
	)
}
