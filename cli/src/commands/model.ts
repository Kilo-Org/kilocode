/**
 * /model command - View and manage AI models
 */

import type { Command, ArgumentProviderContext, CommandContext } from "./core/types.js"
import type { ModelInfo } from "../constants/providers/models.js"
import {
	getModelsByProvider,
	getCurrentModelId,
	sortModelsByPreference,
	formatModelInfo,
	fuzzyFilterModels,
	formatPrice,
	prettyModelName,
} from "../constants/providers/models.js"

/**
 * Ensure router models are loaded for the current provider
 */
async function ensureRouterModels(context: CommandContext): Promise<boolean> {
	const { currentProvider, routerModels, refreshRouterModels, addMessage } = context

	if (!currentProvider) {
		return false
	}

	// Check if provider needs router models
	const routerName = currentProvider.provider
	const needsRouterModels = [
		"kilocode",
		"openrouter",
		"ollama",
		"lmstudio",
		"litellm",
		"glama",
		"unbound",
		"requesty",
		"deepinfra",
		"io-intelligence",
		"vercel-ai-gateway",
		"ovhcloud",
	].includes(routerName)

	if (!needsRouterModels) {
		return true
	}

	// If router models aren't loaded, request them
	if (!routerModels) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Loading available models...",
			ts: Date.now(),
		})

		try {
			await refreshRouterModels()
			// Wait a bit for the models to be loaded
			await new Promise((resolve) => setTimeout(resolve, 1000))
			return true
		} catch (error) {
			addMessage({
				id: Date.now().toString(),
				type: "error",
				content: `Failed to load models: ${error instanceof Error ? error.message : String(error)}`,
				ts: Date.now(),
			})
			return false
		}
	}

	return true
}

/**
 * Show current model information
 */
async function showCurrentModel(context: CommandContext): Promise<void> {
	const { currentProvider, routerModels, kilocodeDefaultModel, addMessage } = context

	if (!currentProvider) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "No provider configured. Please configure a provider first.",
			ts: Date.now(),
		})
		return
	}

	// Ensure router models are loaded
	await ensureRouterModels(context)

	const currentModelId = getCurrentModelId({
		providerConfig: currentProvider,
		routerModels,
		kilocodeDefaultModel,
	})

	const { models } = getModelsByProvider({
		provider: currentProvider.provider,
		routerModels,
		kilocodeDefaultModel,
	})

	const modelInfo = models[currentModelId]
	const providerName = currentProvider.provider
		.split("-")
		.map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")

	let content = `**Current Configuration:**\n`
	content += `  Provider: ${providerName}\n`
	content += `  Model: ${currentModelId}\n`

	if (modelInfo) {
		if (modelInfo.displayName) {
			content += `  Display Name: ${modelInfo.displayName}\n`
		}
		if (modelInfo.contextWindow) {
			const contextK = Math.floor(modelInfo.contextWindow / 1000)
			content += `  Context Window: ${contextK}K tokens\n`
		}
		if (modelInfo.supportsImages) {
			content += `  Supports Images: Yes\n`
		}
		if (modelInfo.supportsPromptCache) {
			content += `  Supports Prompt Cache: Yes\n`
		}
	}

	const modelCount = Object.keys(models).length
	if (modelCount > 0) {
		content += `  Available Models: ${modelCount}\n`
	}

	content += `\n**Commands:**\n`
	content += `  /model info <model> - Show model details\n`
	content += `  /model select <model> - Switch to a different model\n`
	content += `  /model list [filter] - List all available models\n`

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})
}

/**
 * Show detailed model information
 */
