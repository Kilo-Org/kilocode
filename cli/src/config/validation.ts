import Ajv from "ajv"
import * as fs from "fs/promises"
import * as path from "path"
import type { CLIConfig, ProviderConfig } from "./types.js"
import { PROVIDER_REQUIRED_FIELDS } from "../constants/providers/validation.js"

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
 * Helper function to validate a required field
 */
function validateRequiredField(provider: ProviderConfig, fieldName: string, errors: string[]): void {
	const value = provider[fieldName]
	if (!value || (typeof value === "string" && value.length === 0)) {
		errors.push(`${fieldName} is required and cannot be empty for selected provider`)
	}
}

/**
 * Handle special validation cases for specific providers
 */
function handleSpecialValidations(provider: ProviderConfig, errors: string[]): void {
	switch (provider.provider) {
		case "vertex": {
			// At least one of vertexJsonCredentials or vertexKeyFile must be provided
			const jsonCreds = provider.vertexJsonCredentials as string | undefined
			const keyFile = provider.vertexKeyFile as string | undefined
			const hasJsonCredentials = jsonCreds && jsonCreds.length > 0
			const hasKeyFile = keyFile && keyFile.length > 0

			if (!hasJsonCredentials && !hasKeyFile) {
				errors.push(
					"Either vertexJsonCredentials or vertexKeyFile is required and cannot be empty for selected provider",
				)
			}

			// These fields are always required for vertex
			validateRequiredField(provider, "vertexProjectId", errors)
			validateRequiredField(provider, "vertexRegion", errors)
			validateRequiredField(provider, "apiModelId", errors)
			break
		}

		case "vscode-lm": {
			const selector = provider.vsCodeLmModelSelector as { vendor?: string; family?: string } | undefined
			if (!selector) {
				errors.push("vsCodeLmModelSelector is required for selected provider")
			} else {
				if (!selector.vendor || selector.vendor.length === 0) {
					errors.push("vsCodeLmModelSelector.vendor is required and cannot be empty for selected provider")
				}
				if (!selector.family || selector.family.length === 0) {
					errors.push("vsCodeLmModelSelector.family is required and cannot be empty for selected provider")
				}
			}
			break
		}

		case "virtual-quota-fallback": {
			const profiles = provider.profiles as unknown[] | undefined
			if (!profiles || !Array.isArray(profiles) || profiles.length === 0) {
				errors.push("profiles is required and must be a non-empty array for selected provider")
			}
			break
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

	// Get required fields for this provider type
	const requiredFields = PROVIDER_REQUIRED_FIELDS[provider.provider]

	// Validate all required fields
	if (requiredFields) {
		requiredFields.forEach((field) => validateRequiredField(provider, field, errors))
	}

	// Handle special validation cases
	handleSpecialValidations(provider, errors)

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
