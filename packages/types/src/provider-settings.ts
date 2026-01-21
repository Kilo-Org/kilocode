import { z } from "zod"

import { modelInfoSchema, reasoningEffortSettingSchema, verbosityLevelsSchema, serviceTierSchema } from "./model.js"
import { codebaseIndexProviderSchema } from "./codebase-index.js"
import { profileTypeSchema } from "./profile-type.js" // kilocode_change
import {
	anthropicModels,
	basetenModels,
	bedrockModels,
	cerebrasModels,
	claudeCodeModels,
	deepSeekModels,
	doubaoModels,
	featherlessModels,
	fireworksModels,
	// kilocode_change start
	syntheticModels,
	// geminiModels,
	// kilocode_change end
	groqModels,
	ioIntelligenceModels,
	mistralModels,
	moonshotModels,
	openAiCodexModels,
	openAiNativeModels,
	qwenCodeModels,
	sambaNovaModels,
	vertexModels,
	vscodeLlmModels,
	xaiModels,
	internationalZAiModels,
	minimaxModels,
} from "./providers/index.js"

/**
 * constants
 */

export const DEFAULT_CONSECUTIVE_MISTAKE_LIMIT = 3

/**
 * DynamicProvider
 *
 * Dynamic provider requires external API calls in order to get the model list.
 */

export const dynamicProviders = [
	"openrouter",
	"vercel-ai-gateway",
	"huggingface",
	"litellm",
	// kilocode_change start
	"kilocode",
	"ovhcloud",
	"gemini",
	"inception",
	"synthetic",
	"sap-ai-core",
	// kilocode_change end
	"deepinfra",
	"io-intelligence",
	"requesty",
	"unbound",
	"glama", // kilocode_change
	"roo",
	"chutes",
	"nano-gpt", //kilocode_change
] as const

export type DynamicProvider = (typeof dynamicProviders)[number]

export const isDynamicProvider = (key: string): key is DynamicProvider =>
	dynamicProviders.includes(key as DynamicProvider)

/**
 * LocalProvider
 *
 * Local providers require localhost API calls in order to get the model list.
 */

export const localProviders = ["ollama", "lmstudio"] as const

export type LocalProvider = (typeof localProviders)[number]

export const isLocalProvider = (key: string): key is LocalProvider => localProviders.includes(key as LocalProvider)

/**
 * InternalProvider
 *
 * Internal providers require internal VSCode API calls in order to get the
 * model list.
 */

export const internalProviders = ["vscode-lm"] as const

export type InternalProvider = (typeof internalProviders)[number]

export const isInternalProvider = (key: string): key is InternalProvider =>
	internalProviders.includes(key as InternalProvider)

/**
 * CustomProvider
 *
 * Custom providers are completely configurable within Roo Code settings.
 */

export const customProviders = ["openai"] as const

export type CustomProvider = (typeof customProviders)[number]

export const isCustomProvider = (key: string): key is CustomProvider => customProviders.includes(key as CustomProvider)

/**
 * FauxProvider
 *
 * Faux providers do not make external inference calls and therefore do not have
 * model lists.
 */

export const fauxProviders = ["fake-ai", "human-relay"] as const

export type FauxProvider = (typeof fauxProviders)[number]

export const isFauxProvider = (key: string): key is FauxProvider => fauxProviders.includes(key as FauxProvider)

/**
 * ProviderName
 */

export const providerNames = [
	...dynamicProviders,
	...localProviders,
	...internalProviders,
	...customProviders,
	...fauxProviders,
	"anthropic",
	"bedrock",
	"baseten",
	"cerebras",
	"claude-code",
	"doubao",
	"deepseek",
	"featherless",
	"fireworks",
	"gemini",
	"gemini-cli",
	"groq",
	"mistral",
	"moonshot",
	"minimax",
	"openai-codex",
	"openai-native",
	"qwen-code",
	"roo",
	// kilocode_change start
	"kilocode",
	"minimax",
	"gemini-cli",
	"virtual-quota-fallback",
	"synthetic",
	"inception",
	// kilocode_change end
	"sambanova",
	"vertex",
	"xai",
	"zai",
] as const

export const providerNamesSchema = z.enum(providerNames)

export type ProviderName = z.infer<typeof providerNamesSchema>

export const isProviderName = (key: unknown): key is ProviderName =>
	typeof key === "string" && providerNames.includes(key as ProviderName)

