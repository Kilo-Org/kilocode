import {
	type ModelInfo,
	type ProviderSettings,
	type DynamicProvider,
	type LocalProvider,
	ANTHROPIC_DEFAULT_MAX_TOKENS,
	isDynamicProvider,
	isLocalProvider,
	ToolProtocol, // kilocode_change
} from "@roo-code/types"

// ApiHandlerOptions
// Extend ProviderSettings (minus apiProvider) with handler-specific toggles.
export type ApiHandlerOptions = Omit<ProviderSettings, "apiProvider"> & {
	/**
	 * When true and using OpenAI Responses API models that support reasoning summaries,
	 * include reasoning.summary: "auto" so the API returns summaries (we already parse
	 * and surface them). Defaults to true; set to false to disable summaries.
	 */
	enableResponsesReasoningSummary?: boolean
	/**
	 * Optional override for Ollama's num_ctx parameter.
	 * When set, this value will be used in Ollama chat requests.
	 * When undefined, Ollama will use the model's default num_ctx from the Modelfile.
	 */
	ollamaNumCtx?: number
}

// RouterName

export type RouterName = DynamicProvider | LocalProvider

export const isRouterName = (value: string): value is RouterName => isDynamicProvider(value) || isLocalProvider(value)

export function toRouterName(value?: string): RouterName {
	if (value && isRouterName(value)) {
		return value
	}

	throw new Error(`Invalid router name: ${value}`)
}

// RouterModels

export type ModelRecord = Record<string, ModelInfo>

export type RouterModels = Record<RouterName, ModelRecord>

// Reasoning

export const shouldUseReasoningBudget = ({
	model,
	settings,
}: {
	model: ModelInfo
	settings?: ProviderSettings
}): boolean => !!model.requiredReasoningBudget || (!!model.supportsReasoningBudget && !!settings?.enableReasoningEffort)

export const shouldUseReasoningEffort = ({
	model,
	settings,
}: {
	model: ModelInfo
	settings?: ProviderSettings
}): boolean => {
	// Explicit off switch
	if (settings?.enableReasoningEffort === false) return false

	// Selected effort from settings or model default
	const selectedEffort = (settings?.reasoningEffort ?? (model as any).reasoningEffort) as
		| "disable"
		| "none"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| undefined

	// "disable" explicitly omits reasoning
	if (selectedEffort === "disable") return false

	const cap = model.supportsReasoningEffort as unknown

	// Capability array: use only if selected is included (treat "none"/"minimal" as valid)
	if (Array.isArray(cap)) {
		return !!selectedEffort && (cap as ReadonlyArray<string>).includes(selectedEffort as string)
	}

	// Boolean capability: true → require a selected effort
	if (model.supportsReasoningEffort === true) {
		return !!selectedEffort
	}

	// Not explicitly supported: only allow when the model itself defines a default effort
	// Ignore settings-only selections when capability is absent/false
	const modelDefaultEffort = (model as any).reasoningEffort as
		| "none"
		| "minimal"
		| "low"
		| "medium"
		| "high"
		| undefined
	return !!modelDefaultEffort
}

export const DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS = 16_384
export const DEFAULT_HYBRID_REASONING_MODEL_THINKING_TOKENS = 8_192
export const GEMINI_25_PRO_MIN_THINKING_TOKENS = 128

// Max Tokens

