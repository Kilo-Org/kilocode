import inquirer from "inquirer"
import { loadConfig, saveConfig, CLIConfig } from "../config/index.js"
import { authProviders } from "./providers/index.js"
import { withRawMode } from "./utils/terminal.js"

/**
 * Main authentication wizard
 * Prompts user to select a provider and executes the authentication flow
 */
export default async function authWizard(): Promise<void> {
	try {
		const config = await loadConfig()

		// Build provider choices for inquirer
		const providerChoices = authProviders.map((provider) => ({
			name: provider.name,
			value: provider.value,
		}))

		// Prompt user to select a provider
		// Use withRawMode to ensure arrow key navigation works in list prompts
		// (required for inquirer v13+ which uses @inquirer/prompts internally)
		const { selectedProvider } = await withRawMode(() =>
			inquirer.prompt<{ selectedProvider: string }>([
				{
					type: "list",
					name: "selectedProvider",
					message: "Please select which provider you would like to use:",
					choices: providerChoices,
					loop: false,
				},
			]),
		)

		// Find the selected provider
		const provider = authProviders.find((p) => p.value === selectedProvider)
		if (!provider) {
			throw new Error(`Provider not found: ${selectedProvider}`)
		}

		// Execute the provider's authentication flow
		let authResult
		try {
			authResult = await provider.authenticate()
		} catch (error) {
			// Check if this is a user cancellation (Ctrl+C)
			if (error instanceof Error && error.name === "ExitPromptError") {
				console.log("\n\n⚠️  Configuration cancelled by user.\n")
				process.exit(0)
			}
			console.error(`\n❌ Authentication failed: ${error instanceof Error ? error.message : String(error)}`)
			process.exit(1)
		}

		// Save the configuration
		const newConfig: CLIConfig = {
			...config.config,
			providers: [authResult.providerConfig],
		}

		await saveConfig(newConfig)
		console.log("\n✓ Configuration saved successfully!\n")
	} catch (error) {
		// Check if this is a user cancellation (Ctrl+C) at the provider selection stage
		if (error instanceof Error && error.name === "ExitPromptError") {
			console.log("\n\n⚠️  Configuration cancelled by user.\n")
			process.exit(0)
		}
		// Re-throw other errors
		throw error
	}
}
