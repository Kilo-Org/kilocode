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

	return (
		<figure style={{ margin: "1.5rem 0", maxWidth: "100%", overflow: "hidden" }}>
			<img src={src} alt={alt} style={imgStyle} />
			{caption && (
				<figcaption
					style={{
						display: "table-caption",
						captionSide: "bottom",
						fontStyle: "italic",
						textAlign: "center",
						marginTop: "0.5rem",
						color: "var(--gray-600, #6b7280)",
					}}>
					{caption}
				</figcaption>
			)}
		</figure>
	)
}
