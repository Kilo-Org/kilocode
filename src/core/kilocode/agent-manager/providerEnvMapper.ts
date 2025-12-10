import type { ProviderSettings } from "@roo-code/types"

type EnvOverrides = Record<string, string>

const hasValue = (env: Record<string, string | undefined>, key: string): boolean => {
	const value = env[key]
	return typeof value === "string" && value.trim().length > 0
}

const parseEnvBoolean = (value: string | undefined): boolean | undefined => {
	if (value === undefined) {
		return undefined
	}
	const normalized = value.toLowerCase().trim()
	if (["true", "1", "yes"].includes(normalized)) {
		return true
	}
	if (["false", "0", "no"].includes(normalized)) {
		return false
	}
	return undefined
}

const toEnvString = (value: unknown): string | undefined => {
	if (value === undefined || value === null) {
		return undefined
	}
	if (typeof value === "string") {
		return value.trim() === "" ? undefined : value
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value)
	}
	return undefined
}

const addEnvValue = (target: EnvOverrides, key: string, value: unknown): void => {
	const stringValue = toEnvString(value)
	if (stringValue !== undefined) {
		target[key] = stringValue
	}
}

const getMissingProviderEnv = (providerType: string, env: Record<string, string | undefined>): string[] => {
	const missing: string[] = []

	switch (providerType) {
		case "kilocode": {
			if (!hasValue(env, "KILOCODE_TOKEN")) missing.push("KILOCODE_TOKEN")
			if (!hasValue(env, "KILOCODE_MODEL")) missing.push("KILOCODE_MODEL")
			break
		}
		case "anthropic": {
			if (!hasValue(env, "KILO_API_KEY")) missing.push("KILO_API_KEY")
			if (!hasValue(env, "KILO_API_MODEL_ID")) missing.push("KILO_API_MODEL_ID")
			break
		}
		case "openai-native": {
			if (!hasValue(env, "KILO_OPENAI_NATIVE_API_KEY")) missing.push("KILO_OPENAI_NATIVE_API_KEY")
			if (!hasValue(env, "KILO_API_MODEL_ID")) missing.push("KILO_API_MODEL_ID")
			break
		}
		case "openai": {
			if (!hasValue(env, "KILO_OPENAI_API_KEY")) missing.push("KILO_OPENAI_API_KEY")
			if (!hasValue(env, "KILO_OPENAI_MODEL_ID")) missing.push("KILO_OPENAI_MODEL_ID")
			break
		}
		case "openrouter": {
			if (!hasValue(env, "KILO_OPENROUTER_API_KEY")) missing.push("KILO_OPENROUTER_API_KEY")
			if (!hasValue(env, "KILO_OPENROUTER_MODEL_ID")) missing.push("KILO_OPENROUTER_MODEL_ID")
			break
		}
		case "ollama": {
			if (!hasValue(env, "KILO_OLLAMA_MODEL_ID")) missing.push("KILO_OLLAMA_MODEL_ID")
			break
		}
		case "bedrock": {
			if (!hasValue(env, "KILO_API_MODEL_ID")) missing.push("KILO_API_MODEL_ID")
			if (!hasValue(env, "KILO_AWS_REGION")) missing.push("KILO_AWS_REGION")

			const hasAwsKeys = hasValue(env, "KILO_AWS_ACCESS_KEY") && hasValue(env, "KILO_AWS_SECRET_KEY")
			const useProfile = parseEnvBoolean(env["KILO_AWS_USE_PROFILE"]) ?? false
			const hasProfile = useProfile && hasValue(env, "KILO_AWS_PROFILE")
			const useApiKey = parseEnvBoolean(env["KILO_AWS_USE_API_KEY"]) ?? false
			const hasApiKey = useApiKey && hasValue(env, "KILO_AWS_API_KEY")

			if (!hasAwsKeys && !hasProfile && !hasApiKey) {
				missing.push("KILO_AWS_ACCESS_KEY + KILO_AWS_SECRET_KEY (or KILO_AWS_PROFILE or KILO_AWS_API_KEY)")
			}
			break
		}
		case "vertex": {
			if (!hasValue(env, "KILO_API_MODEL_ID")) missing.push("KILO_API_MODEL_ID")
			if (!hasValue(env, "KILO_VERTEX_PROJECT_ID")) missing.push("KILO_VERTEX_PROJECT_ID")
			if (!hasValue(env, "KILO_VERTEX_REGION")) missing.push("KILO_VERTEX_REGION")

			const hasKeyFile = hasValue(env, "KILO_VERTEX_KEY_FILE")
			const hasJson = hasValue(env, "KILO_VERTEX_JSON_CREDENTIALS")
			if (!hasKeyFile && !hasJson) {
				missing.push("KILO_VERTEX_KEY_FILE or KILO_VERTEX_JSON_CREDENTIALS")
			}
			break
		}
		case "gemini": {
			if (!hasValue(env, "KILO_GEMINI_API_KEY")) missing.push("KILO_GEMINI_API_KEY")
			if (!hasValue(env, "KILO_API_MODEL_ID")) missing.push("KILO_API_MODEL_ID")
			break
		}
		case "mistral": {
			if (!hasValue(env, "KILO_MISTRAL_API_KEY")) missing.push("KILO_MISTRAL_API_KEY")
			if (!hasValue(env, "KILO_API_MODEL_ID")) missing.push("KILO_API_MODEL_ID")
			break
		}
		case "groq": {
			if (!hasValue(env, "KILO_GROQ_API_KEY")) missing.push("KILO_GROQ_API_KEY")
			if (!hasValue(env, "KILO_API_MODEL_ID")) missing.push("KILO_API_MODEL_ID")
			break
		}
		case "deepseek": {
			if (!hasValue(env, "KILO_DEEPSEEK_API_KEY")) missing.push("KILO_DEEPSEEK_API_KEY")
			if (!hasValue(env, "KILO_API_MODEL_ID")) missing.push("KILO_API_MODEL_ID")
			break
		}
		case "xai": {
			if (!hasValue(env, "KILO_XAI_API_KEY")) missing.push("KILO_XAI_API_KEY")
			if (!hasValue(env, "KILO_API_MODEL_ID")) missing.push("KILO_API_MODEL_ID")
			break
		}
		default:
			break
	}

	return missing
}

