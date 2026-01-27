export interface DecodedToken {
	iss: string
	sub: string
	exp: number
	iat: number
	nbf: number
	v: number
	r?: {
		u?: string
		o?: string
		t: string
	}
}

function decodeToken(token: string): DecodedToken | null {
	try {
		const parts = token.split(".")

		if (parts.length !== 3) {
			return null
		}

		const payload = parts[1]

		if (!payload) {
			return null
		}

		const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4)
		const decoded = Buffer.from(padded, "base64url").toString("utf-8")
		return JSON.parse(decoded) as DecodedToken
	} catch {
		return null
	}
}

export function isTokenExpired(token: string, bufferSeconds = 24 * 60 * 60): boolean {
	const decoded = decodeToken(token)

	if (!decoded?.exp) {
		return true
	}

	const expiresAt = decoded.exp
	const bufferTime = Math.floor(Date.now() / 1000) + bufferSeconds
	return expiresAt < bufferTime
}

export function isTokenValid(token: string): boolean {
	return !isTokenExpired(token, 0)
}

export function getTokenExpirationDate(token: string): Date | null {
	const decoded = decodeToken(token)

	if (!decoded?.exp) {
		return null
	}

	return new Date(decoded.exp * 1000)
}
