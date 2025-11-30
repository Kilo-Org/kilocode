import { getApiUrl } from "@roo-code/types"
import type { AuthResult, DeviceAuthInitiateResponse, DeviceAuthPollResponse } from "../../types.js"
import { poll, formatTimeRemaining } from "../../utils/polling.js"
import { openBrowser } from "../../utils/browser.js"
import { getKilocodeProfile, getKilocodeDefaultModel, promptOrganizationSelection } from "./shared.js"

const POLL_INTERVAL_MS = 3000

/**
 * Initiate device authorization flow
 * @returns Device authorization details
 * @throws Error if initiation fails
 */
async function initiateDeviceAuth(): Promise<DeviceAuthInitiateResponse> {
	const response = await fetch(getApiUrl(`/api/device-auth/codes`), {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
	})

	if (!response.ok) {
		if (response.status === 429) {
			throw new Error("Too many pending authorization requests. Please try again later.")
		}
		throw new Error(`Failed to initiate device authorization: ${response.status}`)
	}

	const data = await response.json()
	return data as DeviceAuthInitiateResponse
}

/**
 * Poll for device authorization status
 * @param code The verification code
 * @returns Poll response with status and optional token
 * @throws Error if polling fails
 */
async function pollDeviceAuth(code: string): Promise<DeviceAuthPollResponse> {
	const response = await fetch(getApiUrl(`/api/device-auth/codes/${code}`))

	if (response.status === 202) {
		// Still pending
		return { status: "pending" }
	}

	if (response.status === 403) {
		// Denied by user
		return { status: "denied" }
	}

	if (response.status === 410) {
		// Code expired
		return { status: "expired" }
	}

	if (!response.ok) {
		throw new Error(`Failed to poll device authorization: ${response.status}`)
	}

	const data = await response.json()
	return data as DeviceAuthPollResponse
}

/**
 * Execute the device authorization flow
 * @returns Authentication result with provider config
 * @throws Error if authentication fails
 */
export async function authenticateWithDeviceAuth(): Promise<AuthResult> {
	console.log("\n🔐 Starting browser-based authentication...\n")

	// Step 1: Initiate device auth
	let authData: DeviceAuthInitiateResponse
	try {
		authData = await initiateDeviceAuth()
	} catch (error) {
		throw new Error(`Failed to start authentication: ${error instanceof Error ? error.message : String(error)}`)
	}

	const { code, verificationUrl, expiresIn } = authData

	// Step 2: Display instructions and open browser
	console.log("Opening browser for authentication...")
	console.log(`Visit: ${verificationUrl}`)
	console.log(`\nVerification code: ${code}`)

	const browserOpened = await openBrowser(verificationUrl)
	if (!browserOpened) {
		console.log("\n⚠️  Could not open browser automatically. Please open the URL manually.")
	}

	console.log(
		`\nWaiting for authorization... ⏳ (expires in ${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")})\n`,
	)

	// Step 3: Poll for authorization
	const startTime = Date.now()
	const maxAttempts = Math.ceil((expiresIn * 1000) / POLL_INTERVAL_MS)

	let token: string
	let userEmail: string

	try {
		const result = await poll<DeviceAuthPollResponse>({
			interval: POLL_INTERVAL_MS,
			maxAttempts,
			pollFn: async () => {
				const pollResult = await pollDeviceAuth(code)

				// Update progress display
				const timeRemaining = formatTimeRemaining(startTime, expiresIn)
				process.stdout.write(`\rWaiting for authorization... ⏳ (${timeRemaining} remaining)`)

				if (pollResult.status === "approved") {
					// Success!
					return {
						continue: false,
						data: pollResult,
					}
				}

				if (pollResult.status === "denied") {
					return {
						continue: false,
						error: new Error("Authorization denied by user"),
					}
				}

				if (pollResult.status === "expired") {
					return {
						continue: false,
						error: new Error("Authorization code expired"),
					}
				}

				// Still pending, continue polling
				return {
					continue: true,
				}
			},
		})

		if (!result.token || !result.userEmail) {
			throw new Error("Invalid response from authorization server")
		}

		token = result.token
		userEmail = result.userEmail

		console.log(`\n\n✓ Authenticated as ${userEmail}\n`)
	} catch (error) {
		console.log("\n") // Clear the progress line
		throw new Error(`Authentication failed: ${error instanceof Error ? error.message : String(error)}`)
	}

	// Step 4: Fetch profile to get organizations
	let profileData
	try {
		profileData = await getKilocodeProfile(token)
	} catch (error) {
		throw new Error(`Failed to fetch profile: ${error instanceof Error ? error.message : String(error)}`)
	}

	// Step 5: Prompt for organization selection
	let kilocodeOrganizationId: string | undefined
	if (profileData.organizations && profileData.organizations.length > 0) {
		kilocodeOrganizationId = await promptOrganizationSelection(profileData.organizations)
	}

	// Step 6: Fetch default model
	const kilocodeModel = await getKilocodeDefaultModel(token, kilocodeOrganizationId)

	// Step 7: Return provider config
	return {
		providerConfig: {
			id: "default",
			provider: "kilocode",
			kilocodeToken: token,
			kilocodeModel,
			...(kilocodeOrganizationId && { kilocodeOrganizationId }),
		},
	}
}
