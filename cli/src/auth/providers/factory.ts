import type { AuthProvider, AuthResult } from "../types.js"
import type { ProviderName } from "../../types/messages.js"
import { PROVIDER_REQUIRED_FIELDS } from "../../constants/providers/validation.js"
import { FIELD_REGISTRY, isOptionalField, getProviderDefaultModel } from "../../constants/providers/settings.js"
import { PROVIDER_LABELS } from "../../constants/providers/labels.js"
import inquirer from "inquirer"
import { withRawMode } from "../utils/terminal.js"

/**
 * Creates a generic authentication function for a provider
 * Automatically prompts for required fields based on metadata
 * @param providerName - The provider to create auth function for
 * @returns Authentication function that prompts for required fields
 */
function createGenericAuthFunction(providerName: ProviderName) {
	return async (): Promise<AuthResult> => {
		const requiredFields = PROVIDER_REQUIRED_FIELDS[providerName] || []
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const prompts: any[] = []

		// Build prompts from required fields
		for (const field of requiredFields) {
			const fieldMeta = FIELD_REGISTRY[field]
			if (!fieldMeta) {
				// Skip fields without metadata
				continue
			}

			const isOptional = isOptionalField(field)

			// Handle select fields with list prompt
			if (fieldMeta.type === "select" && fieldMeta.options) {
				prompts.push({
					type: "list",
					name: field,
					message: `${fieldMeta.label}${isOptional ? " (optional)" : ""}:`,
					choices: fieldMeta.options.map((opt) => ({
						name: opt.description ? `${opt.label} - ${opt.description}` : opt.label,
						value: opt.value,
						short: opt.label,
					})),
					default: fieldMeta.defaultValue || fieldMeta.options[0]?.value,
				})
			} else {
				// Handle other field types
				prompts.push({
					type: fieldMeta.type === "boolean" ? "confirm" : fieldMeta.type,
					name: field,
					message: `${fieldMeta.label}${isOptional ? " (optional)" : ""}:`,
					default: fieldMeta.type === "boolean" ? false : fieldMeta.defaultValue,
					mask: fieldMeta.type === "password" ? true : undefined,
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					validate: (input: any) => {
						// Boolean fields are always valid
						if (fieldMeta.type === "boolean") {
							return true
						}
						// Optional fields can be empty
						if (isOptional) {
							return true
						}
						// Required fields must have a value
						if (!input || (typeof input === "string" && input.trim() === "")) {
							return `${fieldMeta.label} is required`
						}
						return true
					},
				})
			}
		}

		// Prompt user for all fields
		// Use withRawMode to ensure arrow key navigation works in list prompts
		// (required for inquirer v13+ which uses @inquirer/prompts internally)
		const answers = await withRawMode(() => inquirer.prompt(prompts))

		// Build provider config
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const providerConfig: any = {
			id: "default",
			provider: providerName,
		}

		// Add all answered fields to config
		for (const [key, value] of Object.entries(answers)) {
			// Only add non-empty values
			if (value !== "" && value !== undefined && value !== null) {
				providerConfig[key] = value
			}
		}

		// Add default model if not provided and available
		const defaultModel = getProviderDefaultModel(providerName)
		if (defaultModel && !providerConfig.apiModelId && !providerConfig.kilocodeModel) {
			// Use appropriate model field based on provider
			if (providerName === "kilocode") {
				providerConfig.kilocodeModel = defaultModel
			} else {
				providerConfig.apiModelId = defaultModel
			}
		}

		return { providerConfig }
	}
}

/**
 * Creates a generic auth provider from metadata
 * @param providerName - The provider to create
 * @returns AuthProvider with auto-generated authentication flow
 */
export function createGenericAuthProvider(providerName: ProviderName): AuthProvider {
	return {
		name: PROVIDER_LABELS[providerName] || providerName,
		value: providerName,
		authenticate: createGenericAuthFunction(providerName),
	}
}