export const getModelMaxOutputTokens = ({
	modelId,
	model,
	settings,
	format,
}: {
	modelId: string
	model: ModelInfo
	settings?: ProviderSettings
	format?: "anthropic" | "openai" | "gemini" | "openrouter"
}): number | undefined => {
	if (shouldUseReasoningBudget({ model, settings })) {
		return settings?.modelMaxTokens || DEFAULT_HYBRID_REASONING_MODEL_MAX_TOKENS
	}

	const isAnthropicContext =
		modelId.includes("claude") ||
		format === "anthropic" ||
		(format === "openrouter" && modelId.startsWith("anthropic/"))

	// For "Hybrid" reasoning models, discard the model's actual maxTokens for Anthropic contexts
	/* kilocode_change: don't limit Anthropic model output, no idea why this was done before
	if (model.supportsReasoningBudget && isAnthropicContext) {
		return ANTHROPIC_DEFAULT_MAX_TOKENS
	}*/

	// For Anthropic contexts, always ensure a maxTokens value is set
	if (isAnthropicContext && (!model.maxTokens || model.maxTokens === 0)) {
		return ANTHROPIC_DEFAULT_MAX_TOKENS
	}

	// If model has explicit maxTokens, clamp it to 20% of the context window
	// Exception: GPT-5 models should use their exact configured max output tokens
	if (model.maxTokens) {
		// Check if this is a GPT-5 model (case-insensitive)
		const isGpt5Model = modelId.toLowerCase().includes("gpt-5")

		// GPT-5 models bypass the 20% cap and use their full configured max tokens
		if (isGpt5Model) {
			return model.maxTokens
		}

		// All other models are clamped to 20% of context window
		return Math.min(model.maxTokens, Math.ceil(model.contextWindow * 0.2))
	}

	// For non-Anthropic formats without explicit maxTokens, return undefined
	if (format) {
		return undefined
	}

	// Default fallback
	return ANTHROPIC_DEFAULT_MAX_TOKENS
}

// GetModelsOptions

// Allow callers to always pass apiKey/baseUrl without excess property errors,
// while still enforcing required fields per provider where applicable.
type CommonFetchParams = {
	apiKey?: string
	baseUrl?: string
}

// Exhaustive, value-level map for all dynamic providers.
// If a new dynamic provider is added in packages/types, this will fail to compile
// until a corresponding entry is added here.
const dynamicProviderExtras = {
	gemini: {} as { apiKey?: string; baseUrl?: string }, // kilocode_change
	openrouter: {} as {}, // eslint-disable-line @typescript-eslint/no-empty-object-type
	"vercel-ai-gateway": {} as {}, // eslint-disable-line @typescript-eslint/no-empty-object-type
	huggingface: {} as {}, // eslint-disable-line @typescript-eslint/no-empty-object-type
	litellm: {} as { apiKey?: string; baseUrl?: string }, // kilocode_change: parameters optional
	kilocode: {} as { kilocodeToken?: string; kilocodeOrganizationId?: string }, // kilocode_change
	deepinfra: {} as { apiKey?: string; baseUrl?: string },
	"io-intelligence": {} as { apiKey?: string }, // kilocode_change: parameters optional
	requesty: {} as { apiKey?: string; baseUrl?: string },
	unbound: {} as { apiKey?: string },
	// kilocode_change start
	glama: {} as {}, // eslint-disable-line @typescript-eslint/no-empty-object-type
	// kilocode_change end
	"nano-gpt": {} as { nanoGptModelList?: "all" | "personalized" | "subscription" }, // kilocode_change
	ollama: {} as { numCtx?: number }, // kilocode_change
	lmstudio: {} as {}, // eslint-disable-line @typescript-eslint/no-empty-object-type
	ovhcloud: {} as { apiKey?: string }, // kilocode_change
	inception: {} as { apiKey?: string; baseUrl?: string }, // kilocode_change
	synthetic: {} as { apiKey?: string }, // kilocode_change
	roo: {} as { apiKey?: string; baseUrl?: string },
	chutes: {} as { apiKey?: string },
	// kilocode_change start
	"sap-ai-core": {} as {
		sapAiCoreServiceKey?: string
		sapAiCoreResourceGroup?: string
		sapAiCoreUseOrchestration?: boolean
	},
	apertis: {} as { apiKey?: string; baseUrl?: string },
	// kilocode_change end
} as const satisfies Record<RouterName, object>

// Build the dynamic options union from the map, intersected with CommonFetchParams
// so extra fields are always allowed while required ones are enforced.
export type GetModelsOptions = {
	[P in keyof typeof dynamicProviderExtras]: ({ provider: P } & (typeof dynamicProviderExtras)[P]) & CommonFetchParams
}[RouterName]
