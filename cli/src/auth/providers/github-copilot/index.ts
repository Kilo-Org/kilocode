// kilocode_change - new file
import { githubCopilotDefaultModelId } from "@roo-code/types"
import * as readline from "readline"

import type { AuthProvider, AuthResult } from "../../types.js"
import { poll, formatTimeRemaining } from "../../utils/polling.js"
import { openBrowser } from "../../utils/browser.js"

// GitHub OAuth App Client ID for Kilo Code
// You can register your own at: https://github.com/settings/developers
const GITHUB_CLIENT_ID = "" // TODO: Replace with Kilo Code's own client ID

const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000

interface DeviceCodeResponse {
	device_code: string
	user_code: string
	verification_uri: string
	expires_in: number
	interval: number
}

interface AccessTokenResponse {
	access_token?: string
	error?: string
	interval?: number
}

function renderWaitingMessage(message: string): void {
	if (!process.stdout.isTTY) {
		return
	}

	readline.clearLine(process.stdout, 0)
	readline.cursorTo(process.stdout, 0)
	process.stdout.write(message)
}

function clearWaitingMessage(): void {
	if (!process.stdout.isTTY) {
		return
	}

	readline.clearLine(process.stdout, 0)
	readline.cursorTo(process.stdout, 0)
}

function startWaitingCountdown(startTime: number, expiresIn: number): () => void {
	const update = () => {
		const timeRemaining = formatTimeRemaining(startTime, expiresIn)
		renderWaitingMessage(`Waiting for authorization... ⏳ (${timeRemaining} remaining)`)
	}

	update()
	const timer = setInterval(update, 1000)

	return () => clearInterval(timer)
}

/**
 * Initiate GitHub OAuth Device Flow
 */
async function initiateDeviceAuth(): Promise<DeviceCodeResponse> {
	const response = await fetch("https://github.com/login/device/code", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: GITHUB_CLIENT_ID,
			scope: "read:user",
		}),
	})

	if (!response.ok) {
		throw new Error(`Failed to initiate device authorization: ${response.status}`)
	}

	return (await response.json()) as DeviceCodeResponse
}

/**
 * Poll for access token
 */
async function pollAccessToken(deviceCode: string): Promise<AccessTokenResponse> {
	const response = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			client_id: GITHUB_CLIENT_ID,
			device_code: deviceCode,
			grant_type: "urn:ietf:params:oauth:grant-type:device_code",
		}),
	})

	let payload: AccessTokenResponse
	try {
		payload = (await response.json()) as AccessTokenResponse
	} catch (error) {
		if (!response.ok) {
			throw new Error(`Failed to poll for access token: ${response.status}`)
		}
		const message = error instanceof Error ? error.message : String(error)
		throw new Error(`Failed to parse access token response: ${message}`)
	}

	if (!response.ok) {
		return payload
	}

	return payload
}

/**
 * Execute GitHub Copilot OAuth Device Flow authentication
 */
export async function authenticateWithGitHubCopilot(): Promise<AuthResult> {
	console.log("🔐 Starting GitHub Copilot authentication...")

	// Step 1: Get device code
	let deviceData: DeviceCodeResponse
	try {
		deviceData = await initiateDeviceAuth()
	} catch (error) {
		throw new Error(`Failed to start authentication: ${error instanceof Error ? error.message : String(error)}`)
	}

	const { device_code, user_code, verification_uri, expires_in, interval } = deviceData

	// Step 2: Display instructions and open browser
	console.log("Opening browser for GitHub authentication...")
	console.log(`Visit: ${verification_uri}`)
	console.log("")
	console.log(`Enter code: ${user_code}`)

	const browserOpened = await openBrowser(verification_uri)
	if (!browserOpened) {
		console.log("⚠️ Could not open browser automatically. Please open the URL manually.")
	}

	// Step 3: Poll for access token
	const startTime = Date.now()
	const pollInterval = (interval || 5) * 1000 + OAUTH_POLLING_SAFETY_MARGIN_MS
	const maxAttempts = Math.ceil((expires_in * 1000) / pollInterval)

	let accessToken: string
	let stopWaitingCountdown: (() => void) | null = null

	try {
		stopWaitingCountdown = startWaitingCountdown(startTime, expires_in)
		const result = await poll<AccessTokenResponse>({
			interval: pollInterval,
			maxAttempts,
			pollFn: async () => {
				const pollResult = await pollAccessToken(device_code)

				if (pollResult.access_token) {
					return { continue: false, data: pollResult }
				}

				if (pollResult.error === "authorization_pending") {
					return { continue: true }
				}

				if (pollResult.error === "slow_down") {
					// Wait extra time as requested
					await new Promise((resolve) => setTimeout(resolve, 5000))
					return { continue: true }
				}

				if (pollResult.error === "expired_token") {
					return { continue: false, error: new Error("Authorization code expired") }
				}

				if (pollResult.error === "access_denied") {
					return { continue: false, error: new Error("Authorization denied by user") }
				}

				if (pollResult.error) {
					return { continue: false, error: new Error(`GitHub OAuth error: ${pollResult.error}`) }
				}

				return { continue: true }
			},
		})

		if (!result.access_token) {
			throw new Error("No access token received")
		}

		accessToken = result.access_token
		clearWaitingMessage()
		process.stdout.write("\n")
		console.log("✓ GitHub Copilot authentication successful!")
	} catch (error) {
		clearWaitingMessage()
		console.log("")
		throw new Error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`)
	} finally {
		stopWaitingCountdown?.()
	}

	return {
		providerConfig: {
			id: "default",
			provider: "github-copilot",
			githubCopilotToken: accessToken,
			githubCopilotModelId: githubCopilotDefaultModelId,
		},
	}
}

/**
 * GitHub Copilot authentication provider
 */
export const githubCopilotAuthProvider: AuthProvider = {
	name: "GitHub Copilot (OAuth)",
	value: "github-copilot",
	authenticate: authenticateWithGitHubCopilot,
}