/**
 * ProviderSettingsEntry
 */

export const providerSettingsEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	apiProvider: providerNamesSchema.optional(),
	modelId: z.string().optional(),
	profileType: profileTypeSchema.optional(), // kilocode_change - autocomplete profile type system
})

export type ProviderSettingsEntry = z.infer<typeof providerSettingsEntrySchema>

/**
 * ProviderSettings
 */

const baseProviderSettingsSchema = z.object({
	profileType: profileTypeSchema.optional(), // kilocode_change - autocomplete profile type system
	includeMaxTokens: z.boolean().optional(),
	diffEnabled: z.boolean().optional(),
	todoListEnabled: z.boolean().optional(),
	fuzzyMatchThreshold: z.number().optional(),
	modelTemperature: z.number().nullish(),
	rateLimitSeconds: z.number().optional(),
	rateLimitAfter: z.boolean().optional(), // kilocode_change
	consecutiveMistakeLimit: z.number().min(0).optional(),

	// Model reasoning.
	enableReasoningEffort: z.boolean().optional(),
	reasoningEffort: reasoningEffortSettingSchema.optional(),
	modelMaxTokens: z.number().optional(),
	modelMaxThinkingTokens: z.number().optional(),

	// Model verbosity.
	verbosity: verbosityLevelsSchema.optional(),

	// Tool protocol override for this profile.
	toolProtocol: z.enum(["xml", "native"]).optional(),
})

// Several of the providers share common model config properties.
const apiModelIdProviderModelSchema = baseProviderSettingsSchema.extend({
	apiModelId: z.string().optional(),
})

const anthropicSchema = apiModelIdProviderModelSchema.extend({
	apiKey: z.string().optional(),
	anthropicBaseUrl: z.string().optional(),
	anthropicUseAuthToken: z.boolean().optional(),
	anthropicDeploymentName: z.string().optional(), // kilocode_change
	anthropicBeta1MContext: z.boolean().optional(), // Enable 'context-1m-2025-08-07' beta for 1M context window.
})

const claudeCodeSchema = apiModelIdProviderModelSchema.extend({})

// kilocode_change start
const glamaSchema = baseProviderSettingsSchema.extend({
	glamaModelId: z.string().optional(),
	glamaApiKey: z.string().optional(),
})

export const nanoGptModelListSchema = z.enum(["all", "personalized", "subscription"])

const nanoGptSchema = baseProviderSettingsSchema.extend({
	nanoGptApiKey: z.string().optional(),
	nanoGptModelId: z.string().optional(),
	nanoGptModelList: nanoGptModelListSchema.optional(),
})

export const openRouterProviderDataCollectionSchema = z.enum(["allow", "deny"])
export const openRouterProviderSortSchema = z.enum(["price", "throughput", "latency"])
// kilocode_change end

const openRouterSchema = baseProviderSettingsSchema.extend({
	openRouterApiKey: z.string().optional(),
	openRouterModelId: z.string().optional(),
	openRouterBaseUrl: z.string().optional(),
	openRouterSpecificProvider: z.string().optional(),
	// kilocode_change start
	openRouterProviderDataCollection: openRouterProviderDataCollectionSchema.optional(),
	openRouterProviderSort: openRouterProviderSortSchema.optional(),
	openRouterZdr: z.boolean().optional(),
	// kilocode_change end
})

const bedrockSchema = apiModelIdProviderModelSchema.extend({
	awsAccessKey: z.string().optional(),
	awsSecretKey: z.string().optional(),
	awsSessionToken: z.string().optional(),
	awsRegion: z.string().optional(),
	awsUseCrossRegionInference: z.boolean().optional(),
	awsUseGlobalInference: z.boolean().optional(), // Enable Global Inference profile routing when supported
	awsUsePromptCache: z.boolean().optional(),
	awsProfile: z.string().optional(),
	awsUseProfile: z.boolean().optional(),
	awsApiKey: z.string().optional(),
	awsUseApiKey: z.boolean().optional(),
	awsCustomArn: z.string().optional(),
	awsModelContextWindow: z.number().optional(),
	awsBedrockEndpointEnabled: z.boolean().optional(),
	awsBedrockEndpoint: z.string().optional(),
	awsBedrock1MContext: z.boolean().optional(), // Enable 'context-1m-2025-08-07' beta for 1M context window.
	awsBedrockServiceTier: z.enum(["STANDARD", "FLEX", "PRIORITY"]).optional(), // AWS Bedrock service tier selection
})

