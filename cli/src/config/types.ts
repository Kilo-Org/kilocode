import type { ThemeId, Theme } from "../types/theme.js"

/**
 * Auto approval configuration for read operations
 */
export interface AutoApprovalReadConfig {
	enabled?: boolean
	outside?: boolean
}

/**
 * Auto approval configuration for write operations
 */
export interface AutoApprovalWriteConfig {
	enabled?: boolean
	outside?: boolean
	protected?: boolean
}

/**
 * Auto approval configuration for browser operations
 */
export interface AutoApprovalBrowserConfig {
	enabled?: boolean
}

/**
 * Auto approval configuration for retry operations
 */
export interface AutoApprovalRetryConfig {
	enabled?: boolean
	delay?: number
}

/**
 * Auto approval configuration for MCP operations
 */
export interface AutoApprovalMcpConfig {
	enabled?: boolean
}

/**
 * Auto approval configuration for mode switching
 */
export interface AutoApprovalModeConfig {
	enabled?: boolean
}

/**
 * Auto approval configuration for subtasks
 */
export interface AutoApprovalSubtasksConfig {
	enabled?: boolean
}

/**
 * Auto approval configuration for command execution
 */
export interface AutoApprovalExecuteConfig {
	enabled?: boolean
	allowed?: string[]
	denied?: string[]
}

/**
 * Auto approval configuration for followup questions
 */
export interface AutoApprovalQuestionConfig {
	enabled?: boolean
	timeout?: number
}

/**
 * Auto approval configuration for todo list updates
 */
export interface AutoApprovalTodoConfig {
	enabled?: boolean
}

/**
 * Complete auto approval configuration
 */
export interface AutoApprovalConfig {
	enabled?: boolean
	read?: AutoApprovalReadConfig
	write?: AutoApprovalWriteConfig
	browser?: AutoApprovalBrowserConfig
	retry?: AutoApprovalRetryConfig
	mcp?: AutoApprovalMcpConfig
	mode?: AutoApprovalModeConfig
	subtasks?: AutoApprovalSubtasksConfig
	execute?: AutoApprovalExecuteConfig
	question?: AutoApprovalQuestionConfig
	todo?: AutoApprovalTodoConfig
}

export interface CLIConfig {
	version: "1.0.0"
	mode: string
	telemetry: boolean
	provider: string
	providers: ProviderConfig[]
	autoApproval?: AutoApprovalConfig
	theme?: ThemeId
	customThemes?: Record<string, Theme>
}

// Base provider config with common fields
interface BaseProviderConfig {
	id: string
	[key: string]: unknown // Allow additional fields for flexibility
}

// Provider-specific configurations with discriminated unions
type KilocodeProviderConfig = BaseProviderConfig & {
	provider: "kilocode"
	kilocodeModel?: string
	kilocodeToken?: string
	kilocodeOrganizationId?: string
	openRouterSpecificProvider?: string
	openRouterProviderDataCollection?: "allow" | "deny"
	openRouterProviderSort?: "price" | "throughput" | "latency"
	openRouterZdr?: boolean
	kilocodeTesterWarningsDisabledUntil?: number
}

type AnthropicProviderConfig = BaseProviderConfig & {
	provider: "anthropic"
	apiModelId?: string
	apiKey?: string
	anthropicBaseUrl?: string
	anthropicUseAuthToken?: boolean
	anthropicBeta1MContext?: boolean
}

type OpenAINativeProviderConfig = BaseProviderConfig & {
	provider: "openai-native"
	apiModelId?: string
	openAiNativeApiKey?: string
	openAiNativeBaseUrl?: string
	openAiNativeServiceTier?: "auto" | "default" | "flex" | "priority"
}

type OpenAIProviderConfig = BaseProviderConfig & {
	provider: "openai"
	openAiModelId?: string
	openAiBaseUrl?: string
	openAiApiKey?: string
	openAiLegacyFormat?: boolean
	openAiR1FormatEnabled?: boolean
	openAiUseAzure?: boolean
	azureApiVersion?: string
	openAiStreamingEnabled?: boolean
	openAiHeaders?: Record<string, string>
}

type OpenRouterProviderConfig = BaseProviderConfig & {
	provider: "openrouter"
	openRouterModelId?: string
	openRouterApiKey?: string
	openRouterBaseUrl?: string
	openRouterSpecificProvider?: string
	openRouterUseMiddleOutTransform?: boolean
	openRouterProviderDataCollection?: "allow" | "deny"
	openRouterProviderSort?: "price" | "throughput" | "latency"
	openRouterZdr?: boolean
}

type OllamaProviderConfig = BaseProviderConfig & {
	provider: "ollama"
	ollamaModelId?: string
	ollamaBaseUrl?: string
	ollamaApiKey?: string
	ollamaNumCtx?: number
}

