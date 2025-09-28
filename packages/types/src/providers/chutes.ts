import type { ModelInfo } from "../model.js"

// https://llm.chutes.ai/v1 (OpenAI compatible)
export type ChutesModelId =
	// DeepSeek Models (Newest to Oldest)
	| "deepseek-ai/DeepSeek-V3.1"
	| "deepseek-ai/DeepSeek-V3"
	| "deepseek-ai/DeepSeek-V3-0324"
	| "deepseek-ai/DeepSeek-R1-0528"
	| "deepseek-ai/DeepSeek-R1-0528-vllm"
	| "deepseek-ai/DeepSeek-R1"
	| "deepseek-ai/DeepSeek-R1-Zero"
	| "deepseek-ai/DeepSeek-V3-Base"
	| "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B"
	| "deepseek-ai/DeepSeek-R1-Distill-Llama-70B"
	// kilocode_change start
	| "deepseek-ai/DeepSeek-V3.1-Terminus"
	| "deepseek-ai/DeepSeek-V3.1-turbo"
	| "deepseek-ai/DeepSeek-V3-0324-turbo"
	// kilocode_change end

	// Qwen Models (Newest to Oldest)
	| "Qwen/Qwen3-235B-A22B-Thinking-2507"
	| "Qwen/Qwen3-235B-A22B-Instruct-2507"
	| "Qwen/Qwen3-235B-A22B"
	| "Qwen/Qwen3-30B-A3B-Thinking-2507"
	| "Qwen/Qwen3-30B-A3B-Instruct-2507"
	| "Qwen/Qwen3-30B-A3B"
	| "Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8"
	| "Qwen/Qwen3-Coder-30B-A3B-Instruct"
	| "Qwen/Qwen3-32B"
	| "Qwen/Qwen3-14B"
	| "Qwen/Qwen3-8B"
	| "Qwen/Qwen2.5-72B-Instruct"
	| "Qwen/Qwen2.5-Coder-32B-Instruct"
	| "Qwen/Qwen2.5-VL-32B-Instruct"
	| "Qwen/Qwen3-Next-80B-A3B-Instruct"
	| "Qwen/Qwen3-Next-80B-A3B-Thinking"

	// Gemma Models (Newest to Oldest)
	| "unsloth/gemma-3-27b-it"
	| "unsloth/gemma-3-12b-it"
	| "unsloth/gemma-3-4b-it"
	| "unsloth/gemma-3-2b-it"
	| "unsloth/gemma-2-9b-it"

	// Llama Models (Newest to Oldest)
	| "unsloth/Llama-3.3-70B-Instruct"
	| "unsloth/Llama-3.3-8B-Instruct"
	| "unsloth/Llama-3.3-1B-Instruct"
	| "unsloth/Llama-3.2-3B-Instruct"
	| "chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8"
	| "chutesai/Llama-4-Scout-17B-16E-Instruct"
	| "nvidia/Llama-3_3-Nemotron-Super-49B-v1"
	| "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1"

	// Mistral Models (Newest to Oldest)
	| "chutesai/Mistral-Small-3.2-24B-Instruct-2506"
	| "unsloth/Mistral-Small-24B-Instruct-2501"
	| "chutesai/Mistral-Small-3.1-24B-Instruct-2503"
	| "unsloth/Mistral-Nemo-Instruct-2407"
	| "NousResearch/DeepHermes-3-Mistral-24B-Preview"
	| "cognitivecomputations/Dolphin3.0-Mistral-24B"
	| "cognitivecomputations/Dolphin3.0-R1-Mistral-24B"

	// Moonshot/Kimi Models (Newest to Oldest)
	| "moonshotai/Kimi-K2-Instruct-0905"
	| "moonshotai/Kimi-K2-Instruct-75k"
	| "moonshotai/Kimi-Dev-72B"
	| "moonshotai/Kimi-VL-A3B-Thinking"

	// Other Models (Grouped by organization/type)
	| "chutesai/Devstral-Small-2505"
	| "NousResearch/DeepHermes-3-Llama-3-8B-Preview"
	| "NousResearch/Hermes-4-405B-FP8"
	| "NousResearch/Hermes-4-70B"
	| "shisa-ai/shisa-v2-llama3.3-70b"
	| "TheDrummer/Skyfall-36B-v2"
	| "TheDrummer/Tunguska-39B-v1"
	| "TheDrummer/Gemmasutra-Pro-27B-v1.1"
	| "Tesslate/UIGEN-X-32B-0727"
	| "microsoft/MAI-DS-R1-FP8"
	| "tngtech/DeepSeek-R1T-Chimera"
	| "tngtech/DeepSeek-TNG-R1T2-Chimera"
	| "zai-org/GLM-4.5-Air"
	| "zai-org/GLM-4.5-FP8"
	// kilocode_change start
	| "zai-org/GLM-4.5V"
	// kilocode_change end
	| "zai-org/GLM-4-32B-0414"
	| "zai-org/GLM-Z1-32B-0414"
	| "ArliAI/QwQ-32B-ArliAI-RpR-v1"
	| "tencent/Hunyuan-A13B-Instruct"
	| "openai/gpt-oss-120b"
	| "openai/gpt-oss-20b"
	| "meituan-longcat/LongCat-Flash-Chat-FP8"
	| "zai-org/GLM-4.5-turbo"

