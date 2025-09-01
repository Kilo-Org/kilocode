import type { ModelInfo } from "../model.js"

// Ollama
// https://ollama.com/models
export const ollamaDefaultModelId = "devstral:24b"
export const ollamaDefaultModelInfo: ModelInfo = {
	maxTokens: 4096,
	contextWindow: 128_000, //kilocode_change
	// kilocode_change the most common models on https://ollama.com/library are all 128K, except for the qwen3 family, which are either 40K or 256K
	supportsImages: true,
	supportsComputerUse: true,
	supportsPromptCache: true,
	inputPrice: 0,
	outputPrice: 0,
	cacheWritesPrice: 0,
	cacheReadsPrice: 0,
	description: "Ollama hosted models",
}
