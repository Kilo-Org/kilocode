/**
 * /model command - View and manage AI models
 */

import type { Command, ArgumentProviderContext, CommandContext } from "./core/types.js"
import type { ProviderConfig } from "../config/types.js"
import type { RouterModels } from "../types/messages.js"
import {
	type ModelRecord,
	getModelsByProvider,
	getCurrentModelId,
	sortModelsByPreference,
	formatModelInfo,
	fuzzyFilterModels,
	formatPrice,
	prettyModelName,
} from "../constants/providers/models.js"
import { MODEL_LIST_PAGE_SIZE, type ModelListFilters } from "../state/atoms/modelList.js"

/**
 * Sort options for model list
 */
const MODEL_SORT_OPTIONS: Record<string, string> = {
	name: "name",
	context: "context",
	price: "price",
	preferred: "preferred",
}

/**
 * Filter options for model list
 */
const MODEL_FILTER_OPTIONS = ["images", "cache", "reasoning", "free", "all"]

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
		"nano-gpt",
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
 * Sort models by different criteria
 */
function sortModels(models: ModelRecord, sortBy: string): string[] {
	const modelIds = Object.keys(models)

	switch (sortBy) {
		case "name":
			return modelIds.sort((a, b) => a.localeCompare(b))
		case "context":
			return modelIds.sort((a, b) => (models[b]?.contextWindow || 0) - (models[a]?.contextWindow || 0))
		case "price":
			return modelIds.sort((a, b) => {
				const priceA = models[a]?.inputPrice ?? Infinity
				const priceB = models[b]?.inputPrice ?? Infinity
				return priceA - priceB
			})
		case "preferred":
		default:
			return sortModelsByPreference(models)
	}
}

/**
 * Filter models by capabilities
 */
function filterModelsByCapabilities(models: ModelRecord, capabilities: string[]): string[] {
	if (capabilities.length === 0) {
		return Object.keys(models)
	}

	return Object.keys(models).filter((id) => {
		const model = models[id]
		if (!model) return false

		return capabilities.every((cap) => {
			switch (cap) {
				case "images":
					return model.supportsImages === true
				case "cache":
					return model.supportsPromptCache === true
				case "reasoning":
					return (
						model.supportsReasoningEffort === true ||
						model.supportsReasoningBudget === true ||
						(Array.isArray(model.supportsReasoningEffort) && model.supportsReasoningEffort.length > 0)
					)
				case "free":
					// Consider a model free if it has isFree flag OR if both input and output prices are 0
					return (
						model.isFree === true ||
						(model.inputPrice !== undefined &&
							model.outputPrice !== undefined &&
							model.inputPrice === 0 &&
							model.outputPrice === 0)
					)
				default:
					return true
			}
		})
	})
}

/**
 * Paginate model list
 */
function paginateModels(
	modelIds: string[],
	pageIndex: number,
	pageSize: number = MODEL_LIST_PAGE_SIZE,
): {
	pageIds: string[]
	pageCount: number
	totalCount: number
} {
	const totalCount = modelIds.length
	if (totalCount === 0) {
		return { pageIds: [], pageCount: 0, totalCount: 0 }
	}
	const pageCount = Math.ceil(totalCount / pageSize)
	const start = pageIndex * pageSize
	const pageIds = modelIds.slice(start, start + pageSize)

	return { pageIds, pageCount, totalCount }
}
/**
 * Get filtered model IDs and page count based on current filters
 * This helper avoids duplication in pagination functions
 */
