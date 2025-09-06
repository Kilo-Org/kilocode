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
	| "zai-org/GLM-4-32B-0414"
	| "zai-org/GLM-Z1-32B-0414"
	| "ArliAI/QwQ-32B-ArliAI-RpR-v1"
	| "tencent/Hunyuan-A13B-Instruct"
	| "openai/gpt-oss-120b"
	| "openai/gpt-oss-20b"
	| "meituan-longcat/LongCat-Flash-Chat-FP8"

export const chutesDefaultModelId: ChutesModelId = "deepseek-ai/DeepSeek-R1-0528"

export const chutesModels = {
	// DeepSeek Models (Newest to Oldest)
	"deepseek-ai/DeepSeek-V3.1": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3.1 model.",
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
	"deepseek-ai/DeepSeek-V3-0324": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3 (0324) model.",
	},
	"deepseek-ai/DeepSeek-R1-0528": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 0528 model.",
	},
	"deepseek-ai/DeepSeek-R1-0528-vllm": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 0528 model with vLLM optimization for improved inference performance.",
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
	"deepseek-ai/DeepSeek-R1-Zero": {
		maxTokens: 32768,
		contextWindow: 163840,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek R1 Zero model.",
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
	"deepseek-ai/DeepSeek-R1-0528-Qwen3-8B": {
		maxTokens: 32768,
		contextWindow: 163840, // Same as other DeepSeek R1 models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"DeepSeek R1 0528 Qwen3 8B - Hybrid model combining DeepSeek R1 architecture with Qwen3 capabilities at 8B parameters.",
	},
	"deepseek-ai/DeepSeek-R1-Distill-Llama-70B": {
		maxTokens: 32768,
		contextWindow: 163840, // Consistent with DeepSeek R1 architecture
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"DeepSeek R1 Distill Llama 70B - Distilled variant of DeepSeek R1 with Llama 70B architecture, combining DeepSeek R1 capabilities with Llama 70B efficiency and performance.",
	},

	// Qwen Models (Newest to Oldest)
	"Qwen/Qwen3-235B-A22B-Thinking-2507": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.077968332,
		outputPrice: 0.31202496,
		description: "Qwen3 235B A22B Thinking 2507 model with 262K context window.",
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
	"Qwen/Qwen3-30B-A3B-Thinking-2507": {
		maxTokens: 32768,
		contextWindow: 40960, // Same as Qwen/Qwen3-30B-A3B
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Qwen3 30B A3B Thinking 2507 - Instruct-tuned version of Qwen3 30B A3B model, July 2027 version, optimized for instruction following and conversation with enhanced reasoning capabilities.",
	},
	"Qwen/Qwen3-30B-A3B-Instruct-2507": {
		maxTokens: 32768,
		contextWindow: 40960, // Same as Qwen/Qwen3-30B-A3B
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Qwen3 30B A3B Instruct 2507 - Instruct-tuned version of Qwen3 30B A3B model, July 2027 version, optimized for instruction following and conversation.",
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
	"Qwen/Qwen3-Coder-30B-A3B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Qwen3 Coder models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Qwen3 Coder 30B A3B Instruct - Specialized coding model from Qwen with 30B parameters and A3B architecture, optimized for programming tasks, code generation, and software development assistance with enhanced instruction following capabilities.",
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
	"Qwen/Qwen2.5-72B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Qwen2.5 72B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Qwen2.5 72B Instruct - Advanced 72-billion parameter model from Qwen optimized for instruction following, providing powerful conversational abilities and broad knowledge capabilities with enhanced reasoning skills.",
	},
	"Qwen/Qwen2.5-Coder-32B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Qwen2.5 32B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Qwen2.5 Coder 32B Instruct - Specialized coding model from Qwen with 32B parameters, optimized for programming tasks, code generation, and software development assistance with enhanced instruction following capabilities.",
	},
	"Qwen/Qwen2.5-VL-32B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard context window for Qwen2.5 models
		supportsImages: true, // This is a vision-language model
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Qwen2.5-VL-32B-Instruct - Vision-Language model with 32B parameters, capable of processing both text and images.",
	},

	// Gemma Models (Newest to Oldest)
	"unsloth/gemma-3-27b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 27B IT model with improved performance.",
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
	"unsloth/gemma-3-4b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 4B IT model.",
	},
	"unsloth/gemma-3-2b-it": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Gemma 3 2B IT model - lightweight and efficient.",
	},
	"unsloth/gemma-2-9b-it": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Gemma 2 9B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Gemma 2 9B IT - Unsloth optimized version of Google's Gemma 2 9B model with instruction tuning, providing efficient inference and strong performance for a wide range of tasks.",
	},

	// Llama Models (Newest to Oldest)
	"unsloth/Llama-3.3-70B-Instruct": {
		maxTokens: 32768, // From Groq
		contextWindow: 131072, // From Groq
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Llama 3.3 70B Instruct model.",
	},
	"unsloth/Llama-3.3-8B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Llama 3.3 8B Instruct model.",
	},
	"unsloth/Llama-3.3-1B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Llama 3.3 1B Instruct model - ultra lightweight.",
	},
	"unsloth/Llama-3.2-3B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Unsloth Llama 3.2 3B Instruct model - lightweight and efficient for fast inference.",
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
	"chutesai/Llama-4-Scout-17B-16E-Instruct": {
		maxTokens: 32768,
		contextWindow: 512000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Llama 4 Scout 17B Instruct model, 512K context.",
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

	// Mistral Models (Newest to Oldest)
	"chutesai/Mistral-Small-3.2-24B-Instruct-2506": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Mistral-based models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Mistral Small 3.2 24B Instruct 2506 - ChutesAI proprietary model based on Mistral architecture with 24B parameters, June 2025 version, improved instruction following capabilities.",
	},
	"unsloth/Mistral-Small-24B-Instruct-2501": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Mistral-based 24B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Unsloth Mistral Small 24B Instruct 2501 - January 2025 version of Mistral Small 24B model with Unsloth optimizations, providing efficient inference and instruction following capabilities.",
	},
	"chutesai/Mistral-Small-3.1-24B-Instruct-2503": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Mistral-based models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Mistral Small 3.1 24B Instruct 2503 - ChutesAI proprietary model based on Mistral architecture with 24B parameters, March 2025 version, optimized for instruction following.",
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
	"NousResearch/DeepHermes-3-Mistral-24B-Preview": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Mistral-based models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Nous DeepHermes 3 Mistral 24B Preview - Advanced conversational model based on Mistral architecture with 24B parameters.",
	},
	"cognitivecomputations/Dolphin3.0-Mistral-24B": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Mistral-based 24B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Dolphin 3.0 Mistral 24B - Uncensored model from Cognitive Computations based on Mistral architecture with 24B parameters, known for its conversational abilities.",
	},
	"cognitivecomputations/Dolphin3.0-R1-Mistral-24B": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Mistral-based 24B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Dolphin 3.0 R1 Mistral 24B - R1 variant of the uncensored model from Cognitive Computations based on Mistral architecture with 24B parameters, enhanced conversational abilities and instruction following.",
	},

	// Moonshot/Kimi Models (Newest to Oldest)
	"moonshotai/Kimi-K2-Instruct-0905": {
		maxTokens: 32768,
		contextWindow: 262144,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1999,
		outputPrice: 0.8001,
		description: "Moonshot AI Kimi K2 Instruct 0905 model with 256k context window.",
	},
	"moonshotai/Kimi-K2-Instruct-75k": {
		maxTokens: 32768,
		contextWindow: 75000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1481,
		outputPrice: 0.5926,
		description: "Moonshot AI Kimi K2 Instruct model with 75k context window.",
	},
	"moonshotai/Kimi-Dev-72B": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for 72B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Moonshot AI Kimi Dev 72B - Development-focused 72-billion parameter model from Moonsshot AI, optimized for coding, debugging, and software development tasks with enhanced reasoning capabilities.",
	},
	"moonshotai/Kimi-VL-A3B-Thinking": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for vision-language models
		supportsImages: true, // This is a vision-language model
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Moonshot AI Kimi VL A3B Thinking - Vision-Language model with A3B architecture from Moonshot AI, optimized for multimodal tasks combining visual understanding with advanced reasoning capabilities and instruction following.",
	},

	// Other Models (Grouped by organization/type)
	"chutesai/Devstral-Small-2505": {
		maxTokens: 32768,
		contextWindow: 131072,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "ChutesAI Devstral Small model (May 2025 release) - optimized for efficient performance.",
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
	"NousResearch/Hermes-4-405B-FP8": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard context window
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Hermes 4 405B FP8 - Massive 405-billion parameter model from Nous Research with FP8 quantization for efficient inference.",
	},
	"NousResearch/Hermes-4-70B": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for 70B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Hermes 4 70B - Advanced 70-billion parameter model from Nous Research, optimized for instruction following and conversational AI tasks.",
	},
	"shisa-ai/shisa-v2-llama3.3-70b": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for Llama 3.3 based models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Shisa v2 Llama 3.3 70B - Japanese-focused model based on Llama 3.3 with 70B parameters, optimized for Japanese language and culture.",
	},
	"TheDrummer/Skyfall-36B-v2": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard context window
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Skyfall 36B v2 - 36-billion parameter model from TheDrummer, likely optimized for creative writing and storytelling.",
	},
	"TheDrummer/Tunguska-39B-v1": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for 39B parameter models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Tunguska 39B v1 - TheDrummer's 39-billion parameter model optimized for instruction following and creative tasks, providing advanced reasoning capabilities and versatile performance across various domains.",
	},
	"TheDrummer/Gemmasutra-Pro-27B-v1.1": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for 27B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Gemmasutra Pro 27B v1.1 - Specialized 27-billion parameter model from TheDrummer based on Gemma architecture, optimized for creative and instructional tasks with enhanced capabilities.",
	},
	"Tesslate/UIGEN-X-32B-0727": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard context window
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Tesslate UIGEN-X 32B 0727 - Specialized model from Tesslate with 32B parameters, likely focused on UI generation tasks.",
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
	"tngtech/DeepSeek-TNG-R1T2-Chimera": {
		maxTokens: 32768,
		contextWindow: 163840, // Consistent with DeepSeek R1 architecture
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"TNGTech DeepSeek TNG R1T2 Chimera - Specialized DeepSeek variant from TNG Technology with enhanced capabilities.",
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
	"zai-org/GLM-4-32B-0414": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard context window for GLM-4 models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GLM-4 32B 0414 - General Language Model from ZAI with 32B parameters, April 2024 version, optimized for Chinese and multilingual tasks.",
	},
	"zai-org/GLM-Z1-32B-0414": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard context window for GLM models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GLM-Z1 32B 0414 - Z1 variant of General Language Model from ZAI with 32B parameters, April 2024 version, specialized variant with enhanced capabilities.",
	},
	"ArliAI/QwQ-32B-ArliAI-RpR-v1": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard context window for 32B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"QwQ 32B ArliAI RpR v1 - Role-play optimized model from ArliAI with 32B parameters, QwQ architecture variant designed for character interaction and storytelling.",
	},
	"tencent/Hunyuan-A13B-Instruct": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for 13B parameter models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"Hunyuan A13B Instruct - Tencent's 13-billion parameter Hunyuan model optimized for instruction following, providing strong conversational abilities and Chinese language capabilities.",
	},
	"openai/gpt-oss-120b": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for large 120B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GPT-OSS-120B - OpenAI's open-source 120-billion parameter model, representing a massive-scale open source language model with advanced capabilities and broad knowledge base.",
	},
	"openai/gpt-oss-20b": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard for 20B models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"GPT-OSS-20B - OpenAI's open-source 20-billion parameter model, providing a balanced combination of performance and efficiency with broad capabilities.",
	},
	"meituan-longcat/LongCat-Flash-Chat-FP8": {
		maxTokens: 32768,
		contextWindow: 131072, // Standard context window for FP8 models
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description:
			"LongCat Flash Chat FP8 - Meituan's LongCat model with FP8 quantization optimized for fast inference and chat applications, providing efficient performance with reduced memory usage.",
	},
} as const satisfies Record<string, ModelInfo>
