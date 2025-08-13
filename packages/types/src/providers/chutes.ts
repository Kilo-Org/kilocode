// kilocode_change: this file was updated in https://github.com/Kilo-Org/kilocode/pull/1889, revert to Roo version in case of conflicts

import type { ModelInfo } from "../model.js"

// https://llm.chutes.ai/v1 (OpenAI compatible)
export type ChutesModelId =
	| "deepseek-ai/DeepSeek-R1-0528"
	| "deepseek-ai/DeepSeek-R1"
	| "deepseek-ai/DeepSeek-V3"
	| "chutesai/Llama-4-Scout-17B-16E-Instruct"
	| "unsloth/Mistral-Nemo-Instruct-2407"
	| "unsloth/gemma-3-12b-it"
	| "NousResearch/DeepHermes-3-Llama-3-8B-Preview"
	| "unsloth/gemma-3-4b-it"
	| "chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8"
	| "deepseek-ai/DeepSeek-V3-Base"
	| "deepseek-ai/DeepSeek-V3-0324"
	| "Qwen/Qwen3-235B-A22B"
	| "Qwen/Qwen3-235B-A22B-Instruct-2507"
	| "Qwen/Qwen3-32B"
	| "Qwen/Qwen3-30B-A3B"
	| "Qwen/Qwen3-14B"
	| "Qwen/Qwen3-8B"
	| "microsoft/MAI-DS-R1-FP8"
	| "tngtech/DeepSeek-R1T-Chimera"
	| "zai-org/GLM-4.5-Air"
	| "zai-org/GLM-4.5-FP8"
	| "Qwen/Qwen3-235B-A22B-Thinking-2507"
	| "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B"
	| "moonshotai/Kimi-K2-Instruct"
	| "moonshotai/Kimi-Dev-72B"
	| "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8"
	| "chutesai/Devstral-Small-2505"
	| "openai/gpt-oss-120b"

export const chutesDefaultModelId: ChutesModelId = "deepseek-ai/DeepSeek-R1-0528"

export const chutesModels = {
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.17992692,
		outputPrice: 0.7200576,
		description: "DeepSeek R1 0528 model.",
	},
	"deepseek-ai/DeepSeek-R1": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.17992692,
		outputPrice: 0.7200576,
		description: "DeepSeek R1 model.",
	},
	"deepseek-ai/DeepSeek-V3": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.17992692,
		outputPrice: 0.7200576,
		description: "DeepSeek V3 model.",
	},
	"chutesai/Llama-4-Scout-17B-16E-Instruct": {
		maxTokens: 32768,
		contextWindow: 64000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.01999188,
		outputPrice: 0.08000639999999999,
		description: "ChutesAI Llama 4 Scout 17B Instruct model, 64K context.",
	},
	"unsloth/Mistral-Nemo-Instruct-2407": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.01,
		outputPrice: 0.040003199999999996,
		description: "Unsloth Mistral Nemo Instruct model.",
	},
	"unsloth/gemma-3-12b-it": {
		maxTokens: 32768,
		contextWindow: 96000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.0481286,
		outputPrice: 0.192608,
		description: "Unsloth Gemma 3 12B IT model.",
	},
	"NousResearch/DeepHermes-3-Llama-3-8B-Preview": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nous DeepHermes 3 Llama 3 8B Preview model.",
	},
	"unsloth/gemma-3-4b-it": {
		maxTokens: 32768,
		contextWindow: 96000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.01703012,
		outputPrice: 0.0681536,
		description: "Unsloth Gemma 3 4B IT model.",
	},
	"chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.17992692,
		outputPrice: 0.7200576,
		description: "ChutesAI Llama 4 Maverick 17B Instruct FP8 model.",
	},
	"deepseek-ai/DeepSeek-V3-Base": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1999188,
		outputPrice: 0.800064,
		description: "DeepSeek V3 Base model.",
	},
	"deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.17992692,
		outputPrice: 0.7200576,
		description: "DeepSeek V3 (0324) model.",
	},
	"Qwen/Qwen3-235B-A22B-Instruct-2507": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.077968332,
		outputPrice: 0.31202496,
		description: "Qwen3 235B A22B Instruct 2507 model with 262K context window.",
	},
	"Qwen/Qwen3-235B-A22B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1999188,
		outputPrice: 0.800064,
		description: "Qwen3 235B A22B model.",
	},
	"Qwen/Qwen3-32B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.017992692,
		outputPrice: 0.07200575999999999,
		description: "Qwen3 32B model.",
	},
	"Qwen/Qwen3-30B-A3B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.01999188,
		outputPrice: 0.08000639999999999,
		description: "Qwen3 30B A3B model.",
	},
	"Qwen/Qwen3-14B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 14B model.",
	},
	"Qwen/Qwen3-8B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 8B model.",
	},
	"microsoft/MAI-DS-R1-FP8": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1999188,
		outputPrice: 0.800064,
		description: "Microsoft MAI-DS-R1 FP8 model.",
	},
	"tngtech/DeepSeek-R1T-Chimera": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.17992692,
		outputPrice: 0.7200576,
		description: "TNGTech DeepSeek R1T Chimera model.",
	},
	"zai-org/GLM-4.5-Air": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GLM-4.5-Air model with 131,072 token context window and 106B total parameters with 12B activated.",
	},
	"zai-org/GLM-4.5-FP8": {
		maxTokens: 32768,
		contextWindow: 98304,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1999188,
		outputPrice: 0.800064,
		description:
			"GLM-4.5-FP8 model with 98,304 token context window, optimized for agent-based applications with MoE architecture.",
	},
	"Qwen/Qwen3-235B-A22B-Thinking-2507": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.077968332,
		outputPrice: 0.31202496,
		description: "Qwen3 235B A22B Thinking 2507 model with 262K context window.",
	},
	"deepseek-ai/DeepSeek-R1-0528-Qwen3-8B": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.01703012,
		outputPrice: 0.0681536,
		description: "DeepSeek R1 0528 Qwen3 8B model with 131K context window.",
	},
	"moonshotai/Kimi-K2-Instruct": {
		maxTokens: 32768,
		contextWindow: 75000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.148088,
		outputPrice: 0.59264,
		description: "Moonshot AI Kimi K2 Instruct model with 75K context window.",
	},
	"moonshotai/Kimi-Dev-72B": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.06663960000000001,
		outputPrice: 0.266688,
		description: "Moonshot AI Kimi Dev 72B model with 131K context window.",
	},
	"Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1999188,
		outputPrice: 0.800064,
		description: "Qwen3 Coder 480B A35B Instruct FP8 model with 262K context window.",
	},
	"chutesai/Devstral-Small-2505": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.01999188,
		outputPrice: 0.08000639999999999,
		description: "ChutesAI Devstral Small 2505 model with 131K context window.",
	},
	"openai/gpt-oss-120b": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.07256312,
		outputPrice: 0.2903936,
		description: "OpenAI GPT-OSS 120B model with 131K context window.",
	},
} as const satisfies Record<string, ModelInfo>