type LMStudioProviderConfig = BaseProviderConfig & {
	provider: "lmstudio"
	lmStudioModelId?: string
	lmStudioBaseUrl?: string
	lmStudioDraftModelId?: string
	lmStudioSpeculativeDecodingEnabled?: boolean
}

type GlamaProviderConfig = BaseProviderConfig & {
	provider: "glama"
	glamaModelId?: string
	glamaApiKey?: string
}

type LiteLLMProviderConfig = BaseProviderConfig & {
	provider: "litellm"
	litellmModelId?: string
	litellmBaseUrl?: string
	litellmApiKey?: string
	litellmUsePromptCache?: boolean
}

type DeepInfraProviderConfig = BaseProviderConfig & {
	provider: "deepinfra"
	deepInfraModelId?: string
	deepInfraBaseUrl?: string
	deepInfraApiKey?: string
}

type UnboundProviderConfig = BaseProviderConfig & {
	provider: "unbound"
	unboundModelId?: string
	unboundApiKey?: string
}

type RequestyProviderConfig = BaseProviderConfig & {
	provider: "requesty"
	requestyModelId?: string
	requestyBaseUrl?: string
	requestyApiKey?: string
}

type VercelAiGatewayProviderConfig = BaseProviderConfig & {
	provider: "vercel-ai-gateway"
	vercelAiGatewayModelId?: string
	vercelAiGatewayApiKey?: string
}

type IOIntelligenceProviderConfig = BaseProviderConfig & {
	provider: "io-intelligence"
	ioIntelligenceModelId?: string
	ioIntelligenceApiKey?: string
}

type OVHCloudProviderConfig = BaseProviderConfig & {
	provider: "ovhcloud"
	ovhCloudAiEndpointsModelId?: string
	ovhCloudAiEndpointsApiKey?: string
	ovhCloudAiEndpointsBaseUrl?: string
}

type InceptionProviderConfig = BaseProviderConfig & {
	provider: "inception"
	inceptionLabsModelId?: string
	inceptionLabsBaseUrl?: string
	inceptionLabsApiKey?: string
}

type BedrockProviderConfig = BaseProviderConfig & {
	provider: "bedrock"
	apiModelId?: string
	awsAccessKey?: string
	awsSecretKey?: string
	awsSessionToken?: string
	awsRegion?: string
	awsUseCrossRegionInference?: boolean
	awsUsePromptCache?: boolean
	awsProfile?: string
	awsUseProfile?: boolean
	awsApiKey?: string
	awsUseApiKey?: boolean
	awsCustomArn?: string
	awsModelContextWindow?: number
	awsBedrockEndpointEnabled?: boolean
	awsBedrockEndpoint?: string
	awsBedrock1MContext?: boolean
}

type VertexProviderConfig = BaseProviderConfig & {
	provider: "vertex"
	apiModelId?: string
	vertexKeyFile?: string
	vertexJsonCredentials?: string
	vertexProjectId?: string
	vertexRegion?: string
	enableUrlContext?: boolean
	enableGrounding?: boolean
}

type GeminiProviderConfig = BaseProviderConfig & {
	provider: "gemini"
	apiModelId?: string
	geminiApiKey?: string
	googleGeminiBaseUrl?: string
	enableUrlContext?: boolean
	enableGrounding?: boolean
}

type GeminiCliProviderConfig = BaseProviderConfig & {
	provider: "gemini-cli"
	apiModelId?: string
	geminiCliOAuthPath?: string
	geminiCliProjectId?: string
}

type MistralProviderConfig = BaseProviderConfig & {
	provider: "mistral"
	apiModelId?: string
	mistralApiKey?: string
	mistralCodestralUrl?: string
}

type MoonshotProviderConfig = BaseProviderConfig & {
	provider: "moonshot"
	apiModelId?: string
	moonshotBaseUrl?: string
	moonshotApiKey?: string
}

type MinimaxProviderConfig = BaseProviderConfig & {
	provider: "minimax"
	apiModelId?: string
	minimaxBaseUrl?: string
	minimaxApiKey?: string
}

type DeepSeekProviderConfig = BaseProviderConfig & {
	provider: "deepseek"
	apiModelId?: string
	deepSeekBaseUrl?: string
	deepSeekApiKey?: string
}

type DoubaoProviderConfig = BaseProviderConfig & {
	provider: "doubao"
	apiModelId?: string
	doubaoBaseUrl?: string
	doubaoApiKey?: string
}

type QwenCodeProviderConfig = BaseProviderConfig & {
	provider: "qwen-code"
	apiModelId?: string
	qwenCodeOauthPath?: string
}

