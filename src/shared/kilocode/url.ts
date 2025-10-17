export const DEFAULT_KILOCODE_BACKEND_URL = "https://kilocode.ai"

function getGlobalKilocodeBackendUrl(): string {
	return (
		(typeof window !== "undefined" ? (window as any).KILOCODE_BACKEND_BASE_URL : undefined) ||
		process.env.KILOCODE_BACKEND_BASE_URL ||
		DEFAULT_KILOCODE_BACKEND_URL
	)
}

/**
 * Centralized helper function to construct KiloCode URLs with consistent patterns.
 * Takes a full URL string and intelligently maps it to the configured backend URL.
 *
 * For production (kilocode.ai):
 * - api.kilocode.ai → api.kilocode.ai (API routes)
 * - app.kilocode.ai → app.kilocode.ai (App routes)
 * - kilocode.ai → kilocode.ai (Main app)
 *
 * For development (localhost:3000):
 * - api.kilocode.ai → localhost:3000/api/* (API routes mapped to /api path)
 * - app.kilocode.ai → localhost:3000/* (App routes at root)
 * - kilocode.ai → localhost:3000/* (Main app at root)
 *
 * @param targetUrl The target URL to transform (defaults to base kilocode.ai)
 * @returns Fully constructed KiloCode URL with proper backend mapping
 *
 * @example
 * // Simple base URL
 * getKiloUrl() // → "https://kilocode.ai" (or "http://localhost:3000" in dev)
 *
 * @example
 * // API endpoint
 * getKiloUrl("https://api.kilocode.ai/extension-config.json")
 * // → "http://localhost:3000/api/extension-config.json" (in dev)
 * // → "https://api.kilocode.ai/extension-config.json" (in prod)
 *
 * @example
 * // App route
 * getKiloUrl("https://app.kilocode.ai/profile")
 * // → "http://localhost:3000/profile" (in dev)
 * // → "https://app.kilocode.ai/profile" (in prod)
 */
export function getKiloUrl(targetUrl: string = "https://kilocode.ai"): string {
	try {
		const target = new URL(targetUrl)
		const backend = new URL(getGlobalKilocodeBackendUrl())

		// Check if we're dealing with a kilocode.ai URL
		if (!target.hostname.endsWith("kilocode.ai")) {
			// Not a kilocode URL, return as-is
			return targetUrl
		}

		// Extract subdomain from target (e.g., "api" from "api.kilocode.ai")
		const targetParts = target.hostname.split(".")
		const kilocodeParts = "kilocode.ai".split(".")

		let subdomain = ""
		if (targetParts.length > kilocodeParts.length) {
			// Extract subdomain(s) - everything before "kilocode.ai"
			subdomain = targetParts.slice(0, targetParts.length - kilocodeParts.length).join(".")
		}

		// Build the result URL
		const result = new URL(backend)

		// Handle subdomain mapping based on backend type
		const isLocalhost = backend.hostname === "localhost" || backend.hostname === "127.0.0.1"

		if (isLocalhost) {
			// For localhost, map subdomains to paths
			if (subdomain === "api") {
				// api.kilocode.ai/some/path → localhost:3000/api/some/path
				result.pathname = `/api${target.pathname}`
			} else {
				// app.kilocode.ai/profile or kilocode.ai/profile → localhost:3000/profile
				result.pathname = target.pathname
			}
		} else {
			// For production, preserve subdomain structure
			if (subdomain) {
				result.hostname = `${subdomain}.${backend.hostname}`
			}
			result.pathname = target.pathname
		}

		// Preserve search params and hash
		result.search = target.search
		result.hash = target.hash

		// Handle trailing slash - only remove for base URLs (no meaningful path)
		let finalUrl = result.toString()

		// Remove trailing slash only for base URLs like "https://kilocode.ai/" -> "https://kilocode.ai"
		// Keep trailing slash for paths like "/api/" or "/profile/"
		if (finalUrl.endsWith("/") && (result.pathname === "/" || result.pathname === "")) {
			finalUrl = finalUrl.slice(0, -1)
		}

		return finalUrl
	} catch (error) {
		console.warn("Failed to parse URL in getKiloUrl:", targetUrl, error)
		return targetUrl // Fallback to original URL if parsing fails
	}
}
