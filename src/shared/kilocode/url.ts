export const DEFAULT_KILOCODE_BACKEND_URL = "https://kilocode.ai"

function getGlobalKilocodeBackendUrl(): string {
	return (
		(typeof window !== "undefined" ? (window as any).KILOCODE_BACKEND_BASE_URL : undefined) ||
		process.env.KILOCODE_BACKEND_BASE_URL ||
		DEFAULT_KILOCODE_BACKEND_URL
	)
}

function extractSubdomain(hostname: string): string {
	const parts = hostname.split(".")
	return parts.length > 2 ? parts.slice(0, -2).join(".") : ""
}

function isLocalDevelopment(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1"
}

function removeTrailingSlashFromBaseUrl(url: string, pathname: string): string {
	return url.endsWith("/") && (pathname === "/" || pathname === "") ? url.slice(0, -1) : url
}

/**
 * Maps kilocode.ai URLs to the configured backend environment.
 * In development: maps subdomains to paths (api.kilocode.ai → localhost:3000/api)
 * In production: preserves subdomain structure (api.kilocode.ai → api.kilocode.ai)
 */
export function getKiloUrl(targetUrl: string = "https://kilocode.ai"): string {
	try {
		const target = new URL(targetUrl)

		if (!target.hostname.endsWith("kilocode.ai")) {
			return targetUrl
		}

		const backend = new URL(getGlobalKilocodeBackendUrl())
		const subdomain = extractSubdomain(target.hostname)
		const result = new URL(backend)

		if (isLocalDevelopment(backend.hostname)) {
			result.pathname = subdomain === "api" ? `/api${target.pathname}` : target.pathname
		} else {
			if (subdomain) {
				result.hostname = `${subdomain}.${backend.hostname}`
			}
			result.pathname = target.pathname
		}

		result.search = target.search
		result.hash = target.hash

		return removeTrailingSlashFromBaseUrl(result.toString(), result.pathname)
	} catch (error) {
		console.warn("Failed to parse URL in getKiloUrl:", targetUrl, error)
		return targetUrl
	}
}
