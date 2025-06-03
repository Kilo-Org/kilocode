export function getKiloBaseUriFromToken(kilocodeToken: string) {
	try {
		const payload_string = kilocodeToken.split(".")[1]
		const payload = JSON.parse(Buffer.from(payload_string, "base64").toString())
		//note: this is UNTRUSTED, so we need to make sure we're OK with this being manipulated by an attacker; e.g. we should not read uri's from the JWT directly.
		if (payload.env === "development") return "http://localhost:3000"
	} catch (_error) {
		console.warn("Failed to get base URL from Kilo Code token")
	}
	return "https://kilocode.ai"
}
