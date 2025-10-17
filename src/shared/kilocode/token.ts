/**
 * Helper function that combines token-based base URL resolution with URL construction.
 * Takes a token and a full URL, uses the token to get the appropriate base URL,
 * then constructs the final URL by replacing the domain in the target URL.
 *
 * @param kilocodeToken The KiloCode authentication token
 * @param targetUrl The target URL to transform
 * @returns Fully constructed KiloCode URL with proper backend mapping based on token
 */
export function getKiloUrlFromToken(kilocodeToken: string, targetUrl: string): string {
	const baseUrl = getKiloBaseUriFromToken(kilocodeToken)

	try {
		const target = new URL(targetUrl)
		const { protocol, hostname, port } = new URL(baseUrl)
		Object.assign(target, { protocol, hostname, port })
		return target.toString()
	} catch (error) {
		console.warn("Failed to parse URL in getKiloUrlFromToken:", targetUrl, error)
		return targetUrl
	}
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
	return "https://api.kilocode.ai"
}
