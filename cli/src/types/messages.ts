// Local type definitions for CLI application
// These mirror the types from the main extension but are defined locally to avoid import issues

// Import model-related types
import type { RouterName, ModelInfo, ModelRecord, RouterModels } from "../constants/providers/models.js"

// Re-export for external use
export type { RouterName, ModelInfo, ModelRecord, RouterModels }

export interface ExtensionMessage {
	type: string
	action?: string
	text?: string
	state?: any
	images?: string[]
	chatMessages?: any
	values?: Record<string, any>
	[key: string]: any
}

export interface WebviewMessage {
	type: string
	text?: string
	images?: string[]
	bool?: boolean
	value?: number
	commands?: string[]
	apiConfiguration?: any
	mode?: string
	values?: Record<string, any>
	askResponse?: string
	terminalOperation?: string
	context?: string
	invoke?: string
	action?: string
	[key: string]: any
}

export interface ExtensionChatMessage {
	ts: number
	type: "ask" | "say"
	ask?: string
	say?: string
	text?: string
	images?: string[]
	partial?: boolean
	isProtected?: boolean
	isAnswered?: boolean
	checkpoint?: any
	metadata?: any
}

export interface HistoryItem {
	id: string
	ts: number
	task: string
	workspace: string
	mode?: string
	isFavorited?: boolean
	fileNotfound?: boolean
	rootTaskId?: string
	parentTaskId?: string
	number?: number
}

// Provider Names
export type ProviderName =
	| "anthropic"
	| "claude-code"
	| "glama"
	| "openrouter"
	| "bedrock"
	| "vertex"
	| "openai"
	| "ollama"
	| "vscode-lm"
	| "lmstudio"
	| "gemini"
	| "openai-native"
	| "mistral"
	| "moonshot"
	| "deepseek"
	| "deepinfra"
	| "doubao"
	| "qwen-code"
	| "unbound"
	| "requesty"
	| "human-relay"
	| "fake-ai"
	| "xai"
	| "groq"
	| "chutes"
	| "litellm"
	| "kilocode"
	| "gemini-cli"
	| "virtual-quota-fallback"
	| "huggingface"
	| "cerebras"
	| "sambanova"
	| "zai"
	| "fireworks"
	| "featherless"
	| "io-intelligence"
	| "roo"
	| "vercel-ai-gateway"

// Provider Settings Entry for profile metadata
export interface ProviderSettingsEntry {
	id: string
	name: string
	apiProvider?: ProviderName
	modelId?: string
}

// Comprehensive Provider Settings
export interface ProviderSettings {
	// Base settings
	apiProvider?: ProviderName
	includeMaxTokens?: boolean
	diffEnabled?: boolean
	todoListEnabled?: boolean
	fuzzyMatchThreshold?: number
	modelTemperature?: number | null
	rateLimitSeconds?: number
	consecutiveMistakeLimit?: number
	enableReasoningEffort?: boolean
	reasoningEffort?: "low" | "medium" | "high"
	modelMaxTokens?: number
	modelMaxThinkingTokens?: number
	verbosity?: "concise" | "normal" | "verbose"

	// Common model fields
	apiModelId?: string

	// Anthropic
	apiKey?: string
	anthropicBaseUrl?: string
	anthropicUseAuthToken?: boolean
	anthropicBeta1MContext?: boolean

	// Claude Code
	claudeCodePath?: string
	claudeCodeMaxOutputTokens?: number

	// Glama
	glamaModelId?: string
	glamaApiKey?: string

	// OpenRouter
	openRouterApiKey?: string
	openRouterModelId?: string
	openRouterBaseUrl?: string
	openRouterSpecificProvider?: string
	openRouterUseMiddleOutTransform?: boolean
	openRouterProviderDataCollection?: "allow" | "deny"
	openRouterProviderSort?: "price" | "throughput" | "latency"

	// Bedrock
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

	// Vertex
	vertexKeyFile?: string
	vertexJsonCredentials?: string
	vertexProjectId?: string
	vertexRegion?: string
	enableUrlContext?: boolean
	enableGrounding?: boolean

	// OpenAI Compatible
	openAiBaseUrl?: string
	openAiApiKey?: string
	openAiLegacyFormat?: boolean
	openAiR1FormatEnabled?: boolean
	openAiModelId?: string
	openAiUseAzure?: boolean
	azureApiVersion?: string
	openAiStreamingEnabled?: boolean
	openAiHeaders?: Record<string, string>

	// OpenAI Native
	openAiNativeApiKey?: string
	openAiNativeBaseUrl?: string
	openAiNativeServiceTier?: "default" | "flex" | "priority"

