import { select } from "@inquirer/prompts"
import { loadConfig, saveConfig, CLIConfig } from "../config/index.js"
import { authProviders } from "./providers/index.js"
import { fetchRouterModels } from "../services/models/fetcher.js"
import {
	getModelsByProvider,
	providerSupportsModelList,
	getModelIdKey,
	sortModelsByPreference,
} from "../constants/providers/models.js"
import type { ProviderName } from "../types/messages.js"
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
		const selectedProvider = await withRawMode(() =>
			select({
				message: "Select an AI provider:",
				choices: providerChoices,
				loop: false,
				pageSize: process.stdout.rows ? Math.min(20, process.stdout.rows - 2) : 10,
			}),
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

		// Model Selection
		const providerId = authResult.providerConfig.provider as ProviderName

		let routerModels = null
		if (providerSupportsModelList(providerId)) {
			console.log("\nFetching available models...")
			try {
				routerModels = await fetchRouterModels(authResult.providerConfig)
			} catch (_) {
				console.warn("Failed to fetch models, using defaults if available.")
			}
		}

		const { models, defaultModel } = getModelsByProvider({
			provider: providerId,
			routerModels,
			kilocodeDefaultModel: "",
		})

		const modelIds = sortModelsByPreference(models)

		if (modelIds.length > 0) {
			const modelChoices = modelIds.map((id) => {
				const model = models[id]
				return {
					name: model?.displayName || id,
					value: id,
				}
			})

			const selectedModel = await withRawMode(() =>
				select({
					message: "Select a model to use:",
					choices: modelChoices,
					default: defaultModel,
					loop: false,
					pageSize: 10,
				}),
			)

			const modelKey = getModelIdKey(providerId)
			authResult.providerConfig[modelKey] = selectedModel
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
