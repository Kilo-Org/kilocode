/**
 * Shared utilities for parsing environment variables
 * Used by both env-config.ts and other configuration modules
 */

/**
 * Environment variable names for core configuration
 */
export const ENV_VARS = {
	// Core settings
	MODE: "KILO_MODE",
	TELEMETRY: "KILO_TELEMETRY",
	THEME: "KILO_THEME",
	PROVIDER: "KILO_PROVIDER",
	PROVIDER_TYPE: "KILO_PROVIDER_TYPE",

	// Auto-approval settings
	AUTO_APPROVAL_ENABLED: "KILO_AUTO_APPROVAL_ENABLED",
	AUTO_APPROVAL_READ_ENABLED: "KILO_AUTO_APPROVAL_READ_ENABLED",
	AUTO_APPROVAL_READ_OUTSIDE: "KILO_AUTO_APPROVAL_READ_OUTSIDE",
	AUTO_APPROVAL_WRITE_ENABLED: "KILO_AUTO_APPROVAL_WRITE_ENABLED",
	AUTO_APPROVAL_WRITE_OUTSIDE: "KILO_AUTO_APPROVAL_WRITE_OUTSIDE",
	AUTO_APPROVAL_WRITE_PROTECTED: "KILO_AUTO_APPROVAL_WRITE_PROTECTED",
	AUTO_APPROVAL_BROWSER_ENABLED: "KILO_AUTO_APPROVAL_BROWSER_ENABLED",
	AUTO_APPROVAL_RETRY_ENABLED: "KILO_AUTO_APPROVAL_RETRY_ENABLED",
	AUTO_APPROVAL_RETRY_DELAY: "KILO_AUTO_APPROVAL_RETRY_DELAY",
	AUTO_APPROVAL_MCP_ENABLED: "KILO_AUTO_APPROVAL_MCP_ENABLED",
	AUTO_APPROVAL_MODE_ENABLED: "KILO_AUTO_APPROVAL_MODE_ENABLED",
	AUTO_APPROVAL_SUBTASKS_ENABLED: "KILO_AUTO_APPROVAL_SUBTASKS_ENABLED",
	AUTO_APPROVAL_EXECUTE_ENABLED: "KILO_AUTO_APPROVAL_EXECUTE_ENABLED",
	AUTO_APPROVAL_EXECUTE_ALLOWED: "KILO_AUTO_APPROVAL_EXECUTE_ALLOWED",
	AUTO_APPROVAL_EXECUTE_DENIED: "KILO_AUTO_APPROVAL_EXECUTE_DENIED",
	AUTO_APPROVAL_QUESTION_ENABLED: "KILO_AUTO_APPROVAL_QUESTION_ENABLED",
	AUTO_APPROVAL_QUESTION_TIMEOUT: "KILO_AUTO_APPROVAL_QUESTION_TIMEOUT",
	AUTO_APPROVAL_TODO_ENABLED: "KILO_AUTO_APPROVAL_TODO_ENABLED",
} as const

/**
 * Environment variable prefix for Kilocode provider
 */
export const KILOCODE_PREFIX = "KILOCODE_"

/**
 * Environment variable prefix for other providers
 */
export const KILO_PREFIX = "KILO_"

/**
 * Environment variable name for provider selection
 */
export const PROVIDER_ENV_VAR = ENV_VARS.PROVIDER

/**
 * Set of specific environment variables that should not be treated as provider fields
 */
export const SPECIFIC_ENV_VARS = new Set([
	PROVIDER_ENV_VAR,
	ENV_VARS.PROVIDER_TYPE,
	ENV_VARS.MODE,
	ENV_VARS.TELEMETRY,
	ENV_VARS.THEME,
])

/**
 * Parse a boolean value from environment variable
 * @param value - The environment variable value
 * @param defaultValue - Optional default value to return if parsing fails or value is undefined
 * @returns Parsed boolean value, defaultValue if provided, or undefined
 */
export function parseBoolean(value: string | undefined, defaultValue?: boolean): boolean | undefined {
	if (!value) return defaultValue
	const normalized = value.toLowerCase().trim()
	if (normalized === "true" || normalized === "1" || normalized === "yes") return true
	if (normalized === "false" || normalized === "0" || normalized === "no") return false
	return defaultValue
}

/**
 * Parse a number value from environment variable
 * @param value - The environment variable value
 * @param defaultValue - Optional default value to return if parsing fails or value is undefined
 * @returns Parsed number value, defaultValue if provided, or undefined
 */
export function parseNumber(value: string | undefined, defaultValue?: number): number | undefined {
	if (!value) return defaultValue
	const parsed = Number(value)
	return isNaN(parsed) ? defaultValue : parsed
}

/**
 * Parse a comma-separated list from environment variable
 * @param value - The environment variable value
 * @param defaultValue - Optional default value to return if value is undefined
 * @returns Parsed array of strings, defaultValue if provided, or undefined
 */
export function parseArray(value: string | undefined, defaultValue?: string[]): string[] | undefined {
	if (!value) return defaultValue
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
}

/**
 * Convert snake_case or SCREAMING_SNAKE_CASE to camelCase
 * Examples:
 * - API_KEY → apiKey
 * - BASE_URL → baseUrl
 * - API_MODEL_ID → apiModelId
 * - ORGANIZATION_ID → organizationId
 */
export function snakeToCamelCase(str: string): string {
	return str.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
}
