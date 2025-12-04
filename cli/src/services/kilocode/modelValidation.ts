/**
 * Model validation service for Kilocode provider
 * Validates model availability against organization-specific model lists
 */

import type { ModelRecord } from "../../constants/providers/models.js"

export interface ModelValidationResult {
	isValid: boolean
	currentModel: string
	fallbackModel?: string
}

/**
 * Validate if a model is available in the current organization's model list
 * @param modelId - The model ID to validate
 * @param availableModels - The organization's available models
 * @returns true if the model is available, false otherwise
 */
export function validateModelAvailability(modelId: string, availableModels: ModelRecord): boolean {
	return modelId in availableModels
}

/**
 * Validate model and determine fallback if needed
 * @param params - Validation parameters
 * @returns Validation result with fallback information if needed
 */
export function validateModelForOrganization(params: {
	currentModel: string
	availableModels: ModelRecord
	defaultModel: string
}): ModelValidationResult {
	const { currentModel, availableModels, defaultModel } = params

	// Check if current model is available
	if (validateModelAvailability(currentModel, availableModels)) {
		return { isValid: true, currentModel }
	}

	// Fall back to organization's default model
	return {
		isValid: false,
		currentModel,
		fallbackModel: defaultModel,
	}
}
