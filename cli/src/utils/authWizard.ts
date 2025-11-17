import inquirer from "inquirer"
import { loadConfig, saveConfig, CLIConfig } from "../config"
import openConfigFile from "../config/openConfig"
import wait from "../utils/wait"
import { getKilocodeDefaultModel } from "./getKilocodeDefaultModel.js"
import { getKilocodeProfile, INVALID_TOKEN_ERROR, type KilocodeProfileData } from "./getKilocodeProfile.js"

export default async function authWizard() {
	const config = await loadConfig()
	let providerSpecificConfig: Record<string, string> = {}

	const providerOptions = [
		{ name: "Kilo Code", value: "kilocode" },
		{ name: "zAI", value: "zai" },
		{ name: "Other", value: "other" },
	] as const
	type ProviderOption = (typeof providerOptions)[number]["value"]

	const { provider } = await inquirer.prompt<{ provider: ProviderOption; kilocodeToken: string }>([
		{
			type: "list",
			name: "provider",
			message: "Please select which provider you would like to use:",
			choices: providerOptions,
		},
	])

	switch (provider) {
		case "kilocode": {
			console.info(
				"\nPlease navigate to https://app.kilocode.ai and copy your API key from the bottom of the page!\n",
			)

			let kilocodeToken: string = ""
			let profileData: KilocodeProfileData | null = null
			let isValidToken = false

			// Loop until we get a valid token
			while (!isValidToken) {
				const { token } = await inquirer.prompt<{ token: string }>([
					{
						type: "password",
						name: "token",
						message: "API Key:",
					},
				])

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
			let kilocodeOrganizationId: string | undefined = undefined

			if (profileData?.organizations && profileData.organizations.length > 0) {
				// Build choices for account selection
				const accountChoices = [
					{ name: "Personal Account", value: "personal" },
					...profileData.organizations.map((org) => ({
						name: `${org.name} (${org.role})`,
						value: org.id,
					})),
				]

				const { accountType } = await inquirer.prompt<{ accountType: string }>([
					{
						type: "list",
						name: "accountType",
						message: "Select account type:",
						choices: accountChoices,
					},
				])

				// Store organization ID if not personal
				if (accountType !== "personal") {
					kilocodeOrganizationId = accountType
				}
			}

			// Fetch the default model from Kilocode API with organization context
			const kilocodeModel = await getKilocodeDefaultModel(kilocodeToken, kilocodeOrganizationId)

			// Save config including organizationId if selected
			providerSpecificConfig = {
				kilocodeToken,
				kilocodeModel,
				...(kilocodeOrganizationId && { kilocodeOrganizationId }),
			}
			break
		}
		case "zai": {
			const { zaiApiKey } = await inquirer.prompt<{ zaiApiKey: string }>([
				{
					type: "password",
					name: "zaiApiKey",
					message: "Please enter your zAI token:",
				},
			])
			providerSpecificConfig = { zaiApiKey }
			break
		}
		case "other": {
			console.info("Please manually add your provider setttings to the config file.")
			console.info(
				"Check out https://github.com/Kilo-Org/kilocode/blob/main/cli/docs/PROVIDER_CONFIGURATION.md to see potential configuration options",
			)
			await wait(1500)
			await openConfigFile()
			return
		}
	}

	const newConfig = {
		...config.config,
		providers: [
			{
				id: "default",
				provider,
				...providerSpecificConfig,
			},
		],
	}

	await saveConfig(newConfig as CLIConfig)
}
