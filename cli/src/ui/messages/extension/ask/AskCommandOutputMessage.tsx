import React from "react"
import { Box, Text } from "ink"
import { useAtomValue } from "jotai"
import type { MessageComponentProps } from "../types.js"
import { getMessageIcon } from "../utils.js"
import { useTheme } from "../../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../../utils/width.js"
import type { PendingOutputUpdate } from "../../../../state/atoms/effects.js"
import { pendingOutputUpdatesAtom } from "../../../../state/atoms/effects.js"

export const AskCommandOutputMessage: React.FC<MessageComponentProps> = ({ message }) => {
	const theme = useTheme()
	const pendingUpdates = useAtomValue(pendingOutputUpdatesAtom)

	const icon = getMessageIcon("ask", "command_output")

	// Parse the message text to get initial command and executionId
	let executionId = ""
	let initialCommand = ""
	let initialPid: number | undefined
	try {
		const data = JSON.parse(message.text || "{}")
		executionId = data.executionId || ""
		initialCommand = data.command || ""
		initialPid = typeof data.pid === "number" ? data.pid : undefined
	} catch {
		// If parsing fails, use text directly
		initialCommand = message.text || ""
	}

	// Get real-time output from pending updates (similar to webview's streamingOutput)
	const pendingUpdate: PendingOutputUpdate | undefined = executionId ? pendingUpdates.get(executionId) : undefined
	const command = pendingUpdate?.command || initialCommand
	const output = pendingUpdate?.output || ""
	const pid = pendingUpdate?.pid ?? initialPid

	return (
		<Box flexDirection="column" marginY={1}>
			<Box width={getBoxWidth(3)} justifyContent="space-between">
				<Text color={theme.semantic.info} bold>
					{icon} Command Running
				</Text>
				{typeof pid === "number" && <Text color={theme.ui.text.secondary}>PID: {pid}</Text>}
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
