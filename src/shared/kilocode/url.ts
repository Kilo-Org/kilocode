export const DEFAULT_KILOCODE_BACKEND_URL = "https://kilocode.ai"

function getGlobalKilocodeBackendUrl(): string {
	return (
		(typeof window !== "undefined" ? (window as any).KILOCODE_BACKEND_BASE_URL : undefined) ||
		process.env.KILOCODE_BACKEND_BASE_URL ||
		DEFAULT_KILOCODE_BACKEND_URL
	)
}

function isLocalDevelopment(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1"
}

function removeTrailingSlashFromBaseUrl(url: string, pathname: string): string {
	return url.endsWith("/") && (pathname === "/" || pathname === "") ? url.slice(0, -1) : url
}

function ensureLeadingSlash(path: string): string {
	return path.startsWith("/") ? path : `/${path}`
}

/**
 * Gets the API base URL for the current environment.
 * In development: http://localhost:3000/api
 * In production: uses /api path structure
 */
export function getApiUrl(path: string = ""): string {
	try {
		const backend = new URL(getGlobalKilocodeBackendUrl())
		const result = new URL(backend)

		// Always use /api path structure (simpler than subdomain logic)
		result.pathname = `/api${path ? ensureLeadingSlash(path) : ""}`

		return removeTrailingSlashFromBaseUrl(result.toString(), result.pathname)
	} catch (error) {
		console.warn("Failed to build API URL:", path, error)
		return `https://kilocode.ai/api${path ? ensureLeadingSlash(path) : ""}`
	}
}

/**
 * Gets the app/web URL for the current environment.
 * In development: http://localhost:3000
 * In production: https://kilocode.ai
 */
export function getAppUrl(path: string = ""): string {
	try {
		const backend = new URL(getGlobalKilocodeBackendUrl())
		const result = new URL(backend)

		result.pathname = path ? ensureLeadingSlash(path) : ""

		return removeTrailingSlashFromBaseUrl(result.toString(), result.pathname)
	} catch (error) {
		console.warn("Failed to build app URL:", path, error)
		return `https://kilocode.ai${path ? ensureLeadingSlash(path) : ""}`
	}
}
