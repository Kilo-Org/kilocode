import React, { memo } from "react"
import { vscode } from "../utils/vscode"

interface MessageThumbnailsProps {
	images: string[]
	style?: React.CSSProperties
}

/**
 * Simple read-only thumbnails component for displaying images in messages.
 * Uses the agent manager's vscode utility to avoid conflicts with the main webview.
 */
const MessageThumbnails: React.FC<MessageThumbnailsProps> = ({ images, style }) => {
	const handleImageClick = (image: string) => {
		vscode.postMessage({ type: "openImage", text: image })
	}

	return (
		<div
			className="py-1"
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: 5,
				rowGap: 3,
				...style,
			}}>
			{images.map((image, index) => (
				<img
					key={index}
					src={image}
					alt={`Thumbnail ${index + 1}`}
					style={{
						width: 34,
						height: 34,
						objectFit: "cover",
						borderRadius: 4,
						cursor: "pointer",
					}}
					onClick={() => handleImageClick(image)}
				/>
			))}
		</div>
	)
}

export default memo(MessageThumbnails)
