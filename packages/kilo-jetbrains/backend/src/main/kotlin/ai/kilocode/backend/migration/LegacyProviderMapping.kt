package ai.kilocode.backend.migration

/**
 * Port of packages/kilo-vscode/src/legacy-migration/provider-mapping.ts
 *
 * Maps legacy apiProvider values to new provider IDs and key fields.
 */
data class ProviderMapping(
    /** New provider ID for the auth endpoint (PUT /auth/:id) */
    val id: String,
    /** Field name in provider settings holding the primary API key */
    val key: String,
    /** Display name */
    val name: String,
    /** Field holding model ID (defaults to "apiModelId") */
    val modelField: String? = null,
    /** Field holding custom base URL */
    val urlField: String? = null,
    /** Field holding organization/account ID */
    val organizationIdField: String? = null,
    /** VS Code secret key holding OAuth credentials stored separately */
    val oauthSecretKey: String? = null,
    /** If true, skip auth.set — uses env/ADC-based auth (e.g. Vertex AI) */
    val skipAuth: Boolean = false,
    /** Legacy settings fields to write as provider config options */
    val configFields: List<ConfigField>? = null,
)

data class ConfigField(
    val from: String,
    val option: String,
)

val PROVIDER_MAP: Map<String, ProviderMapping> = mapOf(
    "anthropic" to ProviderMapping(id = "anthropic", key = "apiKey", name = "Anthropic"),
    "openrouter" to ProviderMapping(id = "openrouter", key = "openRouterApiKey", name = "OpenRouter", modelField = "openRouterModelId"),
    "openai" to ProviderMapping(id = "openai-compatible", key = "openAiApiKey", name = "OpenAI (Compatible)", modelField = "openAiModelId", urlField = "openAiBaseUrl"),
    "openai-native" to ProviderMapping(id = "openai", key = "openAiNativeApiKey", name = "OpenAI", urlField = "openAiNativeBaseUrl"),
    "openai-responses" to ProviderMapping(id = "openai", key = "openAiApiKey", name = "OpenAI", modelField = "openAiModelId"),
    "gemini" to ProviderMapping(id = "google", key = "geminiApiKey", name = "Google Gemini", urlField = "googleGeminiBaseUrl"),
    "vertex" to ProviderMapping(
        id = "google-vertex",
        key = "vertexJsonCredentials",
        name = "Google Vertex AI",
        skipAuth = true,
        configFields = listOf(
            ConfigField(from = "vertexProjectId", option = "project"),
            ConfigField(from = "vertexRegion", option = "location"),
        ),
    ),
    "bedrock" to ProviderMapping(id = "amazon-bedrock", key = "awsAccessKey", name = "AWS Bedrock"),
    "deepseek" to ProviderMapping(id = "deepseek", key = "deepSeekApiKey", name = "DeepSeek", urlField = "deepSeekBaseUrl"),
    "mistral" to ProviderMapping(id = "mistral", key = "mistralApiKey", name = "Mistral"),
    "groq" to ProviderMapping(id = "groq", key = "groqApiKey", name = "Groq"),
    "xai" to ProviderMapping(id = "xai", key = "xaiApiKey", name = "xAI"),
    "fireworks" to ProviderMapping(id = "fireworks", key = "fireworksApiKey", name = "Fireworks"),
    "featherless" to ProviderMapping(id = "featherless", key = "featherlessApiKey", name = "Featherless"),
    "cerebras" to ProviderMapping(id = "cerebras", key = "cerebrasApiKey", name = "Cerebras"),
    "sambanova" to ProviderMapping(id = "sambanova", key = "sambaNovaApiKey", name = "SambaNova"),
    "ollama" to ProviderMapping(id = "ollama", key = "ollamaApiKey", name = "Ollama", modelField = "ollamaModelId", urlField = "ollamaBaseUrl"),
    "lmstudio" to ProviderMapping(id = "lmstudio", key = "lmStudioBaseUrl", name = "LM Studio", modelField = "lmStudioModelId", urlField = "lmStudioBaseUrl"),
    "kilocode" to ProviderMapping(id = "kilo", key = "kilocodeToken", name = "Kilo (Gateway)", modelField = "kilocodeModel", organizationIdField = "kilocodeOrganizationId"),
    "litellm" to ProviderMapping(id = "litellm", key = "litellmApiKey", name = "LiteLLM", modelField = "litellmModelId", urlField = "litellmBaseUrl"),
    "deepinfra" to ProviderMapping(id = "deepinfra", key = "deepInfraApiKey", name = "DeepInfra", modelField = "deepInfraModelId", urlField = "deepInfraBaseUrl"),
    "chutes" to ProviderMapping(id = "chutes", key = "chutesApiKey", name = "Chutes"),
    "baseten" to ProviderMapping(id = "baseten", key = "basetenApiKey", name = "Baseten"),
    "corethink" to ProviderMapping(id = "corethink", key = "corethinkApiKey", name = "Corethink"),
    "unbound" to ProviderMapping(id = "unbound", key = "unboundApiKey", name = "Unbound", modelField = "unboundModelId"),
    "requesty" to ProviderMapping(id = "requesty", key = "requestyApiKey", name = "Requesty", modelField = "requestyModelId", urlField = "requestyBaseUrl"),
    "huggingface" to ProviderMapping(id = "huggingface", key = "huggingFaceApiKey", name = "Hugging Face", modelField = "huggingFaceModelId"),
    "io-intelligence" to ProviderMapping(id = "io-intelligence", key = "ioIntelligenceApiKey", name = "IO Intelligence", modelField = "ioIntelligenceModelId"),
    "vercel-ai-gateway" to ProviderMapping(id = "vercel-ai-gateway", key = "vercelAiGatewayApiKey", name = "Vercel AI Gateway", modelField = "vercelAiGatewayModelId"),
    "zai" to ProviderMapping(id = "zai", key = "zaiApiKey", name = "Z.ai"),
    "moonshot" to ProviderMapping(id = "moonshot", key = "moonshotApiKey", name = "Moonshot", urlField = "moonshotBaseUrl"),
    "doubao" to ProviderMapping(id = "doubao", key = "doubaoApiKey", name = "Doubao", urlField = "doubaoBaseUrl"),
    "minimax" to ProviderMapping(id = "minimax", key = "minimaxApiKey", name = "MiniMax", urlField = "minimaxBaseUrl"),
    "ovhcloud" to ProviderMapping(id = "ovhcloud", key = "ovhCloudAiEndpointsApiKey", name = "OVHcloud AI Endpoints", modelField = "ovhCloudAiEndpointsModelId", urlField = "ovhCloudAiEndpointsBaseUrl"),
    "inception" to ProviderMapping(id = "inception", key = "inceptionLabsApiKey", name = "Inception Labs", modelField = "inceptionLabsModelId", urlField = "inceptionLabsBaseUrl"),
    "sap-ai-core" to ProviderMapping(id = "sap-ai-core", key = "sapAiCoreServiceKey", name = "SAP AI Core"),
    "synthetic" to ProviderMapping(id = "synthetic", key = "syntheticApiKey", name = "Synthetic"),
    "apertis" to ProviderMapping(id = "apertis", key = "apertisApiKey", name = "Apertis", modelField = "apertisModelId", urlField = "apertisBaseUrl"),
    "openai-codex" to ProviderMapping(id = "openai", key = "", name = "OpenAI (ChatGPT Plus/Pro)", oauthSecretKey = "openai-codex-oauth-credentials"),
    "nano-gpt" to ProviderMapping(id = "nano-gpt", key = "nanoGptApiKey", name = "NanoGPT", modelField = "nanoGptModelId"),
    "poe" to ProviderMapping(id = "poe", key = "poeApiKey", name = "Poe", modelField = "poeModelId"),
    "aihubmix" to ProviderMapping(id = "aihubmix", key = "aihubmixApiKey", name = "AiHubMix", modelField = "aihubmixModelId", urlField = "aihubmixBaseUrl"),
    "zenmux" to ProviderMapping(id = "zenmux", key = "zenmuxApiKey", name = "ZenMux", modelField = "zenmuxModelId", urlField = "zenmuxBaseUrl"),
)

val UNSUPPORTED_PROVIDERS: Set<String> = setOf(
    "fake-ai",
    "human-relay",
    "vscode-lm",
    "claude-code",
    "qwen-code",
    "virtual-quota-fallback",
    "glama",
    "roo",
)

val DEFAULT_MODE_SLUGS: Set<String> = setOf(
    "code", "build", "architect", "ask", "debug", "orchestrator", "review"
)