async function showModelInfo(context: CommandContext, modelId: string): Promise<void> {
	const { currentProvider, routerModels, kilocodeDefaultModel, addMessage } = context

	if (!currentProvider) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "No provider configured.",
			ts: Date.now(),
		})
		return
	}

	// Ensure router models are loaded
	const modelsReady = await ensureRouterModels(context)
	if (!modelsReady) {
		return
	}

	const { models } = getModelsByProvider({
		provider: currentProvider.provider,
		routerModels,
		kilocodeDefaultModel,
	})

	const model = models[modelId]
	if (!model) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Model "${modelId}" not found for provider ${currentProvider.provider}.`,
			ts: Date.now(),
		})
		return
	}

	let content = `**Model: ${modelId}**\n`
	if (model.displayName) {
		content += `Display Name: ${model.displayName}\n`
	}
	content += `Provider: ${currentProvider.provider}\n\n`

	content += `**Capabilities:**\n`
	if (model.contextWindow) {
		const contextK = Math.floor(model.contextWindow / 1000)
		content += `  Context Window: ${contextK}K tokens\n`
	}
	if (model.maxTokens) {
		content += `  Max Output: ${model.maxTokens.toLocaleString()} tokens\n`
	}
	if (model.maxThinkingTokens) {
		content += `  Max Thinking: ${model.maxThinkingTokens.toLocaleString()} tokens\n`
	}
	content += `  Supports Images: ${model.supportsImages ? "Yes" : "No"}\n`
	content += `  Supports Computer Use: ${model.supportsComputerUse ? "Yes" : "No"}\n`
	content += `  Supports Prompt Cache: ${model.supportsPromptCache ? "Yes" : "No"}\n`
	if (model.supportsVerbosity) {
		content += `  Supports Verbosity: Yes\n`
	}
	if (model.supportsReasoningEffort) {
		content += `  Supports Reasoning Effort: Yes\n`
	}

	if (
		model.inputPrice !== undefined ||
		model.outputPrice !== undefined ||
		model.cacheWritesPrice !== undefined ||
		model.cacheReadsPrice !== undefined
	) {
		content += `\n**Pricing (per 1M tokens):**\n`
		if (model.inputPrice !== undefined) {
			content += `  Input: ${formatPrice(model.inputPrice)}\n`
		}
		if (model.outputPrice !== undefined) {
			content += `  Output: ${formatPrice(model.outputPrice)}\n`
		}
		if (model.cacheWritesPrice !== undefined) {
			content += `  Cache Writes: ${formatPrice(model.cacheWritesPrice)}\n`
		}
		if (model.cacheReadsPrice !== undefined) {
			content += `  Cache Reads: ${formatPrice(model.cacheReadsPrice)}\n`
		}
	}

	if (model.description) {
		content += `\n**Description:**\n${model.description}\n`
	}

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})
}

/**
 * Select a different model
 */
async function selectModel(context: CommandContext, modelId: string): Promise<void> {
	const { currentProvider, routerModels, kilocodeDefaultModel, updateProviderModel, addMessage } = context

	if (!currentProvider) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "No provider configured.",
			ts: Date.now(),
		})
		return
	}

	// Ensure router models are loaded
	const modelsReady = await ensureRouterModels(context)
	if (!modelsReady) {
		return
	}

	const { models } = getModelsByProvider({
		provider: currentProvider.provider,
		routerModels,
		kilocodeDefaultModel,
	})

	const model = models[modelId]
	if (!model) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Model "${modelId}" not found for provider ${currentProvider.provider}.`,
			ts: Date.now(),
		})
		return
	}

	try {
		await updateProviderModel(modelId)

		let content = `✓ Switched to **${modelId}**\n`
		if (model.displayName) {
			content += `  Display Name: ${model.displayName}\n`
		}
		content += `  Provider: ${currentProvider.provider}\n`
		if (model.contextWindow) {
			const contextK = Math.floor(model.contextWindow / 1000)
			content += `  Context Window: ${contextK}K tokens\n`
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
			content: `Failed to switch model: ${error instanceof Error ? error.message : String(error)}`,
			ts: Date.now(),
		})
	}
}

/**
 * List all available models
 */
