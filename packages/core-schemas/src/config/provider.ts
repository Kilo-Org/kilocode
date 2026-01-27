import { z } from "zod"

// Base schema all providers extend
const baseProviderSchema = z.object({
	id: z.string(),
})

// Kilocode provider
export const kilocodeProviderSchema = baseProviderSchema.extend({
	provider: z.literal("kilocode"),
	kilocodeModel: z.string().optional(),
	kilocodeToken: z.string().optional(),
	kilocodeOrganizationId: z.string().optional(),
	openRouterSpecificProvider: z.string().optional(),
	openRouterProviderDataCollection: z.enum(["allow", "deny"]).optional(),
	openRouterProviderSort: z.enum(["price", "throughput", "latency"]).optional(),
	openRouterZdr: z.boolean().optional(),
	kilocodeTesterWarningsDisabledUntil: z.number().optional(),
})

// Anthropic provider
export const anthropicProviderSchema = baseProviderSchema.extend({
	provider: z.literal("anthropic"),
	apiModelId: z.string().optional(),
	apiKey: z.string().optional(),
	anthropicBaseUrl: z.string().optional(),
	anthropicUseAuthToken: z.boolean().optional(),
	anthropicBeta1MContext: z.boolean().optional(),
})

// OpenAI Native provider
export const openAINativeProviderSchema = baseProviderSchema.extend({
	provider: z.literal("openai-native"),
	apiModelId: z.string().optional(),
	openAiNativeApiKey: z.string().optional(),
	openAiNativeBaseUrl: z.string().optional(),
	openAiNativeServiceTier: z.enum(["auto", "default", "flex", "priority"]).optional(),
})

// kilocode_change start
// OpenAI Codex provider (ChatGPT Plus/Pro)
export const openAICodexProviderSchema = baseProviderSchema.extend({
	provider: z.literal("openai-codex"),
	apiModelId: z.string().optional(),
})
// kilocode_change end

// OpenAI provider
export const openAIProviderSchema = baseProviderSchema.extend({
	provider: z.literal("openai"),
	openAiModelId: z.string().optional(),
	openAiBaseUrl: z.string().optional(),
	openAiApiKey: z.string().optional(),
	openAiLegacyFormat: z.boolean().optional(),
	openAiR1FormatEnabled: z.boolean().optional(),
	openAiUseAzure: z.boolean().optional(),
	azureApiVersion: z.string().optional(),
	openAiStreamingEnabled: z.boolean().optional(),
	openAiHeaders: z.record(z.string(), z.string()).optional(),
})

// kilocode_change start
// OpenAI Responses provider
export const openAIResponsesProviderSchema = baseProviderSchema.extend({
	provider: z.literal("openai-responses"),
	openAiModelId: z.string().optional(),
	openAiBaseUrl: z.string().optional(),
	openAiApiKey: z.string().optional(),
	openAiLegacyFormat: z.boolean().optional(),
	openAiR1FormatEnabled: z.boolean().optional(),
	openAiUseAzure: z.boolean().optional(),
	azureApiVersion: z.string().optional(),
	openAiStreamingEnabled: z.boolean().optional(),
	openAiHeaders: z.record(z.string(), z.string()).optional(),
})
// kilocode_change end

// OpenRouter provider
export const openRouterProviderSchema = baseProviderSchema.extend({
	provider: z.literal("openrouter"),
	openRouterModelId: z.string().optional(),
	openRouterApiKey: z.string().optional(),
	openRouterBaseUrl: z.string().optional(),
	openRouterSpecificProvider: z.string().optional(),
	openRouterUseMiddleOutTransform: z.boolean().optional(),
	openRouterProviderDataCollection: z.enum(["allow", "deny"]).optional(),
	openRouterProviderSort: z.enum(["price", "throughput", "latency"]).optional(),
	openRouterZdr: z.boolean().optional(),
})

// Ollama provider
export const ollamaProviderSchema = baseProviderSchema.extend({
	provider: z.literal("ollama"),
	ollamaModelId: z.string().optional(),
	ollamaBaseUrl: z.string().optional(),
	ollamaApiKey: z.string().optional(),
	ollamaNumCtx: z.number().optional(),
})

