import type { ModelInfo } from "../model.js"

// AskSage
// https://api.asksage.ai/server/v1
export const askSageDefaultModelId = "gpt-4o-mini"

export const askSageDefaultModelInfo: ModelInfo = {
	maxTokens: 4096,
	contextWindow: 128_000,
	supportsImages: true,
	supportsPromptCache: false,
	supportsNativeTools: true,
	defaultToolProtocol: "native",
	inputPrice: 0.15,
	outputPrice: 0.6,
	description:
		"GPT-4o Mini via AskSage router. AskSage provides access to multiple AI models through a unified OpenAI-compatible API.",
}
