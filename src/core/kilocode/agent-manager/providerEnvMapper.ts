import type { ProviderSettings } from "@roo-code/types"
import providerEnvMap from "./providerEnvMap.json" assert { type: "json" }

type EnvOverrides = Record<string, string>

type ProviderEnvEntry = {
	provider: string
	env: Array<{ name: string; value?: string; source?: keyof ProviderSettings }>
	required?: string[]
	specialRequirements?: "bedrock" | "vertex"
}

const PROVIDER_CONFIG = (providerEnvMap as ProviderEnvEntry[]).reduce<Record<string, ProviderEnvEntry>>(
	(acc, entry) => {
		acc[entry.provider] = entry
		return acc
	},
	{},
)

const hasValue = (env: Record<string, string | undefined>, key: string | undefined): boolean => {
	if (!key) return false
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

const getEnvNameForSource = (config: ProviderEnvEntry, source: keyof ProviderSettings): string | undefined => {
	return config.env.find((entry) => entry.source === source)?.name
}

const getMissingProviderEnv = (config: ProviderEnvEntry, env: Record<string, string | undefined>): string[] => {
	const missing: string[] = []

	for (const required of config.required ?? []) {
		if (!hasValue(env, required)) {
			missing.push(required)
		}
	}

	switch (config.specialRequirements) {
		case "bedrock": {
			const accessKeyEnv = getEnvNameForSource(config, "awsAccessKey") ?? "KILO_AWS_ACCESS_KEY"
			const secretKeyEnv = getEnvNameForSource(config, "awsSecretKey") ?? "KILO_AWS_SECRET_KEY"
			const profileEnv = getEnvNameForSource(config, "awsProfile") ?? "KILO_AWS_PROFILE"
			const useProfileEnv = getEnvNameForSource(config, "awsUseProfile") ?? "KILO_AWS_USE_PROFILE"
			const apiKeyEnv = getEnvNameForSource(config, "awsApiKey") ?? "KILO_AWS_API_KEY"
			const useApiKeyEnv = getEnvNameForSource(config, "awsUseApiKey") ?? "KILO_AWS_USE_API_KEY"

			const hasAwsKeys = hasValue(env, accessKeyEnv) && hasValue(env, secretKeyEnv)
			const useProfile = parseEnvBoolean(env[useProfileEnv]) ?? false
			const hasProfile = useProfile && hasValue(env, profileEnv)
			const useApiKey = parseEnvBoolean(env[useApiKeyEnv]) ?? false
			const hasApiKey = useApiKey && hasValue(env, apiKeyEnv)

			if (!hasAwsKeys && !hasProfile && !hasApiKey) {
				missing.push(`${accessKeyEnv} + ${secretKeyEnv} (or ${profileEnv} or ${apiKeyEnv})`)
			}
			break
		}
		case "vertex": {
			const keyFileEnv = getEnvNameForSource(config, "vertexKeyFile") ?? "KILO_VERTEX_KEY_FILE"
			const jsonEnv = getEnvNameForSource(config, "vertexJsonCredentials") ?? "KILO_VERTEX_JSON_CREDENTIALS"

			if (!hasValue(env, keyFileEnv) && !hasValue(env, jsonEnv)) {
				missing.push(`${keyFileEnv} or ${jsonEnv}`)
			}
			break
		}
		default:
			break
	}

	return missing
}

/**
 * Map the VS Code extension's provider configuration to CLI environment variables via config.
 * - Only sets values provided by the extension; user-defined env vars remain intact.
 * - Validates required fields for the chosen provider against the merged env before
 *   injecting `KILO_PROVIDER_TYPE` to avoid breaking spawns with partial configs.
 * - Provider highlights live in providerEnvMap.json, keeping the mapping data-driven.
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

	const config = PROVIDER_CONFIG[providerType]
	if (!config) {
		debugLog(`[AgentManager] Provider "${providerType}" not mapped for env injection; skipping.`)
		return {}
	}

	const overrides: EnvOverrides = {}
	for (const entry of config.env) {
		if (entry.value !== undefined) {
			overrides[entry.name] = entry.value
		} else if (entry.source) {
			addEnvValue(overrides, entry.name, (apiConfiguration as Record<string, unknown>)[entry.source])
		}
	}

	const candidateEnv: Record<string, string | undefined> = { ...baseEnv, ...overrides }
	const missing = getMissingProviderEnv(config, candidateEnv)
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