// LM Studio provider
export const lmStudioProviderSchema = baseProviderSchema.extend({
	provider: z.literal("lmstudio"),
	lmStudioModelId: z.string().optional(),
	lmStudioBaseUrl: z.string().optional(),
	lmStudioDraftModelId: z.string().optional(),
	lmStudioSpeculativeDecodingEnabled: z.boolean().optional(),
})

// Glama provider
export const glamaProviderSchema = baseProviderSchema.extend({
	provider: z.literal("glama"),
	glamaModelId: z.string().optional(),
	glamaApiKey: z.string().optional(),
})

// LiteLLM provider
export const liteLLMProviderSchema = baseProviderSchema.extend({
	provider: z.literal("litellm"),
	litellmModelId: z.string().optional(),
	litellmBaseUrl: z.string().optional(),
	litellmApiKey: z.string().optional(),
	litellmUsePromptCache: z.boolean().optional(),
})

// DeepInfra provider
export const deepInfraProviderSchema = baseProviderSchema.extend({
	provider: z.literal("deepinfra"),
	deepInfraModelId: z.string().optional(),
	deepInfraBaseUrl: z.string().optional(),
	deepInfraApiKey: z.string().optional(),
})

// Unbound provider
export const unboundProviderSchema = baseProviderSchema.extend({
	provider: z.literal("unbound"),
	unboundModelId: z.string().optional(),
	unboundApiKey: z.string().optional(),
})

// Requesty provider
export const requestyProviderSchema = baseProviderSchema.extend({
	provider: z.literal("requesty"),
	requestyModelId: z.string().optional(),
	requestyBaseUrl: z.string().optional(),
	requestyApiKey: z.string().optional(),
})

// Vercel AI Gateway provider
export const vercelAiGatewayProviderSchema = baseProviderSchema.extend({
	provider: z.literal("vercel-ai-gateway"),
	vercelAiGatewayModelId: z.string().optional(),
	vercelAiGatewayApiKey: z.string().optional(),
})

// IO Intelligence provider
export const ioIntelligenceProviderSchema = baseProviderSchema.extend({
	provider: z.literal("io-intelligence"),
	ioIntelligenceModelId: z.string().optional(),
	ioIntelligenceApiKey: z.string().optional(),
})

// OVH Cloud provider
export const ovhCloudProviderSchema = baseProviderSchema.extend({
	provider: z.literal("ovhcloud"),
	ovhCloudAiEndpointsModelId: z.string().optional(),
	ovhCloudAiEndpointsApiKey: z.string().optional(),
	ovhCloudAiEndpointsBaseUrl: z.string().optional(),
})

// Inception provider
export const inceptionProviderSchema = baseProviderSchema.extend({
	provider: z.literal("inception"),
	inceptionLabsModelId: z.string().optional(),
	inceptionLabsBaseUrl: z.string().optional(),
	inceptionLabsApiKey: z.string().optional(),
})

// Bedrock provider (AWS)
export const bedrockProviderSchema = baseProviderSchema.extend({
	provider: z.literal("bedrock"),
	apiModelId: z.string().optional(),
	awsAccessKey: z.string().optional(),
	awsSecretKey: z.string().optional(),
	awsSessionToken: z.string().optional(),
	awsRegion: z.string().optional(),
	awsUseCrossRegionInference: z.boolean().optional(),
	awsUsePromptCache: z.boolean().optional(),
	awsProfile: z.string().optional(),
	awsUseProfile: z.boolean().optional(),
	awsApiKey: z.string().optional(),
	awsUseApiKey: z.boolean().optional(),
	awsCustomArn: z.string().optional(),
	awsModelContextWindow: z.number().optional(),
	awsBedrockEndpointEnabled: z.boolean().optional(),
	awsBedrockEndpoint: z.string().optional(),
	awsBedrock1MContext: z.boolean().optional(),
})

