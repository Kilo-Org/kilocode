import { z } from "zod"
import { DynamicProvider, LocalProvider } from "./provider-settings.js"

/**
 * ReasoningEffort
 */

export const reasoningEfforts = ["low", "medium", "high", "xhigh"] as const

export const reasoningEffortsSchema = z.enum(reasoningEfforts)

export type ReasoningEffort = z.infer<typeof reasoningEffortsSchema>

/**
 * ReasoningEffortWithMinimal
 */

export const reasoningEffortWithMinimalSchema = z.union([reasoningEffortsSchema, z.literal("minimal")])

export type ReasoningEffortWithMinimal = z.infer<typeof reasoningEffortWithMinimalSchema>

/**
 * Extended Reasoning Effort (includes "none" and "minimal")
 * Note: "disable" is a UI/control value, not a value sent as effort
 */
export const reasoningEffortsExtended = ["none", "minimal", "low", "medium", "high", "xhigh"] as const

export const reasoningEffortExtendedSchema = z.enum(reasoningEffortsExtended)

export type ReasoningEffortExtended = z.infer<typeof reasoningEffortExtendedSchema>

/**
 * Reasoning Effort user setting (includes "disable")
 */
export const reasoningEffortSettingValues = ["disable", "none", "minimal", "low", "medium", "high", "xhigh"] as const
export const reasoningEffortSettingSchema = z.enum(reasoningEffortSettingValues)

/**
 * Verbosity
 */

export const verbosityLevels = ["low", "medium", "high"] as const

export const verbosityLevelsSchema = z.enum(verbosityLevels)

export type VerbosityLevel = z.infer<typeof verbosityLevelsSchema>

/**
 * Service tiers (OpenAI Responses API)
 */
export const serviceTiers = ["default", "flex", "priority"] as const
export const serviceTierSchema = z.enum(serviceTiers)
export type ServiceTier = z.infer<typeof serviceTierSchema>

/**
 * ModelParameter
 */

export const modelParameters = ["max_tokens", "temperature", "reasoning", "include_reasoning"] as const

export const modelParametersSchema = z.enum(modelParameters)

export type ModelParameter = z.infer<typeof modelParametersSchema>

export const isModelParameter = (value: string): value is ModelParameter =>
	modelParameters.includes(value as ModelParameter)

/**
 * ModelInfo
 */

export const modelInfoSchema = z.object({
	maxTokens: z.number().nullish(),
	maxThinkingTokens: z.number().nullish(),
	contextWindow: z.number(),
	supportsImages: z.boolean().optional(),
	supportsComputerUse: z.boolean().optional(), // kilocode_change
	supportsPromptCache: z.boolean(),
	// Optional default prompt cache retention policy for providers that support it.
	// When set to "24h", extended prompt caching will be requested; when omitted
	// or set to "in_memory", the default in‑memory cache is used.
	promptCacheRetention: z.enum(["in_memory", "24h"]).optional(),
	// Capability flag to indicate whether the model supports an output verbosity parameter
	supportsVerbosity: z.boolean().optional(),
	supportsReasoningBudget: z.boolean().optional(),
	// Capability flag to indicate whether the model supports simple on/off binary reasoning
	supportsReasoningBinary: z.boolean().optional(),
	// Capability flag to indicate whether the model supports temperature parameter
	supportsTemperature: z.boolean().optional(),
	defaultTemperature: z.number().optional(),
	requiredReasoningBudget: z.boolean().optional(),
	supportsReasoningEffort: z
		.union([z.boolean(), z.array(z.enum(["disable", "none", "minimal", "low", "medium", "high", "xhigh"]))])
		.optional(),
	requiredReasoningEffort: z.boolean().optional(),
	preserveReasoning: z.boolean().optional(),
	supportedParameters: z.array(modelParametersSchema).optional(),
	inputPrice: z.number().optional(),
	outputPrice: z.number().optional(),
	cacheWritesPrice: z.number().optional(),
	cacheReadsPrice: z.number().optional(),
	description: z.string().optional(),
	// Default effort value for models that support reasoning effort
	reasoningEffort: reasoningEffortExtendedSchema.optional(),
	minTokensPerCachePoint: z.number().optional(),
	maxCachePoints: z.number().optional(),
	cachableFields: z.array(z.string()).optional(),
	// kilocode_change start
	displayName: z.string().nullish(),
	preferredIndex: z.number().nullish(),
	// kilocode_change end
	// Flag to indicate if the model is deprecated and should not be used
	deprecated: z.boolean().optional(),
	// Flag to indicate if the model should hide vendor/company identity in responses
	isStealthModel: z.boolean().optional(),
	// Flag to indicate if the model is free (no cost)
	isFree: z.boolean().optional(),
	// Flag to indicate if the model supports native tool calling (OpenAI-style function calling)
	supportsNativeTools: z.boolean().optional(),
	// Default tool protocol preferred by this model (if not specified, falls back to capability/provider defaults)
	defaultToolProtocol: z.enum(["xml", "native"]).optional(),
	// Exclude specific native tools from being available (only applies to native protocol)
	// These tools will be removed from the set of tools available to the model
	excludedTools: z.array(z.string()).optional(),
	// Include specific native tools (only applies to native protocol)
	// These tools will be added if they belong to an allowed group in the current mode
	// Cannot force-add tools from groups the mode doesn't allow
	includedTools: z.array(z.string()).optional(),
	/**
	 * Service tiers with pricing information.
	 * Each tier can have a name (for OpenAI service tiers) and pricing overrides.
	 * The top-level input/output/cache* fields represent the default/standard tier.
	 */
	tiers: z
		.array(
			z.object({
				name: serviceTierSchema.optional(), // Service tier name (flex, priority, etc.)
				contextWindow: z.number(),
				inputPrice: z.number().optional(),
				outputPrice: z.number().optional(),
				cacheWritesPrice: z.number().optional(),
				cacheReadsPrice: z.number().optional(),
			}),
		)
		.optional(),
})

export type ModelInfo = z.infer<typeof modelInfoSchema>

export type ModelRecord = Record<string, ModelInfo>

export type RouterModels = Record<DynamicProvider | LocalProvider, ModelRecord>
