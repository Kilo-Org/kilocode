import React from "react"

interface ImageProps {
	src: string
	alt: string
	width?: string
	height?: string
	caption?: string
}

export function Image({ src, alt, width, height, caption }: ImageProps) {
	const imgStyle: React.CSSProperties = {
		maxWidth: "100%",
		height: "auto",
	}

	if (width) imgStyle.width = width
	if (height) imgStyle.height = height

	const figureStyle: React.CSSProperties = {
		margin: "1.5rem 0",
		maxWidth: "100%",
		overflow: "hidden",
	}

	// If width is specified, apply it to the figure to constrain caption width
	if (width) {
		figureStyle.width = width
		figureStyle.maxWidth = "100%"
	}

	return (
		<figure style={figureStyle}>
			<img src={src} alt={alt} style={imgStyle} />
			{caption && (
				<figcaption
					style={{
						fontStyle: "italic",
						textAlign: "center",
						marginTop: "0.5rem",
						color: "var(--gray-600, #6b7280)",
						width: "100%",
					}}>
					{caption}
				</figcaption>
			)}
		</figure>
	)
}
