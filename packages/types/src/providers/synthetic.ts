// kilocode_change: provider added

import type { ModelInfo } from "../model.js"

export type SyntheticModelId =
	| "hf:zai-org/GLM-4.5"
	| "hf:openai/gpt-oss-120b"
	| "hf:moonshotai/Kimi-K2-Instruct-0905"
	| "hf:reissbaker/llama-3.1-70b-abliterated-lora"
	| "hf:meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8"
	| "hf:deepseek-ai/DeepSeek-V3.1"
	| "hf:meta-llama/Llama-3.1-8B-Instruct"
	| "hf:meta-llama/Llama-3.1-70B-Instruct"
	| "hf:meta-llama/Llama-3.1-405B-Instruct"
	| "hf:meta-llama/Llama-3.3-70B-Instruct"
	| "hf:deepseek-ai/DeepSeek-V3-0324"
	| "hf:deepseek-ai/DeepSeek-R1"
	| "hf:moonshotai/Kimi-K2-Instruct"
	| "hf:meta-llama/Llama-4-Scout-17B-16E-Instruct"
	| "hf:Qwen/Qwen3-Coder-480B-A35B-Instruct"
	| "hf:Qwen/Qwen2.5-Coder-32B-Instruct"
	| "hf:Qwen/Qwen3-235B-A22B-Thinking-2507"
	| "hf:Qwen/Qwen3-235B-A22B-Instruct-2507"

export const syntheticDefaultModelId: SyntheticModelId = "hf:zai-org/GLM-4.5"

export const syntheticModels = {
	"hf:moonshotai/Kimi-K2-Instruct-0905": {
		maxTokens: 262144,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.2,
		outputPrice: 1.2,
		description:
			"Kimi K2 model gets a new version update: Agentic coding: more accurate, better generalization across scaffolds. Frontend coding: improved aesthetics and functionalities on web, 3d, and other tasks. Context length: extended from 128k to 256k, providing better long-horizon support.",
	},
	"hf:openai/gpt-oss-120b": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
	},
	"hf:zai-org/GLM-4.5": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.55,
		outputPrice: 2.19,
	},
	"hf:reissbaker/llama-3.1-70b-abliterated-lora": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.9,
		outputPrice: 0.9,
	},
	"hf:meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": {
		maxTokens: 524000,
		contextWindow: 524000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.22,
		outputPrice: 0.88,
	},
	"hf:deepseek-ai/DeepSeek-V3.1": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.56,
		outputPrice: 1.68,
	},
	"hf:meta-llama/Llama-3.1-405B-Instruct": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 3.0,
	},
	"hf:meta-llama/Llama-3.1-70B-Instruct": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.9,
		outputPrice: 0.9,
	},
	"hf:meta-llama/Llama-3.1-8B-Instruct": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.2,
		outputPrice: 0.2,
	},
	"hf:meta-llama/Llama-3.3-70B-Instruct": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.9,
		outputPrice: 0.9,
	},
	"hf:deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.2,
		outputPrice: 1.2,
	},
	"hf:deepseek-ai/DeepSeek-R1": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.55,
		outputPrice: 2.19,
	},
	"hf:deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 3.0,
		outputPrice: 8.0,
	},
	"hf:meta-llama/Llama-4-Scout-17B-16E-Instruct": {
		maxTokens: 328000,
		contextWindow: 328000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.15,
		outputPrice: 0.6,
	},
	"hf:moonshotai/Kimi-K2-Instruct": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.6,
		outputPrice: 2.5,
	},
	"hf:Qwen/Qwen3-Coder-480B-A35B-Instruct": {
		maxTokens: 256000,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.45,
		outputPrice: 1.8,
	},
	"hf:Qwen/Qwen2.5-Coder-32B-Instruct": {
		maxTokens: 32000,
		contextWindow: 32000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.8,
		outputPrice: 0.8,
	},
	"hf:deepseek-ai/DeepSeek-V3": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.25,
		outputPrice: 1.25,
	},
	"hf:Qwen/Qwen3-235B-A22B-Instruct-2507": {
		maxTokens: 256000,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.22,
		outputPrice: 0.88,
	},
	"hf:Qwen/Qwen3-235B-A22B-Thinking-2507": {
		maxTokens: 256000,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.65,
		outputPrice: 3.0,
	},
} as const satisfies Record<string, ModelInfo>
