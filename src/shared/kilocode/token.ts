export const DEFAULT_KILOCODE_BACKEND_URL = "https://kilocode.ai"

const globalKilocodeBackendUrl: string =
	(typeof window !== "undefined" ? window : (process.env as any))?.KILOCODE_BACKEND_BASE_URL ??
	DEFAULT_KILOCODE_BACKEND_URL

export type KilocodeUrlOptions = {
	subdomain?: "api" | "app" | null
	path?: string
	queryParams?: Record<string, string>
	baseUrl?: string
}

/**
 * Centralized helper function to construct KiloCode URLs with consistent patterns
 * @param options Configuration for URL construction
 * @returns Fully constructed KiloCode URL
 */
export function getKilocodeUrl(options: KilocodeUrlOptions = {}): string {
	const { subdomain = null, path = "", queryParams = {}, baseUrl = globalKilocodeBackendUrl } = options
	const url = new URL(baseUrl ?? DEFAULT_KILOCODE_BACKEND_URL)

	if (subdomain) {
		url.hostname = `${subdomain}.${url.hostname}`
	}
	if (path) {
		url.pathname = path.startsWith("/") ? path : `/${path}`
	}
	Object.entries(queryParams).forEach(([key, value]) => {
		url.searchParams.set(key, value)
	})

	const finalUrl = url.toString().replace(/\/$/, "") // Remove trailing /s
	return finalUrl
}

export function getKiloBaseUriFromToken(kilocodeToken?: string) {
	if (kilocodeToken) {
		try {
			const payload_string = kilocodeToken.split(".")[1] ?? ""
			const payload_json =
				typeof atob !== "undefined" ? atob(payload_string) : Buffer.from(payload_string, "base64").toString()
			const payload = JSON.parse(payload_json)
			//note: this is UNTRUSTED, so we need to make sure we're OK with this being manipulated by an attacker; e.g. we should not read uri's from the JWT directly.
			if (payload.env === "development") return "http://localhost:3000"
		} catch (_error) {
			console.warn("Failed to get base URL from Kilo Code token")
		}
	}
	return getKilocodeUrl({ subdomain: "api" })
}
