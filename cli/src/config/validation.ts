import Ajv from "ajv"
import * as fs from "fs/promises"
import * as path from "path"
import type { CLIConfig, ProviderConfig } from "./types.js"

// __dirname is provided by the banner in the bundled output
declare const __dirname: string

let ajv: Ajv | null = null
let validateFunction: ReturnType<Ajv["compile"]> | null = null

async function getValidator() {
	if (!validateFunction) {
		ajv = new Ajv({ allErrors: true, strict: false })
		const schemaPath = path.join(__dirname, "config", "schema.json")
		const schemaContent = await fs.readFile(schemaPath, "utf-8")
		const schema = JSON.parse(schemaContent)
		validateFunction = ajv.compile(schema)
	}
	return validateFunction
}

export interface ValidationResult {
	valid: boolean
	errors?: string[]
}

export async function validateConfig(config: unknown): Promise<ValidationResult> {
	try {
		const validate = await getValidator()
		const valid = validate(config)

		if (!valid) {
			const errors =
				validate.errors?.map((err) => {
					const path = err.instancePath || "root"
					return `${path}: ${err.message}`
				}) || []
			return { valid: false, errors }
		}

		// After schema validation, validate business logic
		if (config && typeof config === "object" && "providers" in config) {
			const cliConfig = config as CLIConfig

			// Validate the selected provider exists and has non-empty credentials
			const selectedProviderResult = validateSelectedProvider(cliConfig)
			if (!selectedProviderResult.valid) {
				return selectedProviderResult
			}
		}

		return { valid: true }
	} catch (error) {
		return {
			valid: false,
			errors: [`Validation error: ${error instanceof Error ? error.message : String(error)}`],
		}
	}
}

/**
 * Validates provider-specific configuration based on provider type.
 * Note: Most validations (required fields, types, minLength) are now handled by schema.json.
 * This function validates business logic: selected providers must have non-empty required credentials.
 *
 * @param provider - The provider configuration to validate
 * @param isSelected - Whether this is the currently selected provider (requires non-empty credentials)
 */
export function validateProviderConfig(provider: ProviderConfig, isSelected: boolean = false): ValidationResult {
	// Schema validation handles:
	// - Provider type existence and validity (enum)
	// - Field types (string, etc.)
	// - Minimum lengths for API keys and tokens (when non-empty)

	// This function validates: selected providers must have non-empty required credentials
	if (!isSelected) {
		return { valid: true }
	}

	const errors: string[] = []

	// Validate selected provider has non-empty required fields
	switch (provider.provider) {
		case "kilocode":
			if (!provider.kilocodeToken || provider.kilocodeToken.length === 0) {
				errors.push("kilocodeToken is required and cannot be empty for selected provider")
			}
			if (!provider.kilocodeModel || provider.kilocodeModel.length === 0) {
				errors.push("kilocodeModel is required and cannot be empty for selected provider")
			}
			break

		case "anthropic":
			if (!provider.apiKey || provider.apiKey.length === 0) {
				errors.push("apiKey is required and cannot be empty for selected provider")
			}
			if (!provider.apiModelId || provider.apiModelId.length === 0) {
				errors.push("apiModelId is required and cannot be empty for selected provider")
			}
			break

		case "openai-native":
			if (!provider.openAiNativeApiKey || provider.openAiNativeApiKey.length === 0) {
				errors.push("openAiNativeApiKey is required and cannot be empty for selected provider")
			}
			if (!provider.apiModelId || provider.apiModelId.length === 0) {
				errors.push("apiModelId is required and cannot be empty for selected provider")
			}
			break

		case "openrouter":
			if (!provider.openRouterApiKey || provider.openRouterApiKey.length === 0) {
				errors.push("openRouterApiKey is required and cannot be empty for selected provider")
			}
			if (!provider.openRouterModelId || provider.openRouterModelId.length === 0) {
				errors.push("openRouterModelId is required and cannot be empty for selected provider")
			}
			break

		case "ollama":
			if (!provider.ollamaBaseUrl || provider.ollamaBaseUrl.length === 0) {
				errors.push("ollamaBaseUrl is required and cannot be empty for selected provider")
			}
			if (!provider.ollamaModelId || provider.ollamaModelId.length === 0) {
				errors.push("ollamaModelId is required and cannot be empty for selected provider")
			}
			break

		case "openai":
			if (!provider.openAiApiKey || provider.openAiApiKey.length === 0) {
				errors.push("openAiApiKey is required and cannot be empty for selected provider")
			}
			break

		default:
			// For other providers, no additional validation needed
			break
	}

	if (errors.length > 0) {
		return { valid: false, errors }
	}

	return { valid: true }
}

/**
 * Validates the selected provider in the config
 */
export function validateSelectedProvider(config: CLIConfig): ValidationResult {
	// Check if provider ID is set
	if (!config.provider) {
		return {
			valid: false,
			errors: ["No provider selected in configuration"],
		}
	}

	// Find the selected provider
	const selectedProvider = config.providers.find((p) => p.id === config.provider)
	if (!selectedProvider) {
		return {
			valid: false,
			errors: [`Selected provider '${config.provider}' not found in providers list`],
		}
	}

	// Validate the provider configuration (must have non-empty credentials)
	return validateProviderConfig(selectedProvider, true)
}
