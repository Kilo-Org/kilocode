import type { CLIConfig, ProviderConfig, AutoApprovalConfig } from "./types.js"
import { DEFAULT_CONFIG, DEFAULT_AUTO_APPROVAL } from "./defaults.js"
import { logs } from "../services/logs.js"
import {
	ENV_VARS,
	KILOCODE_PREFIX,
	KILO_PREFIX,
	PROVIDER_ENV_VAR,
	SPECIFIC_ENV_VARS,
	parseBoolean,
	parseNumber,
	parseArray,
	snakeToCamelCase,
} from "./env-utils.js"
import { envConfigExists, getMissingEnvVars } from "./provider-validation.js"

export { envConfigExists, getMissingEnvVars }
export { PROVIDER_ENV_VAR, KILOCODE_PREFIX, KILO_PREFIX }

/**
 * Build auto-approval configuration from environment variables
 * Used when building config from scratch (no config.json)
 */
function buildAutoApprovalFromEnv(): AutoApprovalConfig {
	return {
		enabled: parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_ENABLED], DEFAULT_AUTO_APPROVAL.enabled ?? true)!,
		read: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_READ_ENABLED],
				DEFAULT_AUTO_APPROVAL.read?.enabled ?? true,
			)!,
			outside: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_READ_OUTSIDE],
				DEFAULT_AUTO_APPROVAL.read?.outside ?? true,
			)!,
		},
		write: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_WRITE_ENABLED],
				DEFAULT_AUTO_APPROVAL.write?.enabled ?? true,
			)!,
			outside: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_WRITE_OUTSIDE],
				DEFAULT_AUTO_APPROVAL.write?.outside ?? true,
			)!,
			protected: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_WRITE_PROTECTED],
				DEFAULT_AUTO_APPROVAL.write?.protected ?? false,
			)!,
		},
		browser: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_BROWSER_ENABLED],
				DEFAULT_AUTO_APPROVAL.browser?.enabled ?? false,
			)!,
		},
		retry: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_RETRY_ENABLED],
				DEFAULT_AUTO_APPROVAL.retry?.enabled ?? false,
			)!,
			delay: parseNumber(
				process.env[ENV_VARS.AUTO_APPROVAL_RETRY_DELAY],
				DEFAULT_AUTO_APPROVAL.retry?.delay ?? 10,
			)!,
		},
		mcp: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_MCP_ENABLED],
				DEFAULT_AUTO_APPROVAL.mcp?.enabled ?? true,
			)!,
		},
		mode: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_MODE_ENABLED],
				DEFAULT_AUTO_APPROVAL.mode?.enabled ?? true,
			)!,
		},
		subtasks: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_SUBTASKS_ENABLED],
				DEFAULT_AUTO_APPROVAL.subtasks?.enabled ?? true,
			)!,
		},
		execute: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_EXECUTE_ENABLED],
				DEFAULT_AUTO_APPROVAL.execute?.enabled ?? true,
			)!,
			allowed: parseArray(
				process.env[ENV_VARS.AUTO_APPROVAL_EXECUTE_ALLOWED],
				DEFAULT_AUTO_APPROVAL.execute?.allowed ?? [],
			)!,
			denied: parseArray(
				process.env[ENV_VARS.AUTO_APPROVAL_EXECUTE_DENIED],
				DEFAULT_AUTO_APPROVAL.execute?.denied ?? [],
			)!,
		},
		question: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_QUESTION_ENABLED],
				DEFAULT_AUTO_APPROVAL.question?.enabled ?? false,
			)!,
			timeout: parseNumber(
				process.env[ENV_VARS.AUTO_APPROVAL_QUESTION_TIMEOUT],
				DEFAULT_AUTO_APPROVAL.question?.timeout ?? 60,
			)!,
		},
		todo: {
			enabled: parseBoolean(
				process.env[ENV_VARS.AUTO_APPROVAL_TODO_ENABLED],
				DEFAULT_AUTO_APPROVAL.todo?.enabled ?? true,
			)!,
		},
	}
}

/**
 * Apply auto-approval configuration overrides from environment variables
 * Used when applying overrides to existing config
 */
