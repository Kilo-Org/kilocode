/**
 * legacy-migration - Maps legacy apiProvider values to new provider IDs and key fields.
 *
 * The legacy extension used flat per-provider key names (e.g. apiKey, openRouterApiKey).
 * The new CLI backend uses a per-provider auth endpoint (PUT /auth/:providerId).
 */

export interface ProviderMapping {
  /** New provider ID for the auth endpoint (PUT /auth/:id) */
  id: string
  /** Field name in LegacyProviderSettings holding the primary API key */
  key: string
  /** Display name for the provider in the wizard UI */
  name: string
  /** Field holding model ID (defaults to "apiModelId") */
  modelField?: string
  /** Field holding custom base URL (to also store in config) */
  urlField?: string
  /** Field holding an organization/account ID (used for OAuth-style auth) */
  organizationIdField?: string
  /** VS Code secret key holding OAuth credentials stored separately from the provider profile */
  oauthSecretKey?: string
  /** If true, skip auth.set entirely — provider uses env/ADC-based auth (e.g. Vertex AI) */
  skipAuth?: boolean
  /** Legacy settings fields to write as provider config options (e.g. project/location for Vertex) */
  configFields?: Array<{ from: string; option: string }>
}

/**
 * Maps legacy `apiProvider` values → new provider info.
 * Providers absent from this map are flagged as unsupported.
 */
