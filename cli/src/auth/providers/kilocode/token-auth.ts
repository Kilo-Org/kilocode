import inquirer from "inquirer"
import type { AuthResult } from "../../types.js"
import {
	getKilocodeProfile,
	getKilocodeDefaultModel,
	promptOrganizationSelection,
	INVALID_TOKEN_ERROR,
} from "./shared.js"
import { withRawMode } from "../../utils/terminal.js"

/**
 * Execute the manual token authentication flow
 * @returns Authentication result with provider config
 * @throws Error if authentication fails
 */
export async function authenticateWithToken(): Promise<AuthResult> {
	console.log("\n🔑 Manual Token Authentication\n")
	console.log("Please navigate to https://app.kilo.ai and copy your API key from the bottom of the page!\n")

	let kilocodeToken: string = ""
	let profileData
	let isValidToken = false

	// Loop until we get a valid token
	while (!isValidToken) {
		// Use withRawMode to ensure interactive prompts work correctly
		// (required for inquirer v13+ which uses @inquirer/prompts internally)
		const { token } = await withRawMode(() =>
			inquirer.prompt<{ token: string }>([
				{
					type: "password",
					name: "token",
					message: "API Key:",
					mask: true,
				},
			]),
		)

		kilocodeToken = token

		try {
			// Validate token by fetching profile
			profileData = await getKilocodeProfile(kilocodeToken)
			isValidToken = true
		} catch (error) {
			if (error instanceof Error && error.message === INVALID_TOKEN_ERROR) {
				console.error("\n❌ Invalid API key. Please check your key and try again.\n")
				// Loop will continue, prompting for token again
			} else {
				console.error("\n❌ Failed to validate API key. Please try again.\n")
				console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
				// Loop will continue, prompting for token again
			}
		}
	}

	// Token is valid, now handle organization selection
	let kilocodeOrganizationId: string | undefined
	if (profileData?.organizations && profileData.organizations.length > 0) {
		kilocodeOrganizationId = await promptOrganizationSelection(profileData.organizations)
	}

	// Fetch the default model from Kilocode API with organization context
	const kilocodeModel = await getKilocodeDefaultModel(kilocodeToken, kilocodeOrganizationId)

	// Return provider config
	return {
		providerConfig: {
			id: "default",
			provider: "kilocode",
			kilocodeToken,
			kilocodeModel,
			...(kilocodeOrganizationId && { kilocodeOrganizationId }),
		},
	}
}