// Vertex provider
export const vertexProviderSchema = baseProviderSchema.extend({
	provider: z.literal("vertex"),
	apiModelId: z.string().optional(),
	vertexKeyFile: z.string().optional(),
	vertexJsonCredentials: z.string().optional(),
	vertexProjectId: z.string().optional(),
	vertexRegion: z.string().optional(),
	enableUrlContext: z.boolean().optional(),
	enableGrounding: z.boolean().optional(),
})

// Gemini provider
export const geminiProviderSchema = baseProviderSchema.extend({
	provider: z.literal("gemini"),
	apiModelId: z.string().optional(),
	geminiApiKey: z.string().optional(),
	googleGeminiBaseUrl: z.string().optional(),
	enableUrlContext: z.boolean().optional(),
	enableGrounding: z.boolean().optional(),
})

// Mistral provider
export const mistralProviderSchema = baseProviderSchema.extend({
	provider: z.literal("mistral"),
	apiModelId: z.string().optional(),
	mistralApiKey: z.string().optional(),
	mistralCodestralUrl: z.string().optional(),
})

// Moonshot provider
export const moonshotProviderSchema = baseProviderSchema.extend({
	provider: z.literal("moonshot"),
	apiModelId: z.string().optional(),
	moonshotBaseUrl: z.string().optional(),
	moonshotApiKey: z.string().optional(),
})

// Minimax provider
export const minimaxProviderSchema = baseProviderSchema.extend({
	provider: z.literal("minimax"),
	apiModelId: z.string().optional(),
	minimaxBaseUrl: z.string().optional(),
	minimaxApiKey: z.string().optional(),
})

// DeepSeek provider
export const deepSeekProviderSchema = baseProviderSchema.extend({
	provider: z.literal("deepseek"),
	apiModelId: z.string().optional(),
	deepSeekBaseUrl: z.string().optional(),
	deepSeekApiKey: z.string().optional(),
})

// Doubao provider
export const doubaoProviderSchema = baseProviderSchema.extend({
	provider: z.literal("doubao"),
	apiModelId: z.string().optional(),
	doubaoBaseUrl: z.string().optional(),
	doubaoApiKey: z.string().optional(),
})

// Qwen Code provider
export const qwenCodeProviderSchema = baseProviderSchema.extend({
	provider: z.literal("qwen-code"),
	apiModelId: z.string().optional(),
	qwenCodeOauthPath: z.string().optional(),
})

// XAI provider
export const xaiProviderSchema = baseProviderSchema.extend({
	provider: z.literal("xai"),
	apiModelId: z.string().optional(),
	xaiApiKey: z.string().optional(),
})

// Groq provider
export const groqProviderSchema = baseProviderSchema.extend({
	provider: z.literal("groq"),
	apiModelId: z.string().optional(),
	groqApiKey: z.string().optional(),
})

// Chutes provider
export const chutesProviderSchema = baseProviderSchema.extend({
	provider: z.literal("chutes"),
	apiModelId: z.string().optional(),
	chutesApiKey: z.string().optional(),
})

// Cerebras provider
export const cerebrasProviderSchema = baseProviderSchema.extend({
	provider: z.literal("cerebras"),
	apiModelId: z.string().optional(),
	cerebrasApiKey: z.string().optional(),
})

// SambaNova provider
export const sambaNovaProviderSchema = baseProviderSchema.extend({
	provider: z.literal("sambanova"),
	apiModelId: z.string().optional(),
	sambaNovaApiKey: z.string().optional(),
})

// ZAI provider
export const zaiProviderSchema = baseProviderSchema.extend({
	provider: z.literal("zai"),
	apiModelId: z.string().optional(),
	zaiApiKey: z.string().optional(),
	zaiApiLine: z.enum(["international_coding", "china_coding"]).optional(),
})

// Fireworks provider
export const fireworksProviderSchema = baseProviderSchema.extend({
	provider: z.literal("fireworks"),
	apiModelId: z.string().optional(),
	fireworksApiKey: z.string().optional(),
})

// Featherless provider
export const featherlessProviderSchema = baseProviderSchema.extend({
	provider: z.literal("featherless"),
	apiModelId: z.string().optional(),
	featherlessApiKey: z.string().optional(),
})