export const PROVIDER_MAP: Record<string, ProviderMapping> = {
  anthropic: {
    id: "anthropic",
    key: "apiKey",
    name: "Anthropic",
  },
  openrouter: {
    id: "openrouter",
    key: "openRouterApiKey",
    name: "OpenRouter",
    modelField: "openRouterModelId",
  },
  openai: {
    id: "openai-compatible",
    key: "openAiApiKey",
    name: "OpenAI (Compatible)",
    modelField: "openAiModelId",
    urlField: "openAiBaseUrl",
  },
  "openai-native": {
    id: "openai",
    key: "openAiNativeApiKey",
    name: "OpenAI",
    urlField: "openAiNativeBaseUrl",
  },
  "openai-responses": {
    id: "openai",
    key: "openAiApiKey",
    name: "OpenAI",
    modelField: "openAiModelId",
  },
  gemini: {
    id: "google",
    key: "geminiApiKey",
    name: "Google Gemini",
    urlField: "googleGeminiBaseUrl",
  },
  vertex: {
    id: "google-vertex",
    key: "vertexJsonCredentials",
    name: "Google Vertex AI",
    skipAuth: true,
    configFields: [
      { from: "vertexProjectId", option: "project" },
      { from: "vertexRegion", option: "location" },
    ],
  },
  bedrock: {
    id: "amazon-bedrock",
    key: "awsAccessKey",
    name: "AWS Bedrock",
  },
  deepseek: {
    id: "deepseek",
    key: "deepSeekApiKey",
    name: "DeepSeek",
    urlField: "deepSeekBaseUrl",
  },
  mistral: {
    id: "mistral",
    key: "mistralApiKey",
    name: "Mistral",
  },
  groq: {
    id: "groq",
    key: "groqApiKey",
    name: "Groq",
  },
  xai: {
    id: "xai",
    key: "xaiApiKey",
    name: "xAI",
  },
  fireworks: {
    id: "fireworks",
    key: "fireworksApiKey",
    name: "Fireworks",
  },
  featherless: {
    id: "featherless",
    key: "featherlessApiKey",
    name: "Featherless",
  },
  cerebras: {
    id: "cerebras",
    key: "cerebrasApiKey",
    name: "Cerebras",
  },
  sambanova: {
    id: "sambanova",
    key: "sambaNovaApiKey",
    name: "SambaNova",
  },
  ollama: {
    id: "ollama",
    key: "ollamaApiKey",
    name: "Ollama",
    modelField: "ollamaModelId",
    urlField: "ollamaBaseUrl",
  },
  lmstudio: {
    id: "lmstudio",
    key: "lmStudioBaseUrl",
    name: "LM Studio",
    modelField: "lmStudioModelId",
    urlField: "lmStudioBaseUrl",
  },
  kilocode: {
    id: "kilo",
    key: "kilocodeToken",
    name: "Kilo (Gateway)",
    modelField: "kilocodeModel",
    organizationIdField: "kilocodeOrganizationId",
  },
  litellm: {
    id: "litellm",
    key: "litellmApiKey",
    name: "LiteLLM",
    modelField: "litellmModelId",
    urlField: "litellmBaseUrl",
  },
  deepinfra: {
    id: "deepinfra",
    key: "deepInfraApiKey",
    name: "DeepInfra",
    modelField: "deepInfraModelId",
    urlField: "deepInfraBaseUrl",
  },
  chutes: {
    id: "chutes",
    key: "chutesApiKey",
    name: "Chutes",
  },
  baseten: {
    id: "baseten",
    key: "basetenApiKey",
    name: "Baseten",
  },
  corethink: {
    id: "corethink",
    key: "corethinkApiKey",
    name: "Corethink",
  },
  unbound: {
    id: "unbound",
    key: "unboundApiKey",
    name: "Unbound",
    modelField: "unboundModelId",
  },
  requesty: {
    id: "requesty",
    key: "requestyApiKey",
    name: "Requesty",
    modelField: "requestyModelId",
    urlField: "requestyBaseUrl",
  },
  huggingface: {
    id: "huggingface",
    key: "huggingFaceApiKey",
    name: "Hugging Face",
    modelField: "huggingFaceModelId",
  },
  "io-intelligence": {
    id: "io-intelligence",
    key: "ioIntelligenceApiKey",
    name: "IO Intelligence",
    modelField: "ioIntelligenceModelId",
  },
  "vercel-ai-gateway": {
    id: "vercel-ai-gateway",
    key: "vercelAiGatewayApiKey",
    name: "Vercel AI Gateway",
    modelField: "vercelAiGatewayModelId",
  },
  zai: {
    id: "zai",
    key: "zaiApiKey",
    name: "Z.ai",
  },
  moonshot: {
    id: "moonshot",
    key: "moonshotApiKey",
    name: "Moonshot",
    urlField: "moonshotBaseUrl",
  },
  doubao: {
    id: "doubao",
    key: "doubaoApiKey",
    name: "Doubao",
    urlField: "doubaoBaseUrl",
  },
  minimax: {
    id: "minimax",
    key: "minimaxApiKey",
    name: "MiniMax",
    urlField: "minimaxBaseUrl",
  },
  ovhcloud: {
    id: "ovhcloud",
    key: "ovhCloudAiEndpointsApiKey",
    name: "OVHcloud AI Endpoints",
    modelField: "ovhCloudAiEndpointsModelId",
    urlField: "ovhCloudAiEndpointsBaseUrl",
  },
  inception: {
    id: "inception",
    key: "inceptionLabsApiKey",
    name: "Inception Labs",
    modelField: "inceptionLabsModelId",
    urlField: "inceptionLabsBaseUrl",
  },
  "sap-ai-core": {
    id: "sap-ai-core",
    key: "sapAiCoreServiceKey",
    name: "SAP AI Core",
  },
  synthetic: {
    id: "synthetic",
    key: "syntheticApiKey",
    name: "Synthetic",
  },
  "openai-codex": {
    id: "openai",
    key: "",
    name: "OpenAI (ChatGPT Plus/Pro)",
    oauthSecretKey: "openai-codex-oauth-credentials",
  },
  "nano-gpt": {
    id: "nano-gpt",
    key: "nanoGptApiKey",
    name: "NanoGPT",
    modelField: "nanoGptModelId",
  },
  poe: {
    id: "poe",
    key: "poeApiKey",
    name: "Poe",
    modelField: "poeModelId",
  },
  aihubmix: {
    id: "aihubmix",
    key: "aihubmixApiKey",
    name: "AiHubMix",
    modelField: "aihubmixModelId",
    urlField: "aihubmixBaseUrl",
  },
  zenmux: {
    id: "zenmux",
    key: "zenmuxApiKey",
    name: "ZenMux",
    modelField: "zenmuxModelId",
    urlField: "zenmuxBaseUrl",
  },
}

/** Providers that have no equivalent in the new CLI backend */
export const UNSUPPORTED_PROVIDERS = new Set([
  "fake-ai",
  "human-relay",
  "vscode-lm",
  "claude-code",
  "qwen-code",
  "virtual-quota-fallback",
  "glama",
  "roo",
  "apertis",
])

/** Built-in default mode slugs that should not be migrated */
export const DEFAULT_MODE_SLUGS = new Set(["code", "build", "architect", "ask", "debug", "orchestrator", "review"])
