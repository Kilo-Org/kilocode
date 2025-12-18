/**
 * Utility for building Roo Code documentation links with UTM telemetry.
 *
 * @param path - The path after the docs root (no leading slash)
 * @param campaign - The UTM campaign context (e.g. "welcome", "provider_docs", "tips", "error_tooltip")
 * @returns The full docs URL with UTM parameters
 */
// kilocode_change: unused campaign param
export function buildDocLink(path: string, _campaign: string): string {
	// Remove any leading slash from path
	const cleanPath = path
		.replace(/^\//, "")
		.replace("troubleshooting/shell-integration/", "features/shell-integration") // kilocode_change
	const [basePath, hash] = cleanPath.split("#")
	const baseUrl = `https://kilo.ai/docs/${basePath}`
	return hash ? `${baseUrl}#${hash}` : baseUrl
}
