import React from "react"
import { Box, Text } from "ink"
import type { ExtensionChatMessage } from "../../../types/messages.js"
import { ErrorBoundary } from "react-error-boundary"
import { AskMessageRouter } from "./AskMessageRouter.js"
import { SayMessageRouter } from "./SayMessageRouter.js"
import { useTheme } from "../../../state/hooks/useTheme.js"
import { getBoxWidth } from "../../utils/width.js"

interface ExtensionMessageRowProps {
	message: ExtensionChatMessage
}

function ErrorFallback({ error }: { error: Error }) {
	const theme = useTheme()
	return (
		<Box width={getBoxWidth(1)} borderColor={theme.semantic.error} borderStyle="round" padding={1} marginY={1}>
			<Text color={theme.semantic.error}>Error rendering message: {error.message}</Text>
		</Box>
	)
}

export const ExtensionMessageRow: React.FC<ExtensionMessageRowProps> = ({ message }) => {
	const theme = useTheme()

	return (
		<ErrorBoundary fallbackRender={ErrorFallback}>
			{message.type === "ask" ? (
				<AskMessageRouter message={message} />
			) : message.type === "say" ? (
				<SayMessageRouter message={message} />
			) : (
				<Box>
					<Text color={theme.ui.text.dimmed} dimColor>
						Unknown message type: {message.type}
					</Text>
				</Box>
			)}
		</ErrorBoundary>
	)
}