export const chutesDefaultModelId: ChutesModelId = "deepseek-ai/DeepSeek-R1-0528"

export const chutesModels = {
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 0528 model.",
	},
	"deepseek-ai/DeepSeek-R1": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 model.",
	},
	"deepseek-ai/DeepSeek-V3": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 model.",
	},
	"deepseek-ai/DeepSeek-V3.1": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3.1 model.",
	},
	"unsloth/Llama-3.3-70B-Instruct": {
		maxTokens: 32768, // From Groq
		contextWindow: 131072, // From Groq
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Llama 3.3 70B Instruct model.",
	},
	"chutesai/Llama-4-Scout-17B-16E-Instruct": {
		maxTokens: 32768,
		contextWindow: 512000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Llama 4 Scout 17B Instruct model, 512K context.",
	},
	"unsloth/Mistral-Nemo-Instruct-2407": {
		maxTokens: 32768,
		contextWindow: 128000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Mistral Nemo Instruct model.",
	},
	"unsloth/gemma-3-12b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
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
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 4B IT model.",
	},
	"nvidia/Llama-3_3-Nemotron-Super-49B-v1": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nvidia Llama 3.3 Nemotron Super 49B model.",
	},
	"nvidia/Llama-3_1-Nemotron-Ultra-253B-v1": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Nvidia Llama 3.1 Nemotron Ultra 253B model.",
	},
	"chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8": {
		maxTokens: 32768,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Llama 4 Maverick 17B Instruct FP8 model.",
	},
	"deepseek-ai/DeepSeek-V3-Base": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 Base model.",
	},
	"deepseek-ai/DeepSeek-R1-Zero": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 Zero model.",
	},
	"deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 (0324) model.",
	},
	// kilocode_change start
	"deepseek-ai/DeepSeek-V3.1-Terminus": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.25,
		outputPrice: 1.0,
		description: "DeepSeek V3.1 Terminus model.",
	},
	"deepseek-ai/DeepSeek-V3.1-turbo": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.0,
		outputPrice: 3.0,
		description: "DeepSeek V3.1 Turbo model.",
	},
	"deepseek-ai/DeepSeek-V3-0324-turbo": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1.0,
		outputPrice: 3.0,
		description: "DeepSeek V3 (0324) Turbo model.",
	},
	// kilocode_change end
	"Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Qwen3 Coder 480B A35B Instruct FP8 - Large-scale coding model with 480B parameters and FP8 quantization.",
	},
	"Qwen/Qwen3-235B-A22B-Instruct-2507": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 235B A22B Instruct 2507 model with 262K context window.",
	},
	"Qwen/Qwen3-235B-A22B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 235B A22B model.",
	},
	"Qwen/Qwen3-32B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen3 32B model.",
	},
	"Qwen/Qwen3-30B-A3B": {
		maxTokens: 32768,
		contextWindow: 40960,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
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
		inputPrice: 0,
		outputPrice: 0,
		description: "Microsoft MAI-DS-R1 FP8 model.",
	},
	"tngtech/DeepSeek-R1T-Chimera": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "TNGTech DeepSeek R1T Chimera model.",
	},
	"zai-org/GLM-4.5-Air": {
		maxTokens: 32768,
		contextWindow: 151329,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GLM-4.5-Air model with 151,329 token context window and 106B total parameters with 12B activated.",
	},
	"zai-org/GLM-4.5-FP8": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GLM-4.5-FP8 model with 128k token context window, optimized for agent-based applications with MoE architecture.",
	},
	"zai-org/GLM-4.5-turbo": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 1,
		outputPrice: 3,
		description: "GLM-4.5-turbo model with 128K token context window, optimized for fast inference.",
	},
	// kilocode_change start
	"zai-org/GLM-4.5V": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.08,
		outputPrice: 0.33,
		description: "GLM-4.5V model.",
	},
	// kilocode_change end
	"moonshotai/Kimi-K2-Instruct-75k": {
		maxTokens: 32768,
		contextWindow: 75000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1481,
		outputPrice: 0.5926,
		description: "Moonshot AI Kimi K2 Instruct model with 75k context window.",
	},
	"moonshotai/Kimi-K2-Instruct-0905": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1999,
		outputPrice: 0.8001,
		description: "Moonshot AI Kimi K2 Instruct 0905 model with 256k context window.",
	},
	// kilocode_change start
	"moonshotai/Kimi-Dev-72B": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.07,
		outputPrice: 0.26,
		description: "Moonshot AI Kimi Dev 72B model.",
	},
	"moonshotai/Kimi-VL-A3B-Thinking": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.02,
		outputPrice: 0.07,
		description: "Moonshot AI Kimi VL A3B Thinking model.",
	},
	// kilocode_change end
	"Qwen/Qwen3-235B-A22B-Thinking-2507": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.077968332,
		outputPrice: 0.31202496,
		description: "Qwen3 235B A22B Thinking 2507 model with 262K context window.",
	},
	"Qwen/Qwen3-Next-80B-A3B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Fast, stable instruction-tuned model optimized for complex tasks, RAG, and tool use without thinking traces.",
	},
	"Qwen/Qwen3-Next-80B-A3B-Thinking": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Reasoning-first model with structured thinking traces for multi-step problems, math proofs, and code synthesis.",
	},
} as const satisfies Record<string, ModelInfo>
