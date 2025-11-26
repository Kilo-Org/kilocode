import React from "react"
import { Box, Text } from "ink"
import { useAtomValue } from "jotai"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"
import { pendingOutputUpdatesAtom } from "../../../../state/atoms/effects.js"

export const AskCommandOutputMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const pendingUpdates = useAtomValue(pendingOutputUpdatesAtom)

	const icon = getMessageIcon("ask", "command_output")

	// Parse the message text to get initial command and executionId
	let executionId = ""
	let initialCommand = ""
	try {
		const data = JSON.parse(message.text || "{}")
		executionId = data.executionId || ""
		initialCommand = data.command || ""
	} catch {
		// If parsing fails, use text directly
		initialCommand = message.text || ""
	}

	// Get real-time output from pending updates (similar to webview's streamingOutput)
	const pendingUpdate = executionId ? pendingUpdates.get(executionId) : undefined
	const command = pendingUpdate?.command || initialCommand
	const output = pendingUpdate?.output || ""

	return (
		<Box flexDirection="column" marginY={1}>
			<Box>
				<Text color={theme.semantic.info} bold>
					{icon} Command Running
				</Text>
			</Box>

			{command && (
				<Box
					width={getBoxWidth(3)}
					marginLeft={2}
					marginTop={1}
					borderStyle="single"
					borderColor={theme.semantic.info}
					paddingX={1}>
					<Text color={theme.ui.text.primary}>{command}</Text>
				</Box>
			)}

			{output.trim() ? (
				<Box
					width={getBoxWidth(3)}
					marginLeft={2}
					marginTop={1}
					borderStyle="single"
					borderColor={theme.ui.text.dimmed}
					paddingX={1}>
					<Text color={theme.ui.text.primary}>
						{output.trim().length > 500 ? output.trim().slice(0, 500) + "\n..." : output.trim()}
					</Text>
				</Box>
			) : null}
		</Box>
	)
}