const vertexSchema = apiModelIdProviderModelSchema.extend({
	vertexKeyFile: z.string().optional(),
	vertexJsonCredentials: z.string().optional(),
	vertexProjectId: z.string().optional(),
	vertexRegion: z.string().optional(),
	enableUrlContext: z.boolean().optional(),
	enableGrounding: z.boolean().optional(),
	vertex1MContext: z.boolean().optional(), // Enable 'context-1m-2025-08-07' beta for 1M context window.
})

const openAiSchema = baseProviderSettingsSchema.extend({
	openAiBaseUrl: z.string().optional(),
	openAiApiKey: z.string().optional(),
	openAiLegacyFormat: z.boolean().optional(),
	openAiR1FormatEnabled: z.boolean().optional(),
	openAiModelId: z.string().optional(),
	openAiCustomModelInfo: modelInfoSchema.nullish(),
	openAiUseAzure: z.boolean().optional(),
	azureApiVersion: z.string().optional(),
	openAiStreamingEnabled: z.boolean().optional(),
	openAiHostHeader: z.string().optional(), // Keep temporarily for backward compatibility during migration.
	openAiHeaders: z.record(z.string(), z.string()).optional(),
})

const ollamaSchema = baseProviderSettingsSchema.extend({
	ollamaModelId: z.string().optional(),
	ollamaBaseUrl: z.string().optional(),
	ollamaApiKey: z.string().optional(),
	ollamaNumCtx: z.number().int().min(128).optional(),
})

const vsCodeLmSchema = baseProviderSettingsSchema.extend({
	vsCodeLmModelSelector: z
		.object({
			vendor: z.string().optional(),
			family: z.string().optional(),
			version: z.string().optional(),
			id: z.string().optional(),
		})
		.optional(),
})

const lmStudioSchema = baseProviderSettingsSchema.extend({
	lmStudioModelId: z.string().optional(),
	lmStudioBaseUrl: z.string().optional(),
	lmStudioDraftModelId: z.string().optional(),
	lmStudioSpeculativeDecodingEnabled: z.boolean().optional(),
})

const geminiSchema = apiModelIdProviderModelSchema.extend({
	geminiApiKey: z.string().optional(),
	googleGeminiBaseUrl: z.string().optional(),
	enableUrlContext: z.boolean().optional(),
	enableGrounding: z.boolean().optional(),
})

// kilocode_change start
const geminiCliSchema = apiModelIdProviderModelSchema.extend({
	geminiCliOAuthPath: z.string().optional(),
	geminiCliProjectId: z.string().optional(),
})
// kilocode_change end

const openAiCodexSchema = apiModelIdProviderModelSchema.extend({
	// No additional settings needed - uses OAuth authentication
})

const openAiNativeSchema = apiModelIdProviderModelSchema.extend({
	openAiNativeApiKey: z.string().optional(),
	openAiNativeBaseUrl: z.string().optional(),
	// OpenAI Responses API service tier for openai-native provider only.
	// UI should only expose this when the selected model supports flex/priority.
	openAiNativeServiceTier: serviceTierSchema.optional(),
})

const mistralSchema = apiModelIdProviderModelSchema.extend({
	mistralApiKey: z.string().optional(),
	mistralCodestralUrl: z.string().optional(),
})

const deepSeekSchema = apiModelIdProviderModelSchema.extend({
	deepSeekBaseUrl: z.string().optional(),
	deepSeekApiKey: z.string().optional(),
})

const deepInfraSchema = apiModelIdProviderModelSchema.extend({
	deepInfraBaseUrl: z.string().optional(),
	deepInfraApiKey: z.string().optional(),
	deepInfraModelId: z.string().optional(),
})

const doubaoSchema = apiModelIdProviderModelSchema.extend({
	doubaoBaseUrl: z.string().optional(),
	doubaoApiKey: z.string().optional(),
})

const moonshotSchema = apiModelIdProviderModelSchema.extend({
	moonshotBaseUrl: z
		.union([z.literal("https://api.moonshot.ai/v1"), z.literal("https://api.moonshot.cn/v1")])
		.optional(),
	moonshotApiKey: z.string().optional(),
})

const minimaxSchema = apiModelIdProviderModelSchema.extend({
	minimaxBaseUrl: z
		.union([z.literal("https://api.minimax.io/anthropic"), z.literal("https://api.minimaxi.com/anthropic")]) // kilocode_change: anthropic
		.optional(),
	minimaxApiKey: z.string().optional(),
})

