import React from "react"
import { Box, Text } from "ink"
import { Logo } from "../../components/Logo.js"
import type { WelcomeMessageOptions } from "../../../types/cli.js"
import { useTheme } from "../../../state/hooks/useTheme.js"
import { useAtomValue } from "jotai"
import { sessionIdAtom, sessionTitleAtom } from "../../../state/atoms/session.js"
import { stdout } from "process"

interface WelcomeMessageProps {
	options?: WelcomeMessageOptions | undefined
}

const DEFAULT_INSTRUCTIONS = [
	"Type a message to start chatting, or use /help to see available commands.",
	"Commands start with / (e.g., /help, /mode, /model)",
]

export const WelcomeMessage: React.FC<WelcomeMessageProps> = ({ options = {} }) => {
	const theme = useTheme()
	const sessionId = useAtomValue(sessionIdAtom)
	const sessionTitle = useAtomValue(sessionTitleAtom)
	const showInstructions = options.showInstructions !== false
	const instructions =
		options.instructions && options.instructions.length > 0 ? options.instructions : DEFAULT_INSTRUCTIONS
	const showParallelMessage = !!options.worktreeBranch
	const showSessionMessage = !!sessionId
	const contentHeight =
		12 + (showInstructions ? instructions.length : 0) + (showParallelMessage ? 1 : 0) + (showSessionMessage ? 1 : 0)
	const marginTop = options.clearScreen ? Math.max(0, (stdout?.rows || 0) - contentHeight) : 0

	return (
		<Box flexDirection="column" gap={1} marginTop={marginTop}>
			{/* Logo section - always shown */}
			<Logo />

			{/* Session message */}
			{showSessionMessage && (
				<Box flexDirection="column">
					<Text color={theme.ui.text.dimmed}>
						Session "{sessionTitle || "(untitled)"}" started: {sessionId}
					</Text>
				</Box>
			)}

			{/* Instructions section */}
			{showInstructions && (
				<Box flexDirection="column">
					{instructions.map((instruction, index) => (
						<Text key={index} color={theme.ui.text.dimmed}>
							{instruction}
						</Text>
					))}
				</Box>
			)}

			{/* Parallel mode message */}
			{showParallelMessage && (
				<Box flexDirection="column" gap={1}>
					<Text color={theme.ui.text.primary}>
						You are working on branch{" "}
						<Text bold color={theme.ui.text.highlight}>
							{options.worktreeBranch}
						</Text>{" "}
						in parallel mode. Changes will be committed when you /exit.
					</Text>
					<Box flexDirection="column">
						<Text color={theme.ui.text.primary}>
							In case of an error, your pending changes are saved in <Text bold>{options.workspace}</Text>
						</Text>
						<Text>Commits in that directory will be visible in your main repository directory.</Text>
					</Box>
				</Box>
			)}
		</Box>
	)
}
