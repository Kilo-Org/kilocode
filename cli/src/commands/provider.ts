/**
 * /provider command - View and manage providers
 */

import type { Command, ArgumentProviderContext, CommandContext } from "./core/types.js"
import { getProviderLabel } from "../constants/providers/labels.js"
import { getCurrentModelId } from "../constants/providers/models.js"
import { getModelIdForProvider } from "../config/mapper.js"

/**
 * Show current provider information
 */
async function showCurrentProvider(context: CommandContext): Promise<void> {
	const { config, currentProvider, routerModels, kilocodeDefaultModel, addMessage } = context

	if (!currentProvider) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "No provider configured. Please configure a provider first.",
			ts: Date.now(),
		})
		return
	}

	const providerLabel = getProviderLabel(currentProvider.provider)
	const totalProviders = config.providers.length

	let content = `**Current Provider:**\n`
	content += `  ID: ${currentProvider.id}\n`
	content += `  Type: ${providerLabel}\n`

	// Show model information if available
	const currentModelId = getCurrentModelId({
		providerConfig: currentProvider,
		routerModels,
		kilocodeDefaultModel,
	})

	if (currentModelId) {
		content += `  Model: ${currentModelId}\n`
	}

	content += `  Total Configured: ${totalProviders}\n`

	content += `\n**Commands:**\n`
	content += `  /provider list - List all configured providers\n`
	content += `  /provider select <provider-id> - Switch to a different provider\n`

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})
}

/**
 * List all configured providers
 */
async function listProviders(context: CommandContext): Promise<void> {
	const { config, currentProvider, addMessage } = context

	if (config.providers.length === 0) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "No providers configured. Please configure a provider first.",
			ts: Date.now(),
		})
		return
	}

	let content = `**Configured Providers:**\n\n`

	for (const provider of config.providers) {
		const isCurrent = currentProvider?.id === provider.id
		const prefix = isCurrent ? "⭐ " : "  "
		const suffix = isCurrent ? " (current)" : ""
		const providerLabel = getProviderLabel(provider.provider)

		content += `${prefix}**${provider.id}**${suffix}\n`
		content += `   Type: ${providerLabel}\n`

		// Show model information if available
		const modelInfo = getModelIdForProvider(provider)
		if (modelInfo) {
			content += `   Model: ${modelInfo}\n`
		}

		content += `\n`
	}

	content += `**Total:** ${config.providers.length} provider${config.providers.length !== 1 ? "s" : ""}\n`
	content += `\nUse \`/provider select <provider-id>\` to switch providers\n`

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})
}

/**
 * Select a different provider
 */
async function selectProvider(context: CommandContext, providerId: string): Promise<void> {
	const { config, addMessage, selectProvider: selectProviderFn } = context

	const provider = config.providers.find((p) => p.id === providerId)

	if (!provider) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Provider "${providerId}" not found. Use \`/provider list\` to see available providers.`,
			ts: Date.now(),
		})
		return
	}

	try {
		await selectProviderFn(providerId)

		const providerLabel = getProviderLabel(provider.provider)
		const modelInfo = getModelIdForProvider(provider)

		let content = `Switched to **${providerId}**\n`
		content += `Type: ${providerLabel}\n`

		if (modelInfo) {
			content += `Model: ${modelInfo}\n`
		}

		addMessage({
			id: Date.now().toString(),
			type: "system",
			content,
			ts: Date.now(),
		})
	} catch (error) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Failed to switch provider: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * Autocomplete provider for provider IDs
 */
async function providerAutocompleteProvider(context: ArgumentProviderContext) {
	// Check if commandContext is available
	if (!context.commandContext) {
		return []
	}

	const { config } = context.commandContext

	return config.providers.map((provider) => {
		const providerLabel = getProviderLabel(provider.provider)

		// Get model info if available
		const modelInfo = getModelIdForProvider(provider)
		const description = modelInfo ? `${providerLabel} - ${modelInfo}` : providerLabel

		return {
			value: provider.id,
			title: provider.id,
			description,
			matchScore: 1.0,
			highlightedValue: provider.id,
		}
	})
}

export const providerCommand: Command = {
	name: "provider",
	aliases: ["prov"],
	description: "View and manage providers",
	usage: "/provider [subcommand] [args]",
	examples: ["/provider", "/provider list", "/provider select my-anthropic"],
	category: "settings",
	priority: 8,
	arguments: [
		{
			name: "subcommand",
			description: "Subcommand: list, select",
			required: false,
			values: [
				{ value: "list", description: "List all configured providers" },
				{ value: "select", description: "Switch to a different provider" },
			],
		},
		{
			name: "provider-id",
			description: "Provider ID (for select)",
			required: false,
			provider: providerAutocompleteProvider,
			conditionalProviders: [
				{
					condition: (context) => {
						const subcommand = context.getArgument("subcommand")
						return subcommand === "select"
					},
					provider: providerAutocompleteProvider,
				},
			],
		},
	],
	handler: async (context) => {
		const { args } = context

		// No arguments - show current provider
		if (args.length === 0) {
			await showCurrentProvider(context)
			return
		}

		const subcommand = args[0]?.toLowerCase()
		if (!subcommand) {
			await showCurrentProvider(context)
			return
		}

		// Handle subcommands
		switch (subcommand) {
			case "list":
				await listProviders(context)
				break

			case "select":
				if (args.length < 2 || !args[1]) {
					context.addMessage({
						id: Date.now().toString(),
						type: "error",
						content: "Usage: /provider select <provider-id>",
						ts: Date.now(),
					})
					return
				}
				await selectProvider(context, args[1])
				break

			default:
				context.addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Unknown subcommand "${subcommand}". Available: list, select`,
					ts: Date.now(),
				})
		}
	},
}