async function listModels(context: CommandContext, filter?: string): Promise<void> {
	const { currentProvider, routerModels, kilocodeDefaultModel, addMessage } = context

	if (!currentProvider) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "No provider configured.",
			ts: Date.now(),
		})
		return
	}

	// Ensure router models are loaded
	const modelsReady = await ensureRouterModels(context)
	if (!modelsReady) {
		return
	}

	const currentModelId = getCurrentModelId({
		providerConfig: currentProvider,
		routerModels,
		kilocodeDefaultModel,
	})

	const { models } = getModelsByProvider({
		provider: currentProvider.provider,
		routerModels,
		kilocodeDefaultModel,
	})

	let modelIds = filter ? fuzzyFilterModels(models, filter) : Object.keys(models)
	modelIds = sortModelsByPreference(
		modelIds.reduce(
			(acc, id) => {
				const model = models[id]
				if (model) {
					acc[id] = model
				}
				return acc
			},
			{} as Record<string, ModelInfo>,
		),
	)

	if (modelIds.length === 0) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: filter ? `No models found matching "${filter}".` : "No models available for this provider.",
			ts: Date.now(),
		})
		return
	}

	const providerName = currentProvider.provider
		.split("-")
		.map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")

	let content = `**Available Models (${providerName})**`
	if (filter) {
		content += ` - Filtered by "${filter}"`
	}
	content += `:\n\n`

	for (const modelId of modelIds) {
		const model = models[modelId]
		if (!model) continue

		const isPreferred = Number.isInteger(model.preferredIndex)
		const isCurrent = modelId === currentModelId
		const prefix = isPreferred ? "⭐ " : "  "
		const suffix = isCurrent ? " (current)" : ""

		content += `${prefix}**${modelId}**${suffix}\n`

		if (model.displayName) {
			content += `   ${model.displayName}\n`
		}

		const info = formatModelInfo(modelId, model)
		if (info) {
			content += `   ${info}\n`
		}

		content += `\n`
	}

	content += `**Total:** ${modelIds.length} model${modelIds.length !== 1 ? "s" : ""}\n`
	content += `\nUse \`/model select <model>\` to switch models\n`
	content += `Use \`/model info <model>\` for detailed information\n`

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})
}

/**
 * Autocomplete provider for model names
 */
async function modelAutocompleteProvider(context: ArgumentProviderContext) {
	// Check if commandContext is available
	if (!context.commandContext) {
		return []
	}

	const { currentProvider, routerModels, kilocodeDefaultModel } = context.commandContext

	if (!currentProvider) {
		return []
	}

	const { models } = getModelsByProvider({
		provider: currentProvider.provider,
		routerModels: routerModels,
		kilocodeDefaultModel: kilocodeDefaultModel || "",
	})

	const sortedModelIds = sortModelsByPreference(models)

	return sortedModelIds
		.map((modelId) => {
			const model = models[modelId]
			if (!model) return null

			const displayName = model.displayName || prettyModelName(modelId)
			const info = formatModelInfo(modelId, model)

			return {
				value: modelId,
				title: displayName,
				description: info,
				matchScore: 1.0,
				highlightedValue: modelId,
			}
		})
		.filter((item): item is NonNullable<typeof item> => item !== null)
}

export const modelCommand: Command = {
	name: "model",
	aliases: ["mdl"],
	description: "View and manage AI models",
	usage: "/model [subcommand] [args]",
	examples: ["/model", "/model info claude-sonnet-4.5", "/model select gpt-4", "/model list", "/model list claude"],
	category: "settings",
	priority: 8,
	arguments: [
		{
			name: "subcommand",
			description: "Subcommand: info, select, list",
			required: false,
			values: [
				{ value: "info", description: "Show detailed model information" },
				{ value: "select", description: "Switch to a different model" },
				{ value: "list", description: "List all available models" },
			],
		},
		{
			name: "model-or-filter",
			description: "Model name (for info/select) or filter (for list)",
			required: false,
			conditionalProviders: [
				{
					condition: (context) => {
						const subcommand = context.getArgument("subcommand")
						return subcommand === "info" || subcommand === "select"
					},
					provider: modelAutocompleteProvider,
				},
			],
		},
	],
	handler: async (context) => {
		const { args } = context

		// No arguments - show current model
		if (args.length === 0) {
			await showCurrentModel(context)
			return
		}

		const subcommand = args[0]?.toLowerCase()
		if (!subcommand) {
			await showCurrentModel(context)
			return
		}

		// Handle subcommands
		switch (subcommand) {
			case "info":
				if (args.length < 2 || !args[1]) {
					context.addMessage({
						id: Date.now().toString(),
						type: "error",
						content: "Usage: /model info <model-name>",
						ts: Date.now(),
					})
					return
				}
				await showModelInfo(context, args[1])
				break

			case "select":
				if (args.length < 2 || !args[1]) {
					context.addMessage({
						id: Date.now().toString(),
						type: "error",
						content: "Usage: /model select <model-name>",
						ts: Date.now(),
					})
					return
				}
				await selectModel(context, args[1])
				break

			case "list": {
				const filter = args.length > 1 ? args[1] : undefined
				await listModels(context, filter)
				break
			}

			default:
				context.addMessage({
					id: Date.now().toString(),
					type: "error",
					content: `Unknown subcommand "${subcommand}". Available: info, select, list`,
					ts: Date.now(),
				})
		}
	},
}
