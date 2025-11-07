import { mentionRegexGlobal } from "@roo/context-mentions"

import { vscode } from "../../utils/vscode"

interface MentionProps {
	text?: string
	withShadow?: boolean
}

export const Mention = ({ text, withShadow = false }: MentionProps) => {
	if (!text) {
		return <>{text}</>
	}

	const parts = text.split(mentionRegexGlobal).map((part, index) => {
		if (index % 2 === 0) {
			// This is regular text.
			return part
		} else {
			// This is a mention.
			// For file paths (starting with /), display only the filename for better UI
			// This prevents multiline text issues when full paths are displayed
			let displayText = part
			if (part.startsWith("/") && !part.startsWith("//")) {
				// Extract just the filename from the path for display
				const pathSegments = part.split("/").filter((segment) => segment.length > 0)
				if (pathSegments.length > 0) {
					displayText = pathSegments[pathSegments.length - 1]
					// Unescape spaces for display
					displayText = displayText.replace(/\\ /g, " ")
				}
			}

			return (
				<span
					key={index}
					className={`${withShadow ? "mention-context-highlight-with-shadow" : "mention-context-highlight"} cursor-pointer`}
					onClick={() => vscode.postMessage({ type: "openMention", text: part })}>
					@{displayText}
				</span>
			)
		}
	})

	return <>{parts}</>
}