// Roo provider
export const rooProviderSchema = baseProviderSchema.extend({
	provider: z.literal("roo"),
	apiModelId: z.string().optional(),
})

// Claude Code provider
export const claudeCodeProviderSchema = baseProviderSchema.extend({
	provider: z.literal("claude-code"),
	apiModelId: z.string().optional(),
	claudeCodePath: z.string().optional(),
	claudeCodeMaxOutputTokens: z.number().optional(),
})

// VSCode LM provider
export const vsCodeLMProviderSchema = baseProviderSchema.extend({
	provider: z.literal("vscode-lm"),
	vsCodeLmModelSelector: z
		.object({
			vendor: z.string().optional(),
			family: z.string().optional(),
			version: z.string().optional(),
			id: z.string().optional(),
		})
		.optional(),
})

// HuggingFace provider
export const huggingFaceProviderSchema = baseProviderSchema.extend({
	provider: z.literal("huggingface"),
	huggingFaceModelId: z.string().optional(),
	huggingFaceApiKey: z.string().optional(),
	huggingFaceInferenceProvider: z.string().optional(),
})

// Synthetic provider
export const syntheticProviderSchema = baseProviderSchema.extend({
	provider: z.literal("synthetic"),
	apiModelId: z.string().optional(),
	syntheticApiKey: z.string().optional(),
})

// Virtual Quota Fallback provider
export const virtualQuotaFallbackProviderSchema = baseProviderSchema.extend({
	provider: z.literal("virtual-quota-fallback"),
	profiles: z
		.array(
			z.object({
				profileName: z.string().optional(),
				profileId: z.string().optional(),
				profileLimits: z
					.object({
						tokensPerMinute: z.number().optional(),
						tokensPerHour: z.number().optional(),
						tokensPerDay: z.number().optional(),
						requestsPerMinute: z.number().optional(),
						requestsPerHour: z.number().optional(),
						requestsPerDay: z.number().optional(),
					})
					.optional(),
			}),
		)
		.optional(),
})

// Human Relay provider
export const humanRelayProviderSchema = baseProviderSchema.extend({
	provider: z.literal("human-relay"),
})

// Fake AI provider (for testing)
export const fakeAIProviderSchema = baseProviderSchema.extend({
	provider: z.literal("fake-ai"),
	fakeAi: z.unknown().optional(),
})

// Discriminated union of all provider configs
export const providerConfigSchema = z.discriminatedUnion("provider", [
	kilocodeProviderSchema,
	anthropicProviderSchema,
	openAINativeProviderSchema,
	openAICodexProviderSchema, // kilocode_change
	openAIProviderSchema,
	openAIResponsesProviderSchema, // kilocode_change
	openRouterProviderSchema,
	ollamaProviderSchema,
	lmStudioProviderSchema,
	glamaProviderSchema,
	liteLLMProviderSchema,
	deepInfraProviderSchema,
	unboundProviderSchema,
	requestyProviderSchema,
	vercelAiGatewayProviderSchema,
	ioIntelligenceProviderSchema,
	ovhCloudProviderSchema,
	inceptionProviderSchema,
	bedrockProviderSchema,
	vertexProviderSchema,
	geminiProviderSchema,
	mistralProviderSchema,
	moonshotProviderSchema,
	minimaxProviderSchema,
	deepSeekProviderSchema,
	doubaoProviderSchema,
	qwenCodeProviderSchema,
	xaiProviderSchema,
	groqProviderSchema,
	chutesProviderSchema,
	cerebrasProviderSchema,
	sambaNovaProviderSchema,
	zaiProviderSchema,
	fireworksProviderSchema,
	featherlessProviderSchema,
	rooProviderSchema,
	claudeCodeProviderSchema,
	vsCodeLMProviderSchema,
	huggingFaceProviderSchema,
	syntheticProviderSchema,
	virtualQuotaFallbackProviderSchema,
	humanRelayProviderSchema,
	fakeAIProviderSchema,
])

