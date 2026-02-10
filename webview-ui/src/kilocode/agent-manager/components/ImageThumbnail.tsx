import React from "react"
import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import { vscode } from "../utils/vscode"

interface ImageThumbnailProps {
	src: string
	index: number
	onRemove: (index: number) => void
}

/**
 * Reusable image thumbnail component with remove button on hover.
 * Used in ChatInput and NewAgentForm for displaying pasted images.
 */
export const ImageThumbnail: React.FC<ImageThumbnailProps> = ({ src, index, onRemove }) => {
	const { t } = useTranslation("agentManager")

	return (
		<div className="relative group">
			<img
				src={src}
				alt={`Image ${index + 1}`}
				className="w-6 h-6 object-cover rounded cursor-pointer border border-vscode-input-border"
				onClick={() => vscode.postMessage({ type: "openImage", text: src })}
			/>
			<button
				onClick={() => onRemove(index)}
				className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-vscode-button-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
				aria-label={t("chatInput.removeImage")}>
				<X size={8} className="text-vscode-button-foreground" />
			</button>
		</div>
	)
}