const unboundSchema = baseProviderSettingsSchema.extend({
	unboundApiKey: z.string().optional(),
	unboundModelId: z.string().optional(),
})

const requestySchema = baseProviderSettingsSchema.extend({
	requestyBaseUrl: z.string().optional(),
	requestyApiKey: z.string().optional(),
	requestyModelId: z.string().optional(),
})

const humanRelaySchema = baseProviderSettingsSchema

const fakeAiSchema = baseProviderSettingsSchema.extend({
	fakeAi: z.unknown().optional(),
})

const xaiSchema = apiModelIdProviderModelSchema.extend({
	xaiApiKey: z.string().optional(),
})

const groqSchema = apiModelIdProviderModelSchema.extend({
	groqApiKey: z.string().optional(),
})

const huggingFaceSchema = baseProviderSettingsSchema.extend({
	huggingFaceApiKey: z.string().optional(),
	huggingFaceModelId: z.string().optional(),
	huggingFaceInferenceProvider: z.string().optional(),
})

const chutesSchema = apiModelIdProviderModelSchema.extend({
	chutesApiKey: z.string().optional(),
})

const litellmSchema = baseProviderSettingsSchema.extend({
	litellmBaseUrl: z.string().optional(),
	litellmApiKey: z.string().optional(),
	litellmModelId: z.string().optional(),
	litellmUsePromptCache: z.boolean().optional(),
})

const cerebrasSchema = apiModelIdProviderModelSchema.extend({
	cerebrasApiKey: z.string().optional(),
})

const sambaNovaSchema = apiModelIdProviderModelSchema.extend({
	sambaNovaApiKey: z.string().optional(),
})

// kilocode_change start
const inceptionSchema = apiModelIdProviderModelSchema.extend({
	inceptionLabsBaseUrl: z.string().optional(),
	inceptionLabsApiKey: z.string().optional(),
	inceptionLabsModelId: z.string().optional(),
})

const ovhcloudSchema = baseProviderSettingsSchema.extend({
	ovhCloudAiEndpointsApiKey: z.string().optional(),
	ovhCloudAiEndpointsModelId: z.string().optional(),
	ovhCloudAiEndpointsBaseUrl: z.string().optional(),
})

const kilocodeSchema = baseProviderSettingsSchema.extend({
	kilocodeToken: z.string().optional(),
	kilocodeOrganizationId: z.string().optional(),
	kilocodeModel: z.string().optional(),
	openRouterSpecificProvider: z.string().optional(),
	openRouterProviderDataCollection: openRouterProviderDataCollectionSchema.optional(),
	openRouterProviderSort: openRouterProviderSortSchema.optional(),
	openRouterZdr: z.boolean().optional(),
	kilocodeTesterWarningsDisabledUntil: z.number().optional(), // Timestamp for disabling KILOCODE-TESTER warnings
})

export const virtualQuotaFallbackProfileDataSchema = z.object({
	profileName: z.string().optional(),
	profileId: z.string().optional(),
	profileLimits: z
		.object({
			tokensPerMinute: z.coerce.number().optional(),
			tokensPerHour: z.coerce.number().optional(),
			tokensPerDay: z.coerce.number().optional(),
			requestsPerMinute: z.coerce.number().optional(),
			requestsPerHour: z.coerce.number().optional(),
			requestsPerDay: z.coerce.number().optional(),
		})
		.optional(),
})

const virtualQuotaFallbackSchema = baseProviderSettingsSchema.extend({
	profiles: z.array(virtualQuotaFallbackProfileDataSchema).optional(),
})
// kilocode_change end

export const zaiApiLineSchema = z.enum(["international_coding", "china_coding", "international_api", "china_api"])

export type ZaiApiLine = z.infer<typeof zaiApiLineSchema>

const zaiSchema = apiModelIdProviderModelSchema.extend({
	zaiApiKey: z.string().optional(),
	zaiApiLine: zaiApiLineSchema.optional(),
})

const fireworksSchema = apiModelIdProviderModelSchema.extend({
	fireworksApiKey: z.string().optional(),
})

// kilocode_change start
const syntheticSchema = apiModelIdProviderModelSchema.extend({
	syntheticApiKey: z.string().optional(),
})
// kilocode_change end