// Inferred types
export type KilocodeProviderConfig = z.infer<typeof kilocodeProviderSchema>
export type AnthropicProviderConfig = z.infer<typeof anthropicProviderSchema>
export type OpenAINativeProviderConfig = z.infer<typeof openAINativeProviderSchema>
export type OpenAICodexProviderConfig = z.infer<typeof openAICodexProviderSchema> // kilocode_change
export type OpenAIProviderConfig = z.infer<typeof openAIProviderSchema>
export type OpenAIResponsesProviderConfig = z.infer<typeof openAIResponsesProviderSchema> // kilocode_change
export type OpenRouterProviderConfig = z.infer<typeof openRouterProviderSchema>
export type OllamaProviderConfig = z.infer<typeof ollamaProviderSchema>
export type LMStudioProviderConfig = z.infer<typeof lmStudioProviderSchema>
export type GlamaProviderConfig = z.infer<typeof glamaProviderSchema>
export type LiteLLMProviderConfig = z.infer<typeof liteLLMProviderSchema>
export type DeepInfraProviderConfig = z.infer<typeof deepInfraProviderSchema>
export type UnboundProviderConfig = z.infer<typeof unboundProviderSchema>
export type RequestyProviderConfig = z.infer<typeof requestyProviderSchema>
export type VercelAiGatewayProviderConfig = z.infer<typeof vercelAiGatewayProviderSchema>
export type IOIntelligenceProviderConfig = z.infer<typeof ioIntelligenceProviderSchema>
export type OVHCloudProviderConfig = z.infer<typeof ovhCloudProviderSchema>
export type InceptionProviderConfig = z.infer<typeof inceptionProviderSchema>
export type BedrockProviderConfig = z.infer<typeof bedrockProviderSchema>
export type VertexProviderConfig = z.infer<typeof vertexProviderSchema>
export type GeminiProviderConfig = z.infer<typeof geminiProviderSchema>
export type MistralProviderConfig = z.infer<typeof mistralProviderSchema>
export type MoonshotProviderConfig = z.infer<typeof moonshotProviderSchema>
export type MinimaxProviderConfig = z.infer<typeof minimaxProviderSchema>
export type DeepSeekProviderConfig = z.infer<typeof deepSeekProviderSchema>
export type DoubaoProviderConfig = z.infer<typeof doubaoProviderSchema>
export type QwenCodeProviderConfig = z.infer<typeof qwenCodeProviderSchema>
export type XAIProviderConfig = z.infer<typeof xaiProviderSchema>
export type GroqProviderConfig = z.infer<typeof groqProviderSchema>
export type ChutesProviderConfig = z.infer<typeof chutesProviderSchema>
export type CerebrasProviderConfig = z.infer<typeof cerebrasProviderSchema>
export type SambaNovaProviderConfig = z.infer<typeof sambaNovaProviderSchema>
export type ZAIProviderConfig = z.infer<typeof zaiProviderSchema>
export type FireworksProviderConfig = z.infer<typeof fireworksProviderSchema>
export type FeatherlessProviderConfig = z.infer<typeof featherlessProviderSchema>
export type RooProviderConfig = z.infer<typeof rooProviderSchema>
export type ClaudeCodeProviderConfig = z.infer<typeof claudeCodeProviderSchema>
export type VSCodeLMProviderConfig = z.infer<typeof vsCodeLMProviderSchema>
export type HuggingFaceProviderConfig = z.infer<typeof huggingFaceProviderSchema>
export type SyntheticProviderConfig = z.infer<typeof syntheticProviderSchema>
export type VirtualQuotaFallbackProviderConfig = z.infer<typeof virtualQuotaFallbackProviderSchema>
export type HumanRelayProviderConfig = z.infer<typeof humanRelayProviderSchema>
export type FakeAIProviderConfig = z.infer<typeof fakeAIProviderSchema>
export type ProviderConfig = z.infer<typeof providerConfigSchema>

// Type guards
export function isProviderConfig(provider: unknown): provider is ProviderConfig {
	return providerConfigSchema.safeParse(provider).success
}
