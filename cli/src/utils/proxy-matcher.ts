/**
 * Utility functions for matching URLs against NO_PROXY patterns
 */

/**
 * Parse NO_PROXY environment variable into an array of patterns
 */
export function parseNoProxy(noProxy: string | undefined): string[] {
	if (!noProxy) {
		return []
	}

	return noProxy
		.split(",")
		.map((pattern) => pattern.trim())
		.filter((pattern) => pattern.length > 0)
}

/**
 * Check if a hostname matches a NO_PROXY pattern
 */
export function shouldBypassProxy(url: string, noProxyPatterns: string[]): boolean {
	if (noProxyPatterns.length === 0) {
		return false
	}

	try {
		const urlObj = new URL(url)
		const hostname = urlObj.hostname.toLowerCase()
		const port = urlObj.port

		for (const pattern of noProxyPatterns) {
			const normalizedPattern = pattern.toLowerCase()

			// Check for wildcard pattern (*.example.com)
			if (normalizedPattern.startsWith("*.")) {
				const domain = normalizedPattern.slice(2)
				if (hostname === domain || hostname.endsWith("." + domain)) {
					return true
				}
			}
			// Check for exact match or subdomain match
			else if (normalizedPattern.startsWith(".")) {
				const domain = normalizedPattern.slice(1)
				if (hostname === domain || hostname.endsWith("." + domain)) {
					return true
				}
			}
			// Check for pattern with port
			else if (normalizedPattern.includes(":")) {
				const [patternHost, patternPort] = normalizedPattern.split(":")
				if (hostname === patternHost && port === patternPort) {
					return true
				}
			}
			// Check for exact hostname match
			else if (hostname === normalizedPattern) {
				return true
			}
			// Check if hostname ends with pattern (subdomain match)
			else if (hostname.endsWith("." + normalizedPattern)) {
				return true
			}
			// Check for IP address or CIDR range
			else if (isIpMatch(hostname, normalizedPattern)) {
				return true
			}
		}
	} catch {
		// Invalid URL, don't bypass proxy
		return false
	}

	return false
}

/**
 * Check if an IP address matches a pattern (including CIDR notation)
 */
function isIpMatch(hostname: string, pattern: string): boolean {
	// Simple IP exact match
	if (hostname === pattern) {
		return true
	}

	// Check for CIDR notation (e.g., 192.168.0.0/16)
	if (pattern.includes("/")) {
		return matchesCidr(hostname, pattern)
	}

	return false
}

/**
 * Check if an IP address matches a CIDR range
 */
function matchesCidr(ip: string, cidr: string): boolean {
	try {
		const parts = cidr.split("/")
		if (parts.length !== 2 || !parts[0] || !parts[1]) {
			return false
		}

		const range = parts[0]
		const bitsStr = parts[1]
		const mask = parseInt(bitsStr, 10)

		if (isNaN(mask) || mask < 0 || mask > 32) {
			return false
		}

		const ipNum = ipToNumber(ip)
		const rangeNum = ipToNumber(range)

		if (ipNum === null || rangeNum === null) {
			return false
		}

		const maskNum = (0xffffffff << (32 - mask)) >>> 0
		return (ipNum & maskNum) === (rangeNum & maskNum)
	} catch {
		return false
	}
}

/**
 * Convert IPv4 address to number
 */
function ipToNumber(ip: string): number | null {
	const parts = ip.split(".")
	if (parts.length !== 4) {
		return null
	}

	let num = 0
	for (let i = 0; i < 4; i++) {
		const partStr = parts[i]
		if (!partStr) {
			return null
		}
		const part = parseInt(partStr, 10)
		if (isNaN(part) || part < 0 || part > 255) {
			return null
		}
		num = (num << 8) + part
	}

	return num >>> 0
}
