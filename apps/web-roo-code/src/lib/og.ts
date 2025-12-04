/**
 * Generate a dynamic OpenGraph image URL
 * @param title - The title to display on the OG image
 * @param description - Optional description to display (will be truncated to ~140 chars)
 * @returns Absolute URL to the dynamic OG image endpoint
 */
export function ogImageUrl(title: string, description?: string): string {
	const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://roocode.com"
	const params = new URLSearchParams()

	params.set("title", title)
	if (description) {
		params.set("description", description)
	}

	return `${baseUrl}/api/og?${params.toString()}`
}

/**
 * Generate OpenGraph metadata for a page with dynamic image
 * @param title - The page title
 * @param description - The page description
 * @returns OpenGraph metadata object with dynamic image
 */
export function getOgMetadata(title: string, description: string) {
	const imageUrl = ogImageUrl(title, description)

	return {
		title,
		description,
		images: [
			{
				url: imageUrl,
				width: 1200,
				height: 630,
				alt: title,
			},
		],
	}
}

/**
 * Generate Twitter metadata for a page with dynamic image
 * @param title - The page title
 * @param description - The page description
 * @returns Twitter metadata object with dynamic image
 */
export function getTwitterMetadata(title: string, description: string) {
	const imageUrl = ogImageUrl(title, description)

	return {
		card: "summary_large_image" as const,
		title,
		description,
		images: [imageUrl],
	}
}
