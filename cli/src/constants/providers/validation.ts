import type { ProviderName } from "../../types/messages.js"

/**
 * Configuration map for provider validation requirements.
 * Maps each provider to its required fields that must be non-empty when selected.
 */
export const PROVIDER_REQUIRED_FIELDS: Record<ProviderName, string[]> = {
	kilocode: ["kilocodeToken", "kilocodeModel"],
	anthropic: ["apiKey", "apiModelId"],
	"openai-native": ["openAiNativeApiKey", "apiModelId"],
	"openai-codex": ["apiModelId"],
	openrouter: ["openRouterApiKey", "openRouterModelId"],
	ollama: ["ollamaBaseUrl", "ollamaModelId"],
	lmstudio: ["lmStudioBaseUrl", "lmStudioModelId"],
	bedrock: ["awsRegion", "apiModelId"], // Auth fields handled in handleSpecialValidations (supports API key, profile, or direct credentials)
	gemini: ["geminiApiKey", "apiModelId"],
	"claude-code": ["claudeCodePath", "apiModelId"],
	mistral: ["mistralApiKey", "apiModelId"],
	groq: ["groqApiKey", "apiModelId"],
	deepseek: ["deepSeekApiKey", "apiModelId"],
	xai: ["xaiApiKey", "apiModelId"],
	openai: ["openAiApiKey"],
	"openai-responses": ["openAiApiKey"],
	cerebras: ["cerebrasApiKey", "apiModelId"],
	glama: ["glamaApiKey", "glamaModelId"],
	"nano-gpt": ["nanoGptApiKey", "nanoGptModelId"],
	huggingface: ["huggingFaceApiKey", "huggingFaceModelId", "huggingFaceInferenceProvider"],
	litellm: ["litellmBaseUrl", "litellmApiKey", "litellmModelId"],
	moonshot: ["moonshotBaseUrl", "moonshotApiKey", "apiModelId"],
	doubao: ["doubaoApiKey", "apiModelId"],
	chutes: ["chutesApiKey", "apiModelId"],
	sambanova: ["sambaNovaApiKey", "apiModelId"],
	fireworks: ["fireworksApiKey", "apiModelId"],
	featherless: ["featherlessApiKey", "apiModelId"],
	deepinfra: ["deepInfraApiKey", "deepInfraModelId"],
	"io-intelligence": ["ioIntelligenceApiKey", "ioIntelligenceModelId"],
	"qwen-code": ["qwenCodeOauthPath", "apiModelId"],
	"gemini-cli": ["geminiCliOAuthPath", "geminiCliProjectId", "apiModelId"],
	zai: ["zaiApiKey", "zaiApiLine", "apiModelId"],
	unbound: ["unboundApiKey", "unboundModelId"],
	requesty: ["requestyApiKey", "requestyModelId"],
	roo: ["apiModelId"],
	"vercel-ai-gateway": ["vercelAiGatewayApiKey", "vercelAiGatewayModelId"],
	"fake-ai": ["apiModelId"],
	"human-relay": ["apiModelId"],
	ovhcloud: ["ovhCloudAiEndpointsApiKey", "ovhCloudAiEndpointsModelId"],
	inception: ["inceptionLabsApiKey", "inceptionLabsModelId"],
	synthetic: ["syntheticApiKey", "apiModelId"],
	"sap-ai-core": ["sapAiCoreServiceKey", "sapAiCoreResourceGroup", "sapAiCoreDeploymentId", "sapAiCoreModelId"],
	// Special cases handled separately in handleSpecialValidations
	vertex: [], // Has special validation logic (either/or fields)
	"vscode-lm": [], // Has nested object validation
	"virtual-quota-fallback": [], // Has array validation
	minimax: ["minimaxBaseUrl", "minimaxApiKey", "apiModelId"],
	baseten: ["basetenApiKey", "apiModelId"],
}
