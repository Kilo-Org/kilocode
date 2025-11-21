// kilocode_change - Extract changelog loading logic for easier testing
/**
 * Loads the changelog markdown from the public directory
 * @returns Promise resolving to the changelog markdown content
 */
export async function loadChangelog(): Promise<string> {
	const response = await fetch("/changelog.md")
	if (!response.ok) {
		throw new Error(`Failed to fetch changelog: ${response.statusText}`)
	}
	return response.text()
}