function applyAutoApprovalOverrides(config: CLIConfig): CLIConfig {
	// Track if any overrides were applied
	let hasOverrides = false
	const overriddenConfig = { ...config }
	const autoApproval: AutoApprovalConfig = { ...config.autoApproval }

	// Global enabled
	const globalEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_ENABLED])
	if (globalEnabled !== undefined) {
		autoApproval.enabled = globalEnabled
		hasOverrides = true
		logs.info(`Config override: autoApproval.enabled set to "${globalEnabled}"`, "EnvConfig")
	}

	// Read settings
	const readEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_READ_ENABLED])
	const readOutside = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_READ_OUTSIDE])
	if (readEnabled !== undefined || readOutside !== undefined) {
		autoApproval.read = {
			...autoApproval.read,
			...(readEnabled !== undefined && { enabled: readEnabled }),
			...(readOutside !== undefined && { outside: readOutside }),
		}
		hasOverrides = true
		logs.info(`Config override: autoApproval.read settings updated`, "EnvConfig")
	}

	// Write settings
	const writeEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_WRITE_ENABLED])
	const writeOutside = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_WRITE_OUTSIDE])
	const writeProtected = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_WRITE_PROTECTED])
	if (writeEnabled !== undefined || writeOutside !== undefined || writeProtected !== undefined) {
		autoApproval.write = {
			...autoApproval.write,
			...(writeEnabled !== undefined && { enabled: writeEnabled }),
			...(writeOutside !== undefined && { outside: writeOutside }),
			...(writeProtected !== undefined && { protected: writeProtected }),
		}
		hasOverrides = true
		logs.info(`Config override: autoApproval.write settings updated`, "EnvConfig")
	}

	// Browser settings
	const browserEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_BROWSER_ENABLED])
	if (browserEnabled !== undefined) {
		autoApproval.browser = { ...autoApproval.browser, enabled: browserEnabled }
		hasOverrides = true
		logs.info(`Config override: autoApproval.browser.enabled set to "${browserEnabled}"`, "EnvConfig")
	}

	// Retry settings
	const retryEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_RETRY_ENABLED])
	const retryDelay = parseNumber(process.env[ENV_VARS.AUTO_APPROVAL_RETRY_DELAY])
	if (retryEnabled !== undefined || retryDelay !== undefined) {
		autoApproval.retry = {
			...autoApproval.retry,
			...(retryEnabled !== undefined && { enabled: retryEnabled }),
			...(retryDelay !== undefined && { delay: retryDelay }),
		}
		hasOverrides = true
		logs.info(`Config override: autoApproval.retry settings updated`, "EnvConfig")
	}

	// MCP settings
	const mcpEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_MCP_ENABLED])
	if (mcpEnabled !== undefined) {
		autoApproval.mcp = { ...autoApproval.mcp, enabled: mcpEnabled }
		hasOverrides = true
		logs.info(`Config override: autoApproval.mcp.enabled set to "${mcpEnabled}"`, "EnvConfig")
	}

	// Mode settings
	const modeEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_MODE_ENABLED])
	if (modeEnabled !== undefined) {
		autoApproval.mode = { ...autoApproval.mode, enabled: modeEnabled }
		hasOverrides = true
		logs.info(`Config override: autoApproval.mode.enabled set to "${modeEnabled}"`, "EnvConfig")
	}

	// Subtasks settings
	const subtasksEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_SUBTASKS_ENABLED])
	if (subtasksEnabled !== undefined) {
		autoApproval.subtasks = { ...autoApproval.subtasks, enabled: subtasksEnabled }
		hasOverrides = true
		logs.info(`Config override: autoApproval.subtasks.enabled set to "${subtasksEnabled}"`, "EnvConfig")
	}

	// Execute settings
	const executeEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_EXECUTE_ENABLED])
	const executeAllowed = parseArray(process.env[ENV_VARS.AUTO_APPROVAL_EXECUTE_ALLOWED])
	const executeDenied = parseArray(process.env[ENV_VARS.AUTO_APPROVAL_EXECUTE_DENIED])
	if (executeEnabled !== undefined || executeAllowed !== undefined || executeDenied !== undefined) {
		autoApproval.execute = {
			...autoApproval.execute,
			...(executeEnabled !== undefined && { enabled: executeEnabled }),
			...(executeAllowed !== undefined && { allowed: executeAllowed }),
			...(executeDenied !== undefined && { denied: executeDenied }),
		}
		hasOverrides = true
		logs.info(`Config override: autoApproval.execute settings updated`, "EnvConfig")
	}

	// Question settings
	const questionEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_QUESTION_ENABLED])
	const questionTimeout = parseNumber(process.env[ENV_VARS.AUTO_APPROVAL_QUESTION_TIMEOUT])
	if (questionEnabled !== undefined || questionTimeout !== undefined) {
		autoApproval.question = {
			...autoApproval.question,
			...(questionEnabled !== undefined && { enabled: questionEnabled }),
			...(questionTimeout !== undefined && { timeout: questionTimeout }),
		}
		hasOverrides = true
		logs.info(`Config override: autoApproval.question settings updated`, "EnvConfig")
	}

	// Todo settings
	const todoEnabled = parseBoolean(process.env[ENV_VARS.AUTO_APPROVAL_TODO_ENABLED])
	if (todoEnabled !== undefined) {
		autoApproval.todo = { ...autoApproval.todo, enabled: todoEnabled }
		hasOverrides = true
		logs.info(`Config override: autoApproval.todo.enabled set to "${todoEnabled}"`, "EnvConfig")
	}

	// Only update autoApproval if there were actual overrides
	if (hasOverrides) {
		overriddenConfig.autoApproval = autoApproval
	}

	return overriddenConfig
}

/**
 * Apply core configuration overrides from environment variables
 */
