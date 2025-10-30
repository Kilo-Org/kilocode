import React from "react"
import { Box } from "ink"
import type { CliMessage } from "../../../types/cli.js"
import { WelcomeMessage } from "./WelcomeMessage.js"
import { GenericCliMessage } from "./GenericCliMessage.js"
import { EmptyMessage } from "./EmptyMessage.js"

interface CliMessageRowProps {
	message: CliMessage
}

export const CliMessageRow: React.FC<CliMessageRowProps> = ({ message }) => {
	switch (message.type) {
		case "empty":
			return <EmptyMessage />
		case "welcome":
			return (
				<Box flexDirection="column" marginBottom={2} marginTop={2}>
					<WelcomeMessage options={message.metadata?.welcomeOptions} />
				</Box>
			)
		default:
			return <GenericCliMessage message={message} />
	}
}