type XAIProviderConfig = BaseProviderConfig & {
	provider: "xai"
	apiModelId?: string
	xaiApiKey?: string
}

type GroqProviderConfig = BaseProviderConfig & {
	provider: "groq"
	apiModelId?: string
	groqApiKey?: string
}

type ChutesProviderConfig = BaseProviderConfig & {
	provider: "chutes"
	apiModelId?: string
	chutesApiKey?: string
}

type CerebrasProviderConfig = BaseProviderConfig & {
	provider: "cerebras"
	apiModelId?: string
	cerebrasApiKey?: string
}

type SambaNovaProviderConfig = BaseProviderConfig & {
	provider: "sambanova"
	apiModelId?: string
	sambaNovaApiKey?: string
}

type ZAIProviderConfig = BaseProviderConfig & {
	provider: "zai"
	apiModelId?: string
	zaiApiKey?: string
	zaiApiLine?: "international_coding" | "china_coding"
}

type FireworksProviderConfig = BaseProviderConfig & {
	provider: "fireworks"
	apiModelId?: string
	fireworksApiKey?: string
}

type FeatherlessProviderConfig = BaseProviderConfig & {
	provider: "featherless"
	apiModelId?: string
	featherlessApiKey?: string
}

type RooProviderConfig = BaseProviderConfig & {
	provider: "roo"
	apiModelId?: string
}

type ClaudeCodeProviderConfig = BaseProviderConfig & {
	provider: "claude-code"
	apiModelId?: string
	claudeCodePath?: string
	claudeCodeMaxOutputTokens?: number
}

type VSCodeLMProviderConfig = BaseProviderConfig & {
	provider: "vscode-lm"
	vsCodeLmModelSelector?: {
		vendor?: string
		family?: string
		version?: string
		id?: string
	}
}

type HuggingFaceProviderConfig = BaseProviderConfig & {
	provider: "huggingface"
	huggingFaceModelId?: string
	huggingFaceApiKey?: string
	huggingFaceInferenceProvider?: string
}

type SyntheticProviderConfig = BaseProviderConfig & {
	provider: "synthetic"
	apiModelId?: string
	syntheticApiKey?: string
}

type VirtualQuotaFallbackProviderConfig = BaseProviderConfig & {
	provider: "virtual-quota-fallback"
	profiles?: Array<{
		profileName?: string
		profileId?: string
		profileLimits?: {
			tokensPerMinute?: number
			tokensPerHour?: number
			tokensPerDay?: number
			requestsPerMinute?: number
			requestsPerHour?: number
			requestsPerDay?: number
		}
	}>
}

type HumanRelayProviderConfig = BaseProviderConfig & {
	provider: "human-relay"
	// No model ID field
}

type FakeAIProviderConfig = BaseProviderConfig & {
	provider: "fake-ai"
	fakeAi?: unknown
}

// Discriminated union of all provider configs
export type ProviderConfig =
	| KilocodeProviderConfig
	| AnthropicProviderConfig
	| OpenAINativeProviderConfig
	| OpenAIProviderConfig
	| OpenRouterProviderConfig
	| OllamaProviderConfig
	| LMStudioProviderConfig
	| GlamaProviderConfig
	| LiteLLMProviderConfig
	| DeepInfraProviderConfig
	| UnboundProviderConfig
	| RequestyProviderConfig
	| VercelAiGatewayProviderConfig
	| IOIntelligenceProviderConfig
	| OVHCloudProviderConfig
	| InceptionProviderConfig
	| BedrockProviderConfig
	| VertexProviderConfig
	| GeminiProviderConfig
	| GeminiCliProviderConfig
	| MistralProviderConfig
	| MoonshotProviderConfig
	| MinimaxProviderConfig
	| DeepSeekProviderConfig
	| DoubaoProviderConfig
	| QwenCodeProviderConfig
	| XAIProviderConfig
	| GroqProviderConfig
	| ChutesProviderConfig
	| CerebrasProviderConfig
	| SambaNovaProviderConfig
	| ZAIProviderConfig
	| FireworksProviderConfig
	| FeatherlessProviderConfig
	| RooProviderConfig
	| ClaudeCodeProviderConfig
	| VSCodeLMProviderConfig
	| HuggingFaceProviderConfig
	| SyntheticProviderConfig
	| VirtualQuotaFallbackProviderConfig
	| HumanRelayProviderConfig
	| FakeAIProviderConfig

// Type guards
export function isValidConfig(config: unknown): config is CLIConfig {
	return (
		typeof config === "object" &&
		config !== null &&
		"version" in config &&
		"provider" in config &&
		"providers" in config
	)
}

export function isProviderConfig(provider: unknown): provider is ProviderConfig {
	return typeof provider === "object" && provider !== null && "id" in provider && "provider" in provider
}
