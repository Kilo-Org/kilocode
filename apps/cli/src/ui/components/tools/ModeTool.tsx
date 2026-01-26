import { Box, Text } from "ink"

import * as theme from "../../theme.js"
import { Icon } from "../Icon.js"

import type { ToolRendererProps } from "./types.js"
import { getToolIconName } from "./utils.js"

export function ModeTool({ toolData }: ToolRendererProps) {
	const iconName = getToolIconName(toolData.tool)
	const mode = toolData.mode || ""
	const isSwitch = toolData.tool.includes("switch") || toolData.tool.includes("Switch")

	return (
		<Box flexDirection="row" gap={1} paddingX={1} marginBottom={1}>
			<Icon name={iconName} color={theme.toolHeader} />
			{isSwitch && mode && (
				<Box gap={1}>
					<Text color={theme.dimText}>Switching to</Text>
					<Text color={theme.userHeader} bold>
						{mode}
					</Text>
					<Text color={theme.dimText}>mode</Text>
				</Box>
			)}
		</Box>
	)
}
