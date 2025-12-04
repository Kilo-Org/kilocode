import React from "react"
import { type UnifiedMessage } from "../../state/atoms/ui.js"
import { CliMessageRow } from "./cli/CliMessageRow.js"
import { ExtensionMessageRow } from "./extension/ExtensionMessageRow.js"
//import { logs } from "../../services/logs.js"

interface MessageRowProps {
	unifiedMessage: UnifiedMessage
}

export const MessageRow: React.FC<MessageRowProps> = ({ unifiedMessage }) => {
	if (unifiedMessage.source === "cli") {
		return <CliMessageRow message={unifiedMessage.message} />
	}
	return <ExtensionMessageRow message={unifiedMessage.message} />
}
