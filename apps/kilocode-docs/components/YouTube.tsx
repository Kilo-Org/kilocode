import React from "react"

interface YouTubeProps {
	url: string
	title?: string
	caption?: string
}

/**
 * Extracts the YouTube video ID from various URL formats
 */
function extractVideoId(url: string): string | null {
	const patterns = [
		/(?:youtube\.com\/watch\?v=)([^&\s]+)/,
		/(?:youtube\.com\/embed\/)([^?\s]+)/,
		/(?:youtu\.be\/)([^?\s]+)/,
		/(?:youtube\.com\/v\/)([^?\s]+)/,
	]

	for (const pattern of patterns) {
		const match = url.match(pattern)
		if (match) {
			return match[1]
		}
	}

	return null
}

export function YouTube({ url, title = "YouTube video", caption }: YouTubeProps) {
	const videoId = extractVideoId(url)

	if (!videoId) {
		return (
			<div
				style={{
					padding: "1rem",
					backgroundColor: "var(--red-100, #fee2e2)",
					color: "var(--red-700, #b91c1c)",
					borderRadius: "0.5rem",
					margin: "1.5rem 0",
				}}>
				Invalid YouTube URL: {url}
			</div>
		)
	}

	return (
		<div
			style={{
				maxWidth: "640px",
				margin: "1.5rem 0",
			}}>
			<div
				style={{
					position: "relative",
					paddingBottom: "56.25%", // 16:9 aspect ratio
					height: 0,
					overflow: "hidden",
					borderRadius: "0.5rem",
				}}>
				<iframe
					src={`https://www.youtube.com/embed/${videoId}`}
					title={title}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						width: "100%",
						height: "100%",
						border: "none",
						borderRadius: "0.5rem",
					}}
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
					allowFullScreen
				/>
			</div>
			{caption && (
				<figcaption
					style={{
						fontStyle: "italic",
						textAlign: "center",
						marginTop: "0.5rem",
						color: "var(--gray-600, #6b7280)",
					}}>
					{caption}
				</figcaption>
			)}
		</div>
	)
}
