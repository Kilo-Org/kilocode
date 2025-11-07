import type { CLIConfig } from "./types.js"
import { logs } from "../services/logs.js"

/**
 * Environment variable name for provider selection
 */
export const PROVIDER_ENV_VAR = "KILO_PROVIDER"

/**
 * Environment variable prefix for Kilocode provider
 */
export const KILOCODE_PREFIX = "KILOCODE_"

/**
 * Environment variable prefix for other providers
 */
export const KILO_PREFIX = "KILO_"

const specificEnvVars = new Set([PROVIDER_ENV_VAR])

/**
 * Apply environment variable overrides to the config
 * Overrides the current provider's settings based on environment variables
 *
 * Environment variables:
 * - KILO_PROVIDER: Override the active provider ID
 * - For Kilocode provider: KILOCODE_<FIELD_NAME> (e.g., KILOCODE_MODEL → kilocodeModel)
 *   Examples:
 *   - KILOCODE_MODEL → kilocodeModel
 *   - KILOCODE_ORGANIZATION_ID → kilocodeOrganizationId
 * - For other providers: KILO_<FIELD_NAME> (e.g., KILO_API_KEY → apiKey)
 *   Examples:
 *   - KILO_API_KEY → apiKey
 *   - KILO_BASE_URL → baseUrl
 *   - KILO_API_MODEL_ID → apiModelId
 *
 * @param config The config to apply overrides to
 * @returns The config with environment variable overrides applied
 */
export function applyEnvOverrides(config: CLIConfig): CLIConfig {
	const overriddenConfig = { ...config }

	// Override provider if KILO_PROVIDER is set
	const envProvider = process.env[PROVIDER_ENV_VAR]

	if (envProvider) {
		// Check if the provider exists in the config
		const providerExists = config.providers.some((p) => p.id === envProvider)

		if (providerExists) {
			overriddenConfig.provider = envProvider

			logs.info(`Config override: provider set to "${envProvider}" from ${PROVIDER_ENV_VAR}`, "EnvOverrides")
		} else {
			logs.warn(
				`Config override ignored: provider "${envProvider}" from ${PROVIDER_ENV_VAR} not found in config`,
				"EnvOverrides",
			)
		}
	}

	// Get the current provider (after potential provider override)
	const currentProvider = overriddenConfig.providers.find((p) => p.id === overriddenConfig.provider)

	if (!currentProvider) {
		// No valid provider, return config as-is
		return overriddenConfig
	}

	// Find all environment variable overrides for the current provider
	const overrideFields = getProviderOverrideFields(currentProvider.provider)

	if (overrideFields.length > 0) {
		// Create a new providers array with the updated provider
		overriddenConfig.providers = overriddenConfig.providers.map((p) => {
			if (p.id === currentProvider.id) {
				const updatedProvider = { ...p }

				// Apply each override
				for (const { fieldName, value } of overrideFields) {
					updatedProvider[fieldName] = value

					logs.info(
						`Config override: ${fieldName} set to "${value}" for provider "${currentProvider.id}"`,
						"EnvOverrides",
					)
				}

				return updatedProvider
			}

			return p
		})
	}

	return overriddenConfig
}

/**
 * Convert snake_case or SCREAMING_SNAKE_CASE to camelCase
 * Examples:
 * - API_KEY → apiKey
 * - BASE_URL → baseUrl
 * - API_MODEL_ID → apiModelId
 * - ORGANIZATION_ID → organizationId
 */
function snakeToCamelCase(str: string): string {
	return str.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}

/**
 * Get all environment variable overrides for the current provider
 * - For Kilocode provider: looks for KILOCODE_* vars and transforms to kilocodeXyz
 * - For other providers: looks for KILO_* vars (excluding KILO_PROVIDER) and transforms to xyzAbc
 * Returns an array of { fieldName, value } objects
 */
function getProviderOverrideFields(provider: string): Array<{ fieldName: string; value: string }> {
	const overrides: Array<{ fieldName: string; value: string }> = []

	if (provider === "kilocode") {
		// For Kilocode provider: KILOCODE_XYZ → kilocodeXyz
		for (const [key, value] of Object.entries(process.env)) {
			if (key.startsWith(KILOCODE_PREFIX) && value) {
				overrides.push({ fieldName: snakeToCamelCase(key), value })
			}
		}
	} else {
		// For other providers: KILO_XYZ_ABC → xyzAbc
		for (const [key, value] of Object.entries(process.env)) {
			if (key.startsWith(KILO_PREFIX) && !specificEnvVars.has(key) && value) {
				const remainder = key.substring(KILO_PREFIX.length)

				if (remainder) {
					const fieldName = snakeToCamelCase(remainder)
					overrides.push({ fieldName, value })
				}
			}
		}
	}

	return overrides
}
