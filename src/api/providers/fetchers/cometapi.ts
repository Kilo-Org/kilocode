import { z } from "zod"

import type { ModelInfo } from "@roo-code/types"
import { cometApiModels } from "@roo-code/types"

// Be lenient: CometAPI may return OpenAI-like or { success, data } shapes
const cometApiModelSchema = z
	.object({
		id: z.string(),
		object: z.literal("model").optional(),
		created: z.number().optional(),
		owned_by: z.string().optional(),
		// potential future fields
		max_tokens: z.number().optional(),
		max_input_tokens: z.number().optional(),
		context_length: z.number().optional(),
	})
	.passthrough()

const cometApiModelsResponseSchema = z.union([
	z.object({ object: z.literal("list").optional(), data: z.array(cometApiModelSchema) }),
	z.object({ success: z.boolean(), data: z.array(cometApiModelSchema) }),
])

// Ignore patterns (single source of truth) for non-chat or unsupported models
// Reference: cometapi.md COMETAPI_IGNORE_PATTERNS
const COMETAPI_IGNORE_PATTERNS = [
	// Image generation models
	"dall-e",
	"dalle",
	"midjourney",
	"mj_",
	"stable-diffusion",
	"sd-",
	"flux-",
	"playground-v",
	"ideogram",
	"recraft-",
	"black-forest-labs",
	"/recraft-v3",
	"recraftv3",
	"stability-ai/",
	"sdxl",
	// Audio generation models
	"suno_",
	"tts",
	"whisper",
	// Video generation models
	"runway",
	"luma_",
	"luma-",
	"veo",
	"kling_",
	"minimax_video",
	"hunyuan-t1",
	// Utility models
	"embedding",
	"search-gpts",
	"files_retrieve",
	"moderation",
]

function escapeRegex(str: string) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const COMETAPI_IGNORE_REGEX = new RegExp(COMETAPI_IGNORE_PATTERNS.map((p) => escapeRegex(p)).join("|"), "i")

export async function getCometAPIModels(
	apiKey?: string,
	baseURL: string = "https://api.cometapi.com/v1",
): Promise<Record<string, ModelInfo>> {
	const models: Record<string, ModelInfo> = {}

	// If no API key provided, return static models as fallback
	if (!apiKey) {
		console.warn("CometAPI: No API key provided, using static model definitions")
		return cometApiModels
	}

	try {
		const response = await fetch(`${baseURL.replace(/\/$/, "")}/models`, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
			signal: AbortSignal.timeout(15000),
		})

		if (!response.ok) throw new Error(`HTTP ${response.status}`)

		const raw = await response.json()
		const parsed = cometApiModelsResponseSchema.safeParse(raw)
		const data = parsed.success ? (parsed.data as any).data : (raw as any)?.data || []

		if (!parsed.success) {
			console.warn("CometAPI: Unexpected models response; proceeding with best-effort parsing")
		}

		for (const model of data as Array<z.infer<typeof cometApiModelSchema> | any>) {
			if (!model || typeof model.id !== "string") continue
			if (COMETAPI_IGNORE_REGEX.test(model.id)) continue

			const contextWindow =
				(model as any).max_input_tokens || (model as any).context_length || (model as any).max_tokens || 200000

			const info: ModelInfo = {
				contextWindow,
				supportsImages: false,
				supportsPromptCache: false,
			}

			models[model.id] = info
		}

		const mergedModels = { ...cometApiModels, ...models }
		return mergedModels
	} catch (error) {
		console.error("CometAPI: Error fetching models", error)
		return cometApiModels
	}
}
