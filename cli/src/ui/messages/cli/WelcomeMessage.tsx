import React from "react"
import { Box, Text } from "ink"
import { Logo } from "../../components/Logo.js"
import type { WelcomeMessageOptions } from "../../../types/cli.js"
import { useTheme } from "../../../state/hooks/useTheme.js"
import { stdout } from "process"

interface WelcomeMessageProps {
	options?: WelcomeMessageOptions | undefined
}

const DEFAULT_INSTRUCTIONS = [
	"Type a message to start chatting, or use /help to see available commands.",
	"Commands start with / (e.g., /help, /mode, /clear)",
]

export const WelcomeMessage: React.FC<WelcomeMessageProps> = ({ options = {} }) => {
	const theme = useTheme()
	const showInstructions = options.showInstructions !== false
	const instructions =
		options.instructions && options.instructions.length > 0 ? options.instructions : DEFAULT_INSTRUCTIONS
	const contentHeight = 12 + (showInstructions ? instructions.length : 0)
	const marginTop = options.clearScreen ? Math.max(0, (stdout?.rows || 0) - contentHeight) : 0

	return (
		<Box flexDirection="column" gap={2} marginTop={marginTop}>
			{/* Logo section - always shown */}
			<Logo />

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
		</Box>
	)
}
