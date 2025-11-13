import { z } from "zod"

import type { ModelInfo } from "../model.js"

/**
 * Roo Code Cloud is a dynamic provider - models are loaded from the /v1/models API endpoint.
 * Default model ID used as fallback when no model is specified.
 */
export const rooDefaultModelId = "xai/grok-code-fast-1"

/**
 * Empty models object maintained for type compatibility.
 * All model data comes dynamically from the API.
 */
export const rooModels = {} as const satisfies Record<string, ModelInfo>

/**
 * Roo Code Cloud API response schemas
 */

export const RooPricingSchema = z.object({
	input: z.string(),
	output: z.string(),
	input_cache_read: z.string().optional(),
	input_cache_write: z.string().optional(),
})

export const RooModelSchema = z.object({
	id: z.string(),
	object: z.literal("model"),
	created: z.number(),
	owned_by: z.string(),
	name: z.string(),
	description: z.string(),
	context_window: z.number(),
	max_tokens: z.number(),
	type: z.literal("language"),
	tags: z.array(z.string()).optional(),
	pricing: RooPricingSchema,
	deprecated: z.boolean().optional(),
})

export const RooModelsResponseSchema = z.object({
	object: z.literal("list"),
	data: z.array(RooModelSchema),
})

export type RooModel = z.infer<typeof RooModelSchema>
export type RooModelsResponse = z.infer<typeof RooModelsResponseSchema>