function getFilteredModelsWithPageCount(params: {
	currentProvider: ProviderConfig
	routerModels: RouterModels | null
	kilocodeDefaultModel: string
	filters: {
		search?: string | undefined
		capabilities: ("images" | "cache" | "reasoning" | "free")[]
	}
}): {
	models: ModelRecord
	modelIds: string[]
	pageCount: number
	totalCount: number
} {
	const { currentProvider, routerModels, kilocodeDefaultModel, filters } = params

	const { models } = getModelsByProvider({
		provider: currentProvider.provider,
		routerModels,
		kilocodeDefaultModel,
	})

	// Apply search filter
	let modelIds = filters.search ? fuzzyFilterModels(models, filters.search) : Object.keys(models)

	// Apply capability filters
	modelIds = filterModelsByCapabilities(
		modelIds.reduce((acc, id) => {
			const model = models[id]
			if (model) {
				acc[id] = model
			}
			return acc
		}, {} as ModelRecord),
		filters.capabilities,
	)

	const { pageCount, totalCount } = paginateModels(modelIds, 0)

	return { models, modelIds, pageCount, totalCount }
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

		let content = `Switched to **${modelId}**\n`
		if (model.displayName) {
			content += `Display Name: ${model.displayName}\n`
		}
		content += `Provider: ${currentProvider.provider}\n`
		if (model.contextWindow) {
			const contextK = Math.floor(model.contextWindow / 1000)
			content += `Context Window: ${contextK}K tokens\n`
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
 * List all available models with pagination
 */
async function listModels(
	context: CommandContext,
	pageIndexOverride?: number,
	filtersOverride?: { sort?: string; capabilities?: string[]; search?: string | undefined },
): Promise<void> {
	const { currentProvider, routerModels, kilocodeDefaultModel, addMessage, modelListPageIndex, modelListFilters } =
		context

	// Use overrides if provided, otherwise use context values
	const effectivePageIndex = pageIndexOverride !== undefined ? pageIndexOverride : modelListPageIndex
	const effectiveFilters = filtersOverride ? { ...modelListFilters, ...filtersOverride } : modelListFilters

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

	// Apply search filter from stored filters
	const effectiveSearch = effectiveFilters.search
	let modelIds = effectiveSearch ? fuzzyFilterModels(models, effectiveSearch) : Object.keys(models)

	// Apply capability filters
	modelIds = filterModelsByCapabilities(
		modelIds.reduce((acc, id) => {
			const model = models[id]
			if (model) {
				acc[id] = model
			}
			return acc
		}, {} as ModelRecord),
		effectiveFilters.capabilities,
	)

	// Apply sorting
	modelIds = sortModels(
		modelIds.reduce((acc, id) => {
			const model = models[id]
			if (model) {
				acc[id] = model
			}
			return acc
		}, {} as ModelRecord),
		effectiveFilters.sort,
	)

	if (modelIds.length === 0) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: effectiveSearch
				? `No models found matching "${effectiveSearch}".`
				: "No models available for this provider.",
			ts: Date.now(),
		})
		return
	}

	// Paginate results
	const { pageIds, pageCount, totalCount } = paginateModels(modelIds, effectivePageIndex)

	const providerName = currentProvider.provider
		.split("-")
		.map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")

	let content = `**Available Models (${providerName})** - Page ${effectivePageIndex + 1}/${pageCount}\n`

	// Show active filters
	const filterParts: string[] = []
	if (effectiveFilters.sort !== "preferred") {
		filterParts.push(`Sort: ${effectiveFilters.sort}`)
	}
	if (effectiveFilters.capabilities.length > 0) {
		filterParts.push(`Filter: ${effectiveFilters.capabilities.join(", ")}`)
	}
	if (effectiveSearch) {
		filterParts.push(`Search: "${effectiveSearch}"`)
	}
	if (filterParts.length > 0) {
		content += filterParts.join(" | ") + "\n"
	}
	content += `\n`

	for (const modelId of pageIds) {
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

	const start = effectivePageIndex * MODEL_LIST_PAGE_SIZE + 1
	const end = Math.min((effectivePageIndex + 1) * MODEL_LIST_PAGE_SIZE, totalCount)
	content += `**Showing ${start}-${end} of ${totalCount} model${totalCount !== 1 ? "s" : ""}**\n\n`

	// Show navigation hints
	if (pageCount > 1) {
		if (effectivePageIndex < pageCount - 1) {
			content += `Use \`/model list next\` for next page\n`
		}
		if (effectivePageIndex > 0) {
			content += `Use \`/model list prev\` for previous page\n`
		}
		content += `Use \`/model list page <n>\` to go to a specific page\n`
	}
	content += `Use \`/model list sort <option>\` to change sort order\n`
	content += `Use \`/model list filter <option>\` to filter by capability\n`

	addMessage({
		id: Date.now().toString(),
		type: "system",
		content,
		ts: Date.now(),
	})
}

/**
 * Change to a specific page
 */