	// Ollama
	ollamaModelId?: string
	ollamaBaseUrl?: string
	ollamaApiKey?: string

	// VS Code LM
	vsCodeLmModelSelector?: {
		vendor?: string
		family?: string
		version?: string
		id?: string
	}

	// LM Studio
	lmStudioModelId?: string
	lmStudioBaseUrl?: string
	lmStudioDraftModelId?: string
	lmStudioSpeculativeDecodingEnabled?: boolean

	// Gemini
	geminiApiKey?: string
	googleGeminiBaseUrl?: string

	// Gemini CLI
	geminiCliOAuthPath?: string
	geminiCliProjectId?: string

	// Mistral
	mistralApiKey?: string
	mistralCodestralUrl?: string

	// DeepSeek
	deepSeekBaseUrl?: string
	deepSeekApiKey?: string

	// DeepInfra
	deepInfraBaseUrl?: string
	deepInfraApiKey?: string
	deepInfraModelId?: string

	// Doubao
	doubaoBaseUrl?: string
	doubaoApiKey?: string

	// Moonshot
	moonshotBaseUrl?: "https://api.moonshot.ai/v1" | "https://api.moonshot.cn/v1"
	moonshotApiKey?: string

	// Unbound
	unboundApiKey?: string
	unboundModelId?: string

	// Requesty
	requestyBaseUrl?: string
	requestyApiKey?: string
	requestyModelId?: string

	// XAI
	xaiApiKey?: string

	// Groq
	groqApiKey?: string

	// Hugging Face
	huggingFaceApiKey?: string
	huggingFaceModelId?: string
	huggingFaceInferenceProvider?: string

	// Chutes
	chutesApiKey?: string

	// LiteLLM
	litellmBaseUrl?: string
	litellmApiKey?: string
	litellmModelId?: string
	litellmUsePromptCache?: boolean

	// Cerebras
	cerebrasApiKey?: string

	// SambaNova
	sambaNovaApiKey?: string

	// Kilocode
	kilocodeToken?: string
	kilocodeOrganizationId?: string
	kilocodeModel?: string
	kilocodeTesterWarningsDisabledUntil?: number

	// Virtual Quota Fallback
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

	// ZAI
	zaiApiKey?: string
	zaiApiLine?: "international_coding" | "international" | "china_coding" | "china"

	// Fireworks
	fireworksApiKey?: string

	// Featherless
	featherlessApiKey?: string

	// IO Intelligence
	ioIntelligenceModelId?: string
	ioIntelligenceApiKey?: string

	// Qwen Code
	qwenCodeOauthPath?: string

	// Vercel AI Gateway
	vercelAiGatewayApiKey?: string
	vercelAiGatewayModelId?: string

	// Allow additional fields for extensibility
	[key: string]: any
}

export interface TodoItem {
	id: string
	text: string
	status: "pending" | "in_progress" | "completed"
	createdAt: number
	updatedAt: number
}

export interface McpServer {
	name: string
	command: string
	args?: string[]
	env?: Record<string, string>
	disabled?: boolean
	alwaysAllow?: boolean
	tools?: McpTool[]
	resources?: McpResource[]
}

export interface McpTool {
	name: string
	description?: string
	alwaysAllow?: boolean
	enabledForPrompt?: boolean
}

export interface McpResource {
	uri: string
	name?: string
	description?: string
}

// Organization Allow List for provider validation
export interface OrganizationAllowList {
	allowAll: boolean
	providers: Record<
		string,
		{
			allowAll: boolean
			models?: string[]
		}
	>
}

export interface ExtensionState {
	version: string
	apiConfiguration: ProviderSettings
	currentApiConfigName?: string
	listApiConfigMeta?: ProviderSettingsEntry[]
	chatMessages: ExtensionChatMessage[]
	clineMessages?: ExtensionChatMessage[] // Cline Legacy
	currentTaskItem?: HistoryItem
	currentTaskTodos?: TodoItem[]
	mode: string
	customModes: any[]
	taskHistoryFullLength: number
	taskHistoryVersion: number
	mcpServers?: McpServer[]
	telemetrySetting: string
	renderContext: "sidebar" | "editor" | "cli"
	cwd?: string
	organizationAllowList?: OrganizationAllowList
	routerModels?: RouterModels
	[key: string]: any
}

export type Mode = string

export interface ModeConfig {
	slug: string
	name: string
	description?: string
	systemPrompt?: string
	rules?: string[]
	source?: "global" | "project"
}
