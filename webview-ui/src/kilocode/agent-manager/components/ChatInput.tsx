import React from "react"
import { useTranslation } from "react-i18next"

interface ChatInputProps {
	sessionId: string
	disabled?: boolean
}

export const ChatInput: React.FC<ChatInputProps> = ({ disabled = false }) => {
	const { t } = useTranslation("agentManager")

	if (disabled) {
		return null
	}

	// Show placeholder when agent is "running" but we can't send messages
	return (
		<div className="chat-input-container">
			<div className="chat-input-disabled">
				<span>{t("chatInput.autonomous")}</span>
			</div>
		</div>
	)
}