async function listModelsPage(context: CommandContext, pageNum: string): Promise<void> {
	const { currentProvider, routerModels, kilocodeDefaultModel, addMessage, changeModelListPage, modelListFilters } =
		context

	if (!currentProvider) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "No provider configured.",
			ts: Date.now(),
		})
		return
	}

	const pageIndex = parseInt(pageNum, 10) - 1 // Convert to 0-based index

	if (isNaN(pageIndex) || pageIndex < 0) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "Invalid page number. Must be a positive number.",
			ts: Date.now(),
		})
		return
	}

	// Get total page count
	const { pageCount } = getFilteredModelsWithPageCount({
		currentProvider,
		routerModels,
		kilocodeDefaultModel,
		filters: modelListFilters,
	})

	if (pageIndex >= pageCount) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Invalid page number. Must be between 1 and ${pageCount}.`,
			ts: Date.now(),
		})
		return
	}

	changeModelListPage(pageIndex)
	await listModels(context, pageIndex)
}

/**
 * Go to next page
 */
async function listModelsNext(context: CommandContext): Promise<void> {
	const {
		currentProvider,
		routerModels,
		kilocodeDefaultModel,
		addMessage,
		changeModelListPage,
		modelListPageIndex,
		modelListFilters,
	} = context

	if (!currentProvider) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: "No provider configured.",
			ts: Date.now(),
		})
		return
	}

	// Get total page count
	const { pageCount } = getFilteredModelsWithPageCount({
		currentProvider,
		routerModels,
		kilocodeDefaultModel,
		filters: modelListFilters,
	})

	if (modelListPageIndex >= pageCount - 1) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Already on the last page.",
			ts: Date.now(),
		})
		return
	}

	const newPageIndex = modelListPageIndex + 1
	changeModelListPage(newPageIndex)
	await listModels(context, newPageIndex)
}

/**
 * Go to previous page
 */
async function listModelsPrev(context: CommandContext): Promise<void> {
	const { addMessage, changeModelListPage, modelListPageIndex } = context

	if (modelListPageIndex <= 0) {
		addMessage({
			id: Date.now().toString(),
			type: "system",
			content: "Already on the first page.",
			ts: Date.now(),
		})
		return
	}

	const newPageIndex = modelListPageIndex - 1
	changeModelListPage(newPageIndex)
	await listModels(context, newPageIndex)
}

/**
 * Change sort order
 */
async function listModelsSort(context: CommandContext, sortOption: string): Promise<void> {
	const { addMessage, updateModelListFilters } = context

	const validSorts = Object.keys(MODEL_SORT_OPTIONS)
	const mappedSort = MODEL_SORT_OPTIONS[sortOption]

	if (!mappedSort) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Invalid sort option. Valid options: ${validSorts.join(", ")}`,
			ts: Date.now(),
		})
		return
	}

	const newSort = mappedSort as "name" | "context" | "price" | "preferred"
	updateModelListFilters({ sort: newSort })
	await listModels(context, undefined, { sort: newSort })
}

/**
 * Change filter
 */
async function listModelsFilter(context: CommandContext, filterOption: string): Promise<void> {
	const { addMessage, updateModelListFilters, modelListFilters } = context

	if (!MODEL_FILTER_OPTIONS.includes(filterOption)) {
		addMessage({
			id: Date.now().toString(),
			type: "error",
			content: `Invalid filter option. Valid options: ${MODEL_FILTER_OPTIONS.join(", ")}`,
			ts: Date.now(),
		})
		return
	}

	let newCapabilities: ("images" | "cache" | "reasoning" | "free")[]

	if (filterOption === "all") {
		// Clear all filters
		newCapabilities = []
		updateModelListFilters({ capabilities: [] })
	} else {
		// Toggle the filter
		const currentCapabilities = modelListFilters.capabilities
		const capability = filterOption as "images" | "cache" | "reasoning" | "free"

		if (currentCapabilities.includes(capability)) {
			// Remove filter
			newCapabilities = currentCapabilities.filter((c) => c !== capability)
			updateModelListFilters({ capabilities: newCapabilities })
		} else {
			// Add filter
			newCapabilities = [...currentCapabilities, capability]
			updateModelListFilters({ capabilities: newCapabilities })
		}
	}

	await listModels(context, undefined, { capabilities: newCapabilities })
}

/**
 * Autocomplete provider for list subcommands
 */
