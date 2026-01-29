import { loadToken, loadCredentials, getCredentialsPath } from "@/lib/storage/index.js"
import { isTokenExpired, isTokenValid, getTokenExpirationDate } from "@/lib/auth/index.js"

export interface StatusOptions {
	verbose?: boolean
}

export interface StatusResult {
	authenticated: boolean
	expired?: boolean
	expiringSoon?: boolean
	userId?: string
	orgId?: string | null
	expiresAt?: Date
	createdAt?: Date
}

export async function status(options: StatusOptions = {}): Promise<StatusResult> {
	const { verbose = false } = options

	const token = await loadToken()

	if (!token) {
		console.log("✗ Not authenticated")
		console.log("")
		console.log("Run: roo auth login")
		return { authenticated: false }
	}

	const expiresAt = getTokenExpirationDate(token)
	const expired = !isTokenValid(token)
	const expiringSoon = isTokenExpired(token, 24 * 60 * 60) && !expired

	const credentials = await loadCredentials()
	const createdAt = credentials?.createdAt ? new Date(credentials.createdAt) : undefined

	if (expired) {
		console.log("✗ Authentication token expired")
		console.log("")
		console.log("Run: roo auth login")

		return {
			authenticated: false,
			expired: true,
			expiresAt: expiresAt ?? undefined,
		}
	}

	if (expiringSoon) {
		console.log("⚠ Expires soon; refresh with `roo auth login`")
	} else {
		console.log("✓ Authenticated")
	}

	if (expiresAt) {
		const remaining = getTimeRemaining(expiresAt)
		console.log(`  Expires:      ${formatDate(expiresAt)} (${remaining})`)
	}

	if (createdAt && verbose) {
		console.log(`  Created:      ${formatDate(createdAt)}`)
	}

	if (verbose) {
		console.log(`  Credentials:  ${getCredentialsPath()}`)
	}

	return {
		authenticated: true,
		expired: false,
		expiringSoon,
		expiresAt: expiresAt ?? undefined,
		createdAt,
	}
}

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}

function getTimeRemaining(date: Date): string {
	const now = new Date()
	const diff = date.getTime() - now.getTime()

	if (diff <= 0) {
		return "expired"
	}

	const days = Math.floor(diff / (1000 * 60 * 60 * 24))
	const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

	if (days > 0) {
		return `${days} day${days === 1 ? "" : "s"}`
	}

	return `${hours} hour${hours === 1 ? "" : "s"}`
}