const featherlessSchema = apiModelIdProviderModelSchema.extend({
	featherlessApiKey: z.string().optional(),
})

const ioIntelligenceSchema = apiModelIdProviderModelSchema.extend({
	ioIntelligenceModelId: z.string().optional(),
	ioIntelligenceApiKey: z.string().optional(),
})

const qwenCodeSchema = apiModelIdProviderModelSchema.extend({
	qwenCodeOauthPath: z.string().optional(),
})

const rooSchema = apiModelIdProviderModelSchema.extend({
	// No additional fields needed - uses cloud authentication.
})

const vercelAiGatewaySchema = baseProviderSettingsSchema.extend({
	vercelAiGatewayApiKey: z.string().optional(),
	vercelAiGatewayModelId: z.string().optional(),
})

// kilocode_change start
const sapAiCoreSchema = baseProviderSettingsSchema.extend({
	sapAiCoreServiceKey: z.string().optional(),
	sapAiCoreResourceGroup: z.string().optional(),
	sapAiCoreUseOrchestration: z.boolean().optional(),
	sapAiCoreModelId: z.string().optional(),
	sapAiCoreDeploymentId: z.string().optional(),
	sapAiCoreCustomModelInfo: modelInfoSchema.nullish(),
})
// kilocode_change end

const basetenSchema = apiModelIdProviderModelSchema.extend({
	basetenApiKey: z.string().optional(),
})

const defaultSchema = z.object({
	apiProvider: z.undefined(),
})

export const providerSettingsSchemaDiscriminated = z.discriminatedUnion("apiProvider", [
	anthropicSchema.merge(z.object({ apiProvider: z.literal("anthropic") })),
	claudeCodeSchema.merge(z.object({ apiProvider: z.literal("claude-code") })),
	glamaSchema.merge(z.object({ apiProvider: z.literal("glama") })), // kilocode_change
	nanoGptSchema.merge(z.object({ apiProvider: z.literal("nano-gpt") })), // kilocode_change
	openRouterSchema.merge(z.object({ apiProvider: z.literal("openrouter") })),
	bedrockSchema.merge(z.object({ apiProvider: z.literal("bedrock") })),
	vertexSchema.merge(z.object({ apiProvider: z.literal("vertex") })),
	openAiSchema.merge(z.object({ apiProvider: z.literal("openai") })),
	ollamaSchema.merge(z.object({ apiProvider: z.literal("ollama") })),
	vsCodeLmSchema.merge(z.object({ apiProvider: z.literal("vscode-lm") })),
	lmStudioSchema.merge(z.object({ apiProvider: z.literal("lmstudio") })),
	geminiSchema.merge(z.object({ apiProvider: z.literal("gemini") })),
	openAiCodexSchema.merge(z.object({ apiProvider: z.literal("openai-codex") })),
	openAiNativeSchema.merge(z.object({ apiProvider: z.literal("openai-native") })),
	ovhcloudSchema.merge(z.object({ apiProvider: z.literal("ovhcloud") })), // kilocode_change
	mistralSchema.merge(z.object({ apiProvider: z.literal("mistral") })),
	deepSeekSchema.merge(z.object({ apiProvider: z.literal("deepseek") })),
	deepInfraSchema.merge(z.object({ apiProvider: z.literal("deepinfra") })),
	doubaoSchema.merge(z.object({ apiProvider: z.literal("doubao") })),
	moonshotSchema.merge(z.object({ apiProvider: z.literal("moonshot") })),
	minimaxSchema.merge(z.object({ apiProvider: z.literal("minimax") })),
	unboundSchema.merge(z.object({ apiProvider: z.literal("unbound") })),
	requestySchema.merge(z.object({ apiProvider: z.literal("requesty") })),
	humanRelaySchema.merge(z.object({ apiProvider: z.literal("human-relay") })),
	fakeAiSchema.merge(z.object({ apiProvider: z.literal("fake-ai") })),
	xaiSchema.merge(z.object({ apiProvider: z.literal("xai") })),
	// kilocode_change start
	geminiCliSchema.merge(z.object({ apiProvider: z.literal("gemini-cli") })),
	kilocodeSchema.merge(z.object({ apiProvider: z.literal("kilocode") })),
	virtualQuotaFallbackSchema.merge(z.object({ apiProvider: z.literal("virtual-quota-fallback") })),
	syntheticSchema.merge(z.object({ apiProvider: z.literal("synthetic") })),
	inceptionSchema.merge(z.object({ apiProvider: z.literal("inception") })),
	// kilocode_change end
	groqSchema.merge(z.object({ apiProvider: z.literal("groq") })),
	basetenSchema.merge(z.object({ apiProvider: z.literal("baseten") })),
	huggingFaceSchema.merge(z.object({ apiProvider: z.literal("huggingface") })),
	chutesSchema.merge(z.object({ apiProvider: z.literal("chutes") })),
	litellmSchema.merge(z.object({ apiProvider: z.literal("litellm") })),
	cerebrasSchema.merge(z.object({ apiProvider: z.literal("cerebras") })),
	sambaNovaSchema.merge(z.object({ apiProvider: z.literal("sambanova") })),
	zaiSchema.merge(z.object({ apiProvider: z.literal("zai") })),
	fireworksSchema.merge(z.object({ apiProvider: z.literal("fireworks") })),
	featherlessSchema.merge(z.object({ apiProvider: z.literal("featherless") })),
	ioIntelligenceSchema.merge(z.object({ apiProvider: z.literal("io-intelligence") })),
	qwenCodeSchema.merge(z.object({ apiProvider: z.literal("qwen-code") })),
	rooSchema.merge(z.object({ apiProvider: z.literal("roo") })),
	vercelAiGatewaySchema.merge(z.object({ apiProvider: z.literal("vercel-ai-gateway") })),
	sapAiCoreSchema.merge(z.object({ apiProvider: z.literal("sap-ai-core") })), // kilocode_change
	defaultSchema,
])

