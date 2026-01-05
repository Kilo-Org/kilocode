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

	let content: React.ReactNode
	if (message.type === "ask") {
		content = <AskMessageRouter message={message} />
	} else if (message.type === "say") {
		content = <SayMessageRouter message={message} />
	} else {
		content = (
			<Box marginY={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					Unknown message type: {message.type}
				</Text>
				{message.text && (
					<Box marginTop={1}>
						<Text color={theme.ui.text.dimmed}>{message.text}</Text>
					</Box>
				)}
			</Box>
		)
	}

	return <ErrorBoundary fallbackRender={ErrorFallback}>{content}</ErrorBoundary>
}