function applyCoreOverrides(config: CLIConfig): CLIConfig {
	const overriddenConfig = { ...config }

	// Override mode
	const envMode = process.env[ENV_VARS.MODE]
	if (envMode) {
		overriddenConfig.mode = envMode
		logs.info(`Config override: mode set to "${envMode}" from ${ENV_VARS.MODE}`, "EnvConfig")
	}

	// Override telemetry
	const envTelemetry = parseBoolean(process.env[ENV_VARS.TELEMETRY])
	if (envTelemetry !== undefined) {
		overriddenConfig.telemetry = envTelemetry
		logs.info(`Config override: telemetry set to "${envTelemetry}" from ${ENV_VARS.TELEMETRY}`, "EnvConfig")
	}

	// Override theme
	const envTheme = process.env[ENV_VARS.THEME]
	if (envTheme) {
		overriddenConfig.theme = envTheme
		logs.info(`Config override: theme set to "${envTheme}" from ${ENV_VARS.THEME}`, "EnvConfig")
	}

	return overriddenConfig
}

/**
 * Get all environment variable overrides for the current provider
 * - For Kilocode provider: looks for KILOCODE_* vars and transforms to kilocodeXyz
 * - For other providers: looks for KILO_* vars (excluding specific vars) and transforms to xyzAbc
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
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			if (key.startsWith(KILO_PREFIX) && !SPECIFIC_ENV_VARS.has(key as any) && value) {
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

/**
 * Build provider configuration from environment variables
 * Uses the provider-specific environment variable patterns
 *
 * This function creates a complete provider config with all fields populated from env vars.
 * This is critical because validation happens immediately after config creation, so all
 * required fields must be present before validation runs.
 *
 * For Kilocode provider: KILOCODE_* vars → kilocodeXyz fields
 * For other providers: KILO_* vars → xyzAbc fields
 */
function buildProviderFromEnv(providerType: string): ProviderConfig {
	const providerId = process.env[PROVIDER_ENV_VAR] || "default"

	// Base provider config
	const baseConfig: Record<string, unknown> = {
		id: providerId,
		provider: providerType,
	}

	// Get provider-specific fields from environment variables
	const overrideFields = getProviderOverrideFields(providerType)

	// Apply each field to the base config
	for (const { fieldName, value } of overrideFields) {
		baseConfig[fieldName] = value
		logs.info(
			`Building provider from env: ${fieldName} set to "${value}" for provider "${providerId}"`,
			"EnvConfig",
		)
	}

	return baseConfig as ProviderConfig
}

/**
 * Build complete CLI configuration from environment variables
 * Returns null if minimal configuration is not present
 */
export function buildConfigFromEnv(): CLIConfig | null {
	if (!envConfigExists()) {
		return null
	}

	const providerType = process.env[ENV_VARS.PROVIDER_TYPE]
	if (!providerType) {
		return null
	}
	const provider = buildProviderFromEnv(providerType)

	const config: CLIConfig = {
		version: "1.0.0",
		mode: process.env[ENV_VARS.MODE] || DEFAULT_CONFIG.mode,
		telemetry: parseBoolean(process.env[ENV_VARS.TELEMETRY], DEFAULT_CONFIG.telemetry) ?? DEFAULT_CONFIG.telemetry,
		provider: provider.id,
		providers: [provider],
		autoApproval: buildAutoApprovalFromEnv(),
		theme: process.env[ENV_VARS.THEME] || DEFAULT_CONFIG.theme,
		customThemes: {},
	}

	logs.info("Built configuration from environment variables", "EnvConfig", {
		providerType,
		providerId: provider.id,
		mode: config.mode,
		telemetry: config.telemetry,
		fieldsPopulated: Object.keys(provider).filter((k) => k !== "id" && k !== "provider").length,
	})

	return config
}

/**
 * Apply environment variable overrides to the config
 * Overrides the current provider's settings based on environment variables
 *
 * Environment variables:
 * - KILO_PROVIDER: Override the active provider ID
 * - KILO_MODE: Override the operation mode
 * - KILO_TELEMETRY: Override telemetry setting (true/false)
 * - KILO_THEME: Override the UI theme
 * - KILO_AUTO_APPROVAL_*: Override auto-approval settings
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
	let overriddenConfig = { ...config }

	// Apply core configuration overrides
	overriddenConfig = applyCoreOverrides(overriddenConfig)

	// Apply auto-approval overrides
	overriddenConfig = applyAutoApprovalOverrides(overriddenConfig)

	// Override provider if KILO_PROVIDER is set
	const envProvider = process.env[PROVIDER_ENV_VAR]

	if (envProvider) {
		// Check if the provider exists in the config
		const providerExists = config.providers.some((p) => p.id === envProvider)

		if (providerExists) {
			overriddenConfig.provider = envProvider

			logs.info(`Config override: provider set to "${envProvider}" from ${PROVIDER_ENV_VAR}`, "EnvConfig")
		} else {
			logs.warn(
				`Config override ignored: provider "${envProvider}" from ${PROVIDER_ENV_VAR} not found in config`,
				"EnvConfig",
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
						"EnvConfig",
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
 * Check if running in ephemeral mode (config from env only, no file)
 */
export function isEphemeralMode(): boolean {
	return envConfigExists() && process.env.KILO_EPHEMERAL_MODE !== "false"
}
