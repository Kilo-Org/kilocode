/**
 * Provider credential validation utilities
 * Centralizes logic for checking provider-specific environment variables
 */

import { parseBoolean } from "./env-utils.js"

/**
 * Check if minimal environment configuration exists
 */
export function envConfigExists(): boolean {
	const providerType = process.env.KILO_PROVIDER_TYPE
	return !!providerType
}

/**
 * Get list of missing required environment variables for a provider type
 * @param providerType - The provider type to check
 * @returns Array of missing environment variable names
 */
export function getMissingEnvVars(providerType: string): string[] {
	const required = getRequiredEnvVars(providerType)
	const missing: string[] = []

	for (const envVar of required) {
		// Handle complex bedrock auth case first (before checking for " or ")
		if (envVar.includes("KILO_AWS_ACCESS_KEY + KILO_AWS_SECRET_KEY")) {
			const hasAwsKeys = !!process.env.KILO_AWS_ACCESS_KEY && !!process.env.KILO_AWS_SECRET_KEY
			const hasProfile =
				(parseBoolean(process.env.KILO_AWS_USE_PROFILE, false) ?? false) && !!process.env.KILO_AWS_PROFILE
			const hasApiKey =
				(parseBoolean(process.env.KILO_AWS_USE_API_KEY, false) ?? false) && !!process.env.KILO_AWS_API_KEY
			if (!hasAwsKeys && !hasProfile && !hasApiKey) {
				missing.push(envVar)
			}
		}
		// Handle special cases with multiple options (e.g., "VAR1 or VAR2")
		else if (envVar.includes(" or ")) {
			const options = envVar.split(" or ").map((v) => v.trim())
			const hasAny = options.some((opt) => !!process.env[opt])
			if (!hasAny) {
				missing.push(envVar)
			}
		}
		// Handle simple single environment variable
		else {
			if (!process.env[envVar]) {
				missing.push(envVar)
			}
		}
	}

	return missing
}

/**
 * Get list of required environment variables for a provider type
 * @param providerType - The provider type to check
 * @returns Array of required environment variable names
 */
export function getRequiredEnvVars(providerType: string): string[] {
	const required: string[] = []

	switch (providerType) {
		case "kilocode":
			required.push("KILOCODE_TOKEN", "KILOCODE_MODEL")
			break
		case "anthropic":
			required.push("KILO_API_KEY", "KILO_API_MODEL_ID")
			break
		case "openai-native":
			required.push("KILO_OPENAI_NATIVE_API_KEY", "KILO_API_MODEL_ID")
			break
		case "openai":
			required.push("KILO_OPENAI_API_KEY", "KILO_OPENAI_MODEL_ID")
			break
		case "openrouter":
			required.push("KILO_OPENROUTER_API_KEY", "KILO_OPENROUTER_MODEL_ID")
			break
		case "ollama":
			required.push("KILO_OLLAMA_MODEL_ID")
			break
		case "bedrock":
			required.push("KILO_API_MODEL_ID", "KILO_AWS_REGION")
			required.push("KILO_AWS_ACCESS_KEY + KILO_AWS_SECRET_KEY (or KILO_AWS_PROFILE or KILO_AWS_API_KEY)")
			break
		case "vertex":
			required.push("KILO_API_MODEL_ID", "KILO_VERTEX_PROJECT_ID", "KILO_VERTEX_REGION")
			required.push("KILO_VERTEX_KEY_FILE or KILO_VERTEX_JSON_CREDENTIALS")
			break
		case "gemini":
			required.push("KILO_GEMINI_API_KEY", "KILO_API_MODEL_ID")
			break
		case "mistral":
			required.push("KILO_MISTRAL_API_KEY", "KILO_API_MODEL_ID")
			break
		case "groq":
			required.push("KILO_GROQ_API_KEY", "KILO_API_MODEL_ID")
			break
		case "deepseek":
			required.push("KILO_DEEPSEEK_API_KEY", "KILO_API_MODEL_ID")
			break
		case "xai":
			required.push("KILO_XAI_API_KEY", "KILO_API_MODEL_ID")
			break
		default:
			required.push("KILO_API_KEY")
			break
	}

	return required
}
