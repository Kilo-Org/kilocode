import React from "react"

interface ChatTimestampsProps {
	ts: number
}

const ChatTimestamps: React.FC<ChatTimestampsProps> = ({ ts }) => {
	return (
		<span className="inline-flex items-end text-vscode-descriptionForeground font-normal">
			{new Date(ts).toLocaleTimeString([], {
				hour: "2-digit",
				minute: "2-digit",
			})}
		</span>
	)
}

export default ChatTimestamps