export const providerSettingsSchema = z.object({
	apiProvider: providerNamesSchema.optional(),
	...anthropicSchema.shape,
	...claudeCodeSchema.shape,
	...glamaSchema.shape, // kilocode_change
	...nanoGptSchema.shape, // kilocode_change
	...openRouterSchema.shape,
	...bedrockSchema.shape,
	...vertexSchema.shape,
	...openAiSchema.shape,
	...ollamaSchema.shape,
	...vsCodeLmSchema.shape,
	...lmStudioSchema.shape,
	...geminiSchema.shape,
	// kilocode_change start
	...geminiCliSchema.shape,
	...kilocodeSchema.shape,
	...virtualQuotaFallbackSchema.shape,
	...syntheticSchema.shape,
	...ovhcloudSchema.shape,
	...inceptionSchema.shape,
	// kilocode_change end
	...openAiCodexSchema.shape,
	...openAiNativeSchema.shape,
	...mistralSchema.shape,
	...deepSeekSchema.shape,
	...deepInfraSchema.shape,
	...doubaoSchema.shape,
	...moonshotSchema.shape,
	...minimaxSchema.shape,
	...unboundSchema.shape,
	...requestySchema.shape,
	...humanRelaySchema.shape,
	...fakeAiSchema.shape,
	...xaiSchema.shape,
	...groqSchema.shape,
	...basetenSchema.shape,
	...huggingFaceSchema.shape,
	...chutesSchema.shape,
	...litellmSchema.shape,
	...cerebrasSchema.shape,
	...sambaNovaSchema.shape,
	...zaiSchema.shape,
	...fireworksSchema.shape,
	...featherlessSchema.shape,
	...ioIntelligenceSchema.shape,
	...qwenCodeSchema.shape,
	...rooSchema.shape,
	...vercelAiGatewaySchema.shape,
	...sapAiCoreSchema.shape, // kilocode_change
	...codebaseIndexProviderSchema.shape,
})

export type ProviderSettings = z.infer<typeof providerSettingsSchema>

export const providerSettingsWithIdSchema = providerSettingsSchema.extend({ id: z.string().optional() })

export const discriminatedProviderSettingsWithIdSchema = providerSettingsSchemaDiscriminated.and(
	z.object({ id: z.string().optional() }),
)

export type ProviderSettingsWithId = z.infer<typeof providerSettingsWithIdSchema>

export const PROVIDER_SETTINGS_KEYS = providerSettingsSchema.keyof().options

/**
 * ModelIdKey
 */

