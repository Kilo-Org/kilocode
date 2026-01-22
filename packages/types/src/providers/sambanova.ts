import type { ModelInfo } from "../model.js"

// https://docs.sambanova.ai/cloud/docs/get-started/supported-models
export type SambaNovaModelId =
	| "Meta-Llama-3.1-8B-Instruct"
	| "Meta-Llama-3.3-70B-Instruct"
	| "DeepSeek-R1"
	| "DeepSeek-V3-0324"
	| "DeepSeek-V3.1"
	| "Llama-4-Maverick-17B-128E-Instruct"
	| "Qwen3-32B"
	| "gpt-oss-120b"

export const sambaNovaDefaultModelId: SambaNovaModelId = "Meta-Llama-3.3-70B-Instruct"

export const sambaNovaModels = {
	"Meta-Llama-3.1-8B-Instruct": {
		maxTokens: 8192,
		contextWindow: 16384,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.1,
		outputPrice: 0.2,
		description: "Meta Llama 3.1 8B Instruct model with 16K context window.",
	},
	"Meta-Llama-3.3-70B-Instruct": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.6,
		outputPrice: 1.2,
		description: "Meta Llama 3.3 70B Instruct model with 128K context window.",
	},
	"DeepSeek-R1": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: false,
		supportsPromptCache: false,
		supportsReasoningBudget: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 5.0,
		outputPrice: 7.0,
		description: "DeepSeek R1 reasoning model with 32K context window.",
	},
	"DeepSeek-V3-0324": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 3.0,
		outputPrice: 4.5,
		description: "DeepSeek V3 model with 32K context window.",
	},
	"DeepSeek-V3.1": {
		maxTokens: 8192,
		contextWindow: 32768,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 3.0,
		outputPrice: 4.5,
		description: "DeepSeek V3.1 model with 32K context window.",
	},
	"Llama-4-Maverick-17B-128E-Instruct": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: true,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.63,
		outputPrice: 1.8,
		description: "Meta Llama 4 Maverick 17B 128E Instruct model with 128K context window.",
	},
	"Qwen3-32B": {
		maxTokens: 8192,
		contextWindow: 8192,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.4,
		outputPrice: 0.8,
		description: "Alibaba Qwen 3 32B model with 8K context window.",
	},
	"gpt-oss-120b": {
		maxTokens: 8192,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		inputPrice: 0.22,
		outputPrice: 0.59,
		description: "OpenAI gpt oss 120b model with 128k context window.",
	},
} as const satisfies Record<string, ModelInfo>