/**
 * Map the VS Code extension's provider configuration to CLI environment variables.
 * - Only sets values provided by the extension; user-defined env vars remain intact.
 * - Validates required fields for the chosen provider against the merged env before
 *   injecting `KILO_PROVIDER_TYPE` to avoid breaking spawns with partial configs.
 * - Provider highlights: kilocode → KILOCODE_TOKEN/KILOCODE_MODEL (+org);
 *   openrouter → KILO_OPENROUTER_API_KEY/KILO_OPENROUTER_MODEL_ID (+base/specific flags);
 *   anthropic/openai/openai-native → API key + model ids; ollama → KILO_OLLAMA_MODEL_ID (+base/api key/num ctx);
 *   bedrock → AWS auth + region/model; vertex/gemini/mistral/groq/deepseek/xai map to their API key/model env pairs.
 * - Logs keys (not secrets) for traceability.
 */
export const buildProviderEnvOverrides = (
	apiConfiguration: ProviderSettings | undefined,
	baseEnv: NodeJS.ProcessEnv,
	log: (message: string) => void,
	debugLog: (message: string) => void,
): EnvOverrides => {
	if (!apiConfiguration) {
		debugLog("[AgentManager] No apiConfiguration found; using existing environment.")
		return {}
	}

	const providerType = apiConfiguration.apiProvider
	if (!providerType) {
		log("[AgentManager] apiConfiguration missing provider; skipping CLI env injection.")
		return {}
	}

	const overrides: EnvOverrides = {}

	switch (providerType) {
		case "kilocode":
			addEnvValue(overrides, "KILOCODE_TOKEN", apiConfiguration.kilocodeToken)
			addEnvValue(overrides, "KILOCODE_MODEL", apiConfiguration.kilocodeModel)
			addEnvValue(overrides, "KILOCODE_ORGANIZATION_ID", apiConfiguration.kilocodeOrganizationId)
			break
		case "openrouter":
			addEnvValue(overrides, "KILO_OPENROUTER_API_KEY", apiConfiguration.openRouterApiKey)
			addEnvValue(overrides, "KILO_OPENROUTER_MODEL_ID", apiConfiguration.openRouterModelId)
			addEnvValue(overrides, "KILO_OPENROUTER_BASE_URL", apiConfiguration.openRouterBaseUrl)
			addEnvValue(overrides, "KILO_OPENROUTER_SPECIFIC_PROVIDER", apiConfiguration.openRouterSpecificProvider)
			addEnvValue(
				overrides,
				"KILO_OPENROUTER_USE_MIDDLE_OUT_TRANSFORM",
				apiConfiguration.openRouterUseMiddleOutTransform,
			)
			addEnvValue(
				overrides,
				"KILO_OPENROUTER_PROVIDER_DATA_COLLECTION",
				apiConfiguration.openRouterProviderDataCollection,
			)
			addEnvValue(overrides, "KILO_OPENROUTER_PROVIDER_SORT", apiConfiguration.openRouterProviderSort)
			addEnvValue(overrides, "KILO_OPENROUTER_ZDR", apiConfiguration.openRouterZdr)
			break
		case "anthropic":
			addEnvValue(overrides, "KILO_API_KEY", apiConfiguration.apiKey)
			addEnvValue(overrides, "KILO_API_MODEL_ID", apiConfiguration.apiModelId)
			addEnvValue(overrides, "KILO_ANTHROPIC_BASE_URL", apiConfiguration.anthropicBaseUrl)
			addEnvValue(overrides, "KILO_ANTHROPIC_USE_AUTH_TOKEN", apiConfiguration.anthropicUseAuthToken)
			addEnvValue(overrides, "KILO_ANTHROPIC_DEPLOYMENT_NAME", apiConfiguration.anthropicDeploymentName)
			addEnvValue(overrides, "KILO_ANTHROPIC_BETA_1M_CONTEXT", apiConfiguration.anthropicBeta1MContext)
			break
		case "openai":
			addEnvValue(overrides, "KILO_OPENAI_API_KEY", apiConfiguration.openAiApiKey)
			addEnvValue(overrides, "KILO_OPENAI_MODEL_ID", apiConfiguration.openAiModelId)
			addEnvValue(overrides, "KILO_OPENAI_BASE_URL", apiConfiguration.openAiBaseUrl)
			addEnvValue(overrides, "KILO_OPENAI_LEGACY_FORMAT", apiConfiguration.openAiLegacyFormat)
			addEnvValue(overrides, "KILO_OPENAI_R1_FORMAT_ENABLED", apiConfiguration.openAiR1FormatEnabled)
			addEnvValue(overrides, "KILO_OPENAI_USE_AZURE", apiConfiguration.openAiUseAzure)
			addEnvValue(overrides, "KILO_AZURE_API_VERSION", apiConfiguration.azureApiVersion)
			addEnvValue(overrides, "KILO_OPENAI_STREAMING_ENABLED", apiConfiguration.openAiStreamingEnabled)
			addEnvValue(overrides, "KILO_OPENAI_HOST_HEADER", apiConfiguration.openAiHostHeader)
			break
		case "openai-native":
			addEnvValue(overrides, "KILO_OPENAI_NATIVE_API_KEY", apiConfiguration.openAiNativeApiKey)
			addEnvValue(overrides, "KILO_API_MODEL_ID", apiConfiguration.apiModelId)
			addEnvValue(overrides, "KILO_OPENAI_NATIVE_BASE_URL", apiConfiguration.openAiNativeBaseUrl)
			addEnvValue(overrides, "KILO_OPENAI_NATIVE_SERVICE_TIER", apiConfiguration.openAiNativeServiceTier)
			break
		case "ollama":
			addEnvValue(overrides, "KILO_OLLAMA_MODEL_ID", apiConfiguration.ollamaModelId)
			addEnvValue(overrides, "KILO_OLLAMA_BASE_URL", apiConfiguration.ollamaBaseUrl)
			addEnvValue(overrides, "KILO_OLLAMA_API_KEY", apiConfiguration.ollamaApiKey)
			addEnvValue(overrides, "KILO_OLLAMA_NUM_CTX", apiConfiguration.ollamaNumCtx)
			break
		case "bedrock":
			addEnvValue(overrides, "KILO_API_MODEL_ID", apiConfiguration.apiModelId)
			addEnvValue(overrides, "KILO_AWS_REGION", apiConfiguration.awsRegion)
			addEnvValue(overrides, "KILO_AWS_ACCESS_KEY", apiConfiguration.awsAccessKey)
			addEnvValue(overrides, "KILO_AWS_SECRET_KEY", apiConfiguration.awsSecretKey)
			addEnvValue(overrides, "KILO_AWS_SESSION_TOKEN", apiConfiguration.awsSessionToken)
			addEnvValue(overrides, "KILO_AWS_USE_CROSS_REGION_INFERENCE", apiConfiguration.awsUseCrossRegionInference)
			addEnvValue(overrides, "KILO_AWS_USE_GLOBAL_INFERENCE", apiConfiguration.awsUseGlobalInference)
			addEnvValue(overrides, "KILO_AWS_USE_PROMPT_CACHE", apiConfiguration.awsUsePromptCache)
			addEnvValue(overrides, "KILO_AWS_PROFILE", apiConfiguration.awsProfile)
			addEnvValue(overrides, "KILO_AWS_USE_PROFILE", apiConfiguration.awsUseProfile)
			addEnvValue(overrides, "KILO_AWS_API_KEY", apiConfiguration.awsApiKey)
			addEnvValue(overrides, "KILO_AWS_USE_API_KEY", apiConfiguration.awsUseApiKey)
			addEnvValue(overrides, "KILO_AWS_CUSTOM_ARN", apiConfiguration.awsCustomArn)
			addEnvValue(overrides, "KILO_AWS_MODEL_CONTEXT_WINDOW", apiConfiguration.awsModelContextWindow)
			addEnvValue(overrides, "KILO_AWS_BEDROCK_ENDPOINT_ENABLED", apiConfiguration.awsBedrockEndpointEnabled)
			addEnvValue(overrides, "KILO_AWS_BEDROCK_ENDPOINT", apiConfiguration.awsBedrockEndpoint)
			addEnvValue(overrides, "KILO_AWS_BEDROCK_1M_CONTEXT", apiConfiguration.awsBedrock1MContext)
			break
		case "vertex":
			addEnvValue(overrides, "KILO_API_MODEL_ID", apiConfiguration.apiModelId)
			addEnvValue(overrides, "KILO_VERTEX_PROJECT_ID", apiConfiguration.vertexProjectId)
			addEnvValue(overrides, "KILO_VERTEX_REGION", apiConfiguration.vertexRegion)
			addEnvValue(overrides, "KILO_VERTEX_KEY_FILE", apiConfiguration.vertexKeyFile)
			addEnvValue(overrides, "KILO_VERTEX_JSON_CREDENTIALS", apiConfiguration.vertexJsonCredentials)
			addEnvValue(overrides, "KILO_ENABLE_URL_CONTEXT", apiConfiguration.enableUrlContext)
			addEnvValue(overrides, "KILO_ENABLE_GROUNDING", apiConfiguration.enableGrounding)
			break
		case "gemini":
			addEnvValue(overrides, "KILO_GEMINI_API_KEY", apiConfiguration.geminiApiKey)
			addEnvValue(overrides, "KILO_API_MODEL_ID", apiConfiguration.apiModelId)
			addEnvValue(overrides, "KILO_GOOGLE_GEMINI_BASE_URL", apiConfiguration.googleGeminiBaseUrl)
			addEnvValue(overrides, "KILO_ENABLE_URL_CONTEXT", apiConfiguration.enableUrlContext)
			addEnvValue(overrides, "KILO_ENABLE_GROUNDING", apiConfiguration.enableGrounding)
			break
		case "mistral":
			addEnvValue(overrides, "KILO_MISTRAL_API_KEY", apiConfiguration.mistralApiKey)
			addEnvValue(overrides, "KILO_API_MODEL_ID", apiConfiguration.apiModelId)
			addEnvValue(overrides, "KILO_MISTRAL_CODESTRAL_URL", apiConfiguration.mistralCodestralUrl)
			break
		case "groq":
			addEnvValue(overrides, "KILO_GROQ_API_KEY", apiConfiguration.groqApiKey)
			addEnvValue(overrides, "KILO_API_MODEL_ID", apiConfiguration.apiModelId)
			break
		case "deepseek":
			addEnvValue(overrides, "KILO_DEEPSEEK_API_KEY", apiConfiguration.deepSeekApiKey)
			addEnvValue(overrides, "KILO_API_MODEL_ID", apiConfiguration.apiModelId)
			addEnvValue(overrides, "KILO_DEEPSEEK_BASE_URL", apiConfiguration.deepSeekBaseUrl)
			break
		case "xai":
			addEnvValue(overrides, "KILO_XAI_API_KEY", apiConfiguration.xaiApiKey)
			addEnvValue(overrides, "KILO_API_MODEL_ID", apiConfiguration.apiModelId)
			break
		default:
			debugLog(`[AgentManager] Provider "${providerType}" not mapped for env injection; skipping.`)
			return {}
	}

	overrides.KILO_PROVIDER_TYPE = providerType

	const candidateEnv: Record<string, string | undefined> = { ...baseEnv, ...overrides }
	const missing = getMissingProviderEnv(providerType, candidateEnv)
	if (missing.length > 0) {
		log(`[AgentManager] Skipping CLI env injection for provider ${providerType}: missing ${missing.join(", ")}`)
		return {}
	}

	const appliedKeys = Object.keys(overrides).filter((key) => key !== "KILO_PROVIDER_TYPE")
	debugLog(
		`[AgentManager] Injecting CLI env for provider ${providerType}${
			appliedKeys.length ? ` (keys: ${appliedKeys.join(", ")})` : ""
		}`,
	)

	return overrides
}