export const modelIdKeys = [
	"apiModelId",
	"glamaModelId", // kilocode_change
	"nanoGptModelId", // kilocode_change
	"openRouterModelId",
	"openAiModelId",
	"ollamaModelId",
	"lmStudioModelId",
	"lmStudioDraftModelId",
	"unboundModelId",
	"requestyModelId",
	"litellmModelId",
	"huggingFaceModelId",
	"ioIntelligenceModelId",
	"vercelAiGatewayModelId",
	"deepInfraModelId",
	"kilocodeModel",
	"ovhCloudAiEndpointsModelId", // kilocode_change
	"inceptionLabsModelId", // kilocode_change
	"sapAiCoreModelId", // kilocode_change
] as const satisfies readonly (keyof ProviderSettings)[]

export type ModelIdKey = (typeof modelIdKeys)[number]

export const getModelId = (settings: ProviderSettings): string | undefined => {
	const modelIdKey = modelIdKeys.find((key) => settings[key])
	return modelIdKey ? settings[modelIdKey] : undefined
}

/**
 * TypicalProvider
 */

export type TypicalProvider = Exclude<ProviderName, InternalProvider | CustomProvider | FauxProvider>

export const isTypicalProvider = (key: unknown): key is TypicalProvider =>
	isProviderName(key) && !isInternalProvider(key) && !isCustomProvider(key) && !isFauxProvider(key)

export const modelIdKeysByProvider: Record<TypicalProvider, ModelIdKey> = {
	anthropic: "apiModelId",
	"claude-code": "apiModelId",
	glama: "glamaModelId", // kilocode_change
	"nano-gpt": "nanoGptModelId", // kilocode_change
	openrouter: "openRouterModelId",
	kilocode: "kilocodeModel",
	bedrock: "apiModelId",
	vertex: "apiModelId",
	"openai-codex": "apiModelId",
	"openai-native": "openAiModelId",
	ollama: "ollamaModelId",
	lmstudio: "lmStudioModelId",
	gemini: "apiModelId",
	"gemini-cli": "apiModelId",
	mistral: "apiModelId",
	moonshot: "apiModelId",
	minimax: "apiModelId",
	deepseek: "apiModelId",
	deepinfra: "deepInfraModelId",
	doubao: "apiModelId",
	"qwen-code": "apiModelId",
	unbound: "unboundModelId",
	requesty: "requestyModelId",
	xai: "apiModelId",
	// kilocode_change start
	synthetic: "apiModelId",
	ovhcloud: "ovhCloudAiEndpointsModelId",
	inception: "inceptionLabsModelId",
	"sap-ai-core": "sapAiCoreModelId",
	// kilocode_change end
	groq: "apiModelId",
	baseten: "apiModelId",
	chutes: "apiModelId",
	litellm: "litellmModelId",
	huggingface: "huggingFaceModelId",
	cerebras: "apiModelId",
	sambanova: "apiModelId",
	zai: "apiModelId",
	fireworks: "apiModelId",
	featherless: "apiModelId",
	"io-intelligence": "ioIntelligenceModelId",
	roo: "apiModelId",
	"vercel-ai-gateway": "vercelAiGatewayModelId",
	"virtual-quota-fallback": "apiModelId",
}

/**
 * ANTHROPIC_STYLE_PROVIDERS
 */

// Providers that use Anthropic-style API protocol.
export const ANTHROPIC_STYLE_PROVIDERS: ProviderName[] = ["anthropic", "claude-code", "bedrock", "minimax"]

export const getApiProtocol = (provider: ProviderName | undefined, modelId?: string): "anthropic" | "openai" => {
	if (provider && ANTHROPIC_STYLE_PROVIDERS.includes(provider)) {
		return "anthropic"
	}

	if (provider && provider === "vertex" && modelId && modelId.toLowerCase().includes("claude")) {
		return "anthropic"
	}

	// Vercel AI Gateway uses anthropic protocol for anthropic models.
	if (
		provider &&
		["vercel-ai-gateway", "roo"].includes(provider) &&
		modelId &&
		modelId.toLowerCase().startsWith("anthropic/")
	) {
		return "anthropic"
	}

	return "openai"
}

/**
 * MODELS_BY_PROVIDER
 */

export const MODELS_BY_PROVIDER: Record<
	Exclude<ProviderName, "fake-ai" | "human-relay" | "gemini-cli" | "openai" | "gemini">,
	{ id: ProviderName; label: string; models: string[] }