async function listSubcommandAutocompleteProvider(_context: ArgumentProviderContext) {
	return [
		{ value: "page", description: "Go to a specific page", matchScore: 1.0, highlightedValue: "page" },
		{ value: "next", description: "Go to next page", matchScore: 1.0, highlightedValue: "next" },
		{ value: "prev", description: "Go to previous page", matchScore: 1.0, highlightedValue: "prev" },
		{ value: "sort", description: "Change sort order", matchScore: 1.0, highlightedValue: "sort" },
		{ value: "filter", description: "Filter by capability", matchScore: 1.0, highlightedValue: "filter" },
	]
}

/**
 * Autocomplete provider for sort options
 */
async function sortOptionAutocompleteProvider(_context: ArgumentProviderContext) {
	return Object.keys(MODEL_SORT_OPTIONS).map((option) => ({
		value: option,
		description: `Sort by ${option}`,
		matchScore: 1.0,
		highlightedValue: option,
	}))
}

/**
 * Autocomplete provider for filter options
 */
async function filterOptionAutocompleteProvider(_context: ArgumentProviderContext) {
	return MODEL_FILTER_OPTIONS.map((option) => {
		const descriptions: Record<string, string> = {
			images: "Models supporting images",
			cache: "Models with prompt cache",
			reasoning: "Models with reasoning capabilities",
			free: "Free models only",
			all: "Clear all filters",
		}
		return {
			value: option,
			description: descriptions[option] || option,
			matchScore: 1.0,
			highlightedValue: option,
		}
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
	examples: [
		"/model",
		"/model info claude-sonnet-4.5",
		"/model select gpt-4",
		"/model list",
		"/model list claude",
		"/model list page 2",
		"/model list next",
		"/model list prev",
		"/model list sort price",
		"/model list filter images",
	],
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
			name: "model-or-list-subcommand",
			description: "Model name (for info/select) or list subcommand (page, next, prev, sort, filter)",
			required: false,
			provider: modelAutocompleteProvider,
			conditionalProviders: [
				{
					condition: (context) => {
						const subcommand = context.getArgument("subcommand")
						return subcommand === "info" || subcommand === "select"
					},
					provider: modelAutocompleteProvider,
				},
				{
					condition: (context) => context.getArgument("subcommand") === "list",
					provider: listSubcommandAutocompleteProvider,
				},
			],
		},
		{
			name: "argument",
			description: "Argument for the list subcommand",
			required: false,
			conditionalProviders: [
				{
					condition: (context) => context.getArgument("model-or-list-subcommand") === "sort",
					provider: sortOptionAutocompleteProvider,
				},
				{
					condition: (context) => context.getArgument("model-or-list-subcommand") === "filter",
					provider: filterOptionAutocompleteProvider,
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
				// Check for list subcommands
				const listSubcommand = args[1]?.toLowerCase()

				if (!listSubcommand) {
					context.updateModelListFilters({ search: undefined } as Partial<ModelListFilters>)
					await listModels(context, undefined, { search: undefined } as Partial<ModelListFilters>)
					break
				}

				switch (listSubcommand) {
					case "page":
						if (args.length < 3 || !args[2]) {
							context.addMessage({
								id: Date.now().toString(),
								type: "error",
								content: "Usage: /model list page <number>",
								ts: Date.now(),
							})
							return
						}
						await listModelsPage(context, args[2])
						break

					case "next":
						await listModelsNext(context)
						break

					case "prev":
					case "previous":
						await listModelsPrev(context)
						break

					case "sort":
						if (args.length < 3 || !args[2]) {
							context.addMessage({
								id: Date.now().toString(),
								type: "error",
								content: `Usage: /model list sort <option>\nValid options: ${Object.keys(MODEL_SORT_OPTIONS).join(", ")}`,
								ts: Date.now(),
							})
							return
						}
						await listModelsSort(context, args[2])
						break

					case "filter":
						if (args.length < 3 || !args[2]) {
							context.addMessage({
								id: Date.now().toString(),
								type: "error",
								content: `Usage: /model list filter <option>\nValid options: ${MODEL_FILTER_OPTIONS.join(", ")}`,
								ts: Date.now(),
							})
							return
						}
						await listModelsFilter(context, args[2])
						break

					default:
						context.updateModelListFilters({ search: listSubcommand })
						await listModels(context, undefined, { search: listSubcommand })
						break
				}
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
