// kilocode_change - new file
import type { ModelInfo } from "../model.js"

export const nanoGptDefaultModelId = "chatgpt-4o-latest"

export const nanoGptDefaultModelInfo: ModelInfo = {
	description: "OpenAI's affordable and intelligent small model for fast, lightweight tasks",
	contextWindow: 128_000,
	supportsPromptCache: false,
	inputPrice: 0.15,
	outputPrice: 0.6,
	maxTokens: 16_384,
}