> = {
	anthropic: {
		id: "anthropic",
		label: "Anthropic",
		models: Object.keys(anthropicModels),
	},
	bedrock: {
		id: "bedrock",
		label: "Amazon Bedrock",
		models: Object.keys(bedrockModels),
	},
	cerebras: {
		id: "cerebras",
		label: "Cerebras",
		models: Object.keys(cerebrasModels),
	},
	"claude-code": { id: "claude-code", label: "Claude Code", models: Object.keys(claudeCodeModels) },
	deepseek: {
		id: "deepseek",
		label: "DeepSeek",
		models: Object.keys(deepSeekModels),
	},
	doubao: { id: "doubao", label: "Doubao", models: Object.keys(doubaoModels) },
	featherless: {
		id: "featherless",
		label: "Featherless",
		models: Object.keys(featherlessModels),
	},
	fireworks: {
		id: "fireworks",
		label: "Fireworks",
		models: Object.keys(fireworksModels),
	},
	// kilocode_change start
	synthetic: {
		id: "synthetic",
		label: "Synthetic",
		models: Object.keys(syntheticModels),
	},
	//gemini: {
	//	id: "gemini",
	//	label: "Google Gemini",
	//	models: Object.keys(geminiModels),
	//},
	// kilocode_change end
	groq: { id: "groq", label: "Groq", models: Object.keys(groqModels) },
	"io-intelligence": {
		id: "io-intelligence",
		label: "IO Intelligence",
		models: Object.keys(ioIntelligenceModels),
	},
	mistral: {
		id: "mistral",
		label: "Mistral",
		models: Object.keys(mistralModels),
	},
	moonshot: {
		id: "moonshot",
		label: "Moonshot",
		models: Object.keys(moonshotModels),
	},
	minimax: {
		id: "minimax",
		label: "MiniMax",
		models: Object.keys(minimaxModels),
	},
	"openai-codex": {
		id: "openai-codex",
		label: "OpenAI - ChatGPT Plus/Pro",
		models: Object.keys(openAiCodexModels),
	},
	"openai-native": {
		id: "openai-native",
		label: "OpenAI",
		models: Object.keys(openAiNativeModels),
	},
	"qwen-code": { id: "qwen-code", label: "Qwen Code", models: Object.keys(qwenCodeModels) },
	roo: { id: "roo", label: "Roo Code Cloud", models: [] },
	sambanova: {
		id: "sambanova",
		label: "SambaNova",
		models: Object.keys(sambaNovaModels),
	},
	vertex: {
		id: "vertex",
		label: "GCP Vertex AI",
		models: Object.keys(vertexModels),
	},
	"vscode-lm": {
		id: "vscode-lm",
		label: "VS Code LM API",
		models: Object.keys(vscodeLlmModels),
	},
	xai: { id: "xai", label: "xAI (Grok)", models: Object.keys(xaiModels) },
	zai: { id: "zai", label: "Z.ai", models: Object.keys(internationalZAiModels) },
	baseten: { id: "baseten", label: "Baseten", models: Object.keys(basetenModels) },

	// Dynamic providers; models pulled from remote APIs.
	glama: { id: "glama", label: "Glama", models: [] }, // kilocode_change
	"nano-gpt": { id: "nano-gpt", label: "Nano-GPT", models: [] }, // kilocode_change
	huggingface: { id: "huggingface", label: "Hugging Face", models: [] },
	litellm: { id: "litellm", label: "LiteLLM", models: [] },
	openrouter: { id: "openrouter", label: "OpenRouter", models: [] },
	requesty: { id: "requesty", label: "Requesty", models: [] },
	unbound: { id: "unbound", label: "Unbound", models: [] },
	"sap-ai-core": { id: "sap-ai-core", label: "SAP AI Core", models: [] }, // kilocode_change

	// kilocode_change start
	ovhcloud: { id: "ovhcloud", label: "OVHcloud AI Endpoints", models: [] },
	inception: { id: "inception", label: "Inception", models: [] },
	kilocode: { id: "kilocode", label: "Kilocode", models: [] },
	"virtual-quota-fallback": { id: "virtual-quota-fallback", label: "Virtual Quota Fallback", models: [] },
	// kilocode_change end
	deepinfra: { id: "deepinfra", label: "DeepInfra", models: [] },
	"vercel-ai-gateway": { id: "vercel-ai-gateway", label: "Vercel AI Gateway", models: [] },
	chutes: { id: "chutes", label: "Chutes AI", models: [] },

	// Local providers; models discovered from localhost endpoints.
	lmstudio: { id: "lmstudio", label: "LM Studio", models: [] },
	ollama: { id: "ollama", label: "Ollama", models: [] },
}
