import type { ModelInfo } from "../model.js"

// https://endpoints.ai.cloud.ovh.net/docs
export type OVHCloudAiEndpointsModelId = keyof typeof ovhCloudAiEndpointsModels

export const ovhCloudAiEndpointsDefaultModelId: OVHCloudAiEndpointsModelId = "Meta-Llama-3_3-70B-Instruct"

export const ovhCloudAiEndpointsModels = {
	"Qwen2.5-VL-72B-Instruct": {
		maxTokens: 32000,
		contextWindow: 32000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.91,
		outputPrice: 0.91,
		description:
			"Qwen2.5-VL is a powerful vision-language model, designed for advanced image understanding. It can generate detailed image captions, analyze documents, OCR, detect objects, and answer questions based on visuals.",
	},
	"llava-next-mistral-7b": {
		maxTokens: 32000,
		contextWindow: 32000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.29,
		outputPrice: 0.29,
		description:
			"LLaVa combines a pre-trained large language model with a pre-trained vision encoder for multimodal (image + text) chatbot use cases.",
	},
	"gpt-oss-120b": {
		maxTokens: 131000,
		contextWindow: 131000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.08,
		outputPrice: 0.4,
		description:
			"gpt-oss-120b is a cutting-edge model designed for high-level reasoning, instruction-following, and advanced agent capabilities.",
		supportsReasoningEffort: true,
	},
	"Meta-Llama-3_3-70B-Instruct": {
		maxTokens: 131000,
		contextWindow: 131000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.67,
		outputPrice: 0.67,
		description:
			"Llama 3.3 is an instruction-tuned generative language model optimized for multilingual dialogue use cases. Released by Meta AI on December 6, 2024.",
	},
	"Qwen2.5-Coder-32B-Instruct": {
		maxTokens: 32000,
		contextWindow: 32000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.87,
		outputPrice: 0.87,
		description:
			"Qwen2.5-Coder is a powerful, instruction-tuned LLM specifically designed for coding tasks. With 32B parameters, it excels in code generation, code reasoning, and code fixing.",
	},
	"Mixtral-8x7B-Instruct-v0.1": {
		maxTokens: 32000,
		contextWindow: 32000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.63,
		outputPrice: 0.63,
		description:
			"The Mixtral-8x7B-Instruct-v0.1 model, developed by Mistral AI, is a Sparse Mixture of Experts model optimized for following instructions and generating creative text formats.",
	},
	"Meta-Llama-3_1-70B-Instruct": {
		maxTokens: 131000,
		contextWindow: 131000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.67,
		outputPrice: 0.67,
		description:
			"Llama 3.1 (70B parameters) is an auto-regressive language model using an optimized transformer architecture. Released by Meta AI on July 23, 2024.",
	},
	"Mistral-Small-3.2-24B-Instruct-2506": {
		maxTokens: 128000,
		contextWindow: 128000,
		supportsImages: true,
		supportsPromptCache: false,
		inputPrice: 0.09,
		outputPrice: 0.28,
		description:
			"Mistral Small 3.2 adds state-of-the-art vision understanding and enhances long context capabilities up to 128k tokens without compromising text performance.",
	},
	"DeepSeek-R1-Distill-Llama-70B": {
		maxTokens: 131000,
		contextWindow: 131000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.67,
		outputPrice: 0.67,
		description:
			"The DeepSeek-R1-Distill-Llama-70B model is trained via large-scale reinforcement learning. It's a distilled version of the Llama 3.3 70B model.",
		supportsReasoningEffort: true,
	},
	"Llama-3.1-8B-Instruct": {
		maxTokens: 131000,
		contextWindow: 131000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
		description:
			"Llama 3.1 (8B parameters) is an auto-regressive language model using an optimized transformer architecture. Released by Meta AI on July 23, 2024.",
	},
	"Mistral-7B-Instruct-v0.3": {
		maxTokens: 127000,
		contextWindow: 127000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.1,
		outputPrice: 0.1,
		description:
			"The Mistral-7B-Instruct-v0.3 model is a fine-tuned version of the Mistral 7B base model, optimized for instruction-following tasks.",
	},
	"gpt-oss-20b": {
		maxTokens: 131000,
		contextWindow: 131000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.04,
		outputPrice: 0.15,
		description:
			"gpt-oss-20b delivers strong performance with fast inference and efficient reasoning. Ideal for a wide range of tasks.",
		supportsReasoningEffort: true,
	},
	"Mistral-Nemo-Instruct-2407": {
		maxTokens: 118000,
		contextWindow: 118000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.13,
		outputPrice: 0.13,
		description:
			"The Mistral-Nemo-Instruct-2407 model is an instruction-tuned LLM designed for multilingual applications, excelling in conversational dialogue and code generation.",
	},
	"Qwen3-32B": {
		maxTokens: 32000,
		contextWindow: 32000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.08,
		outputPrice: 0.23,
		description:
			"Qwen3 is the latest generation of large language models offering groundbreaking advancements in reasoning, instruction-following, and agent capabilities.",
		supportsReasoningEffort: true,
	},
	"mamba-codestral-7B-v0.1": {
		maxTokens: 256000,
		contextWindow: 256000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0.19,
		outputPrice: 0.19,
		description:
			"The Mamba-Codestral-7B-v0.1 model is a fine-tuned version optimized for code generation tasks, designed to handle longer inputs efficiently.",
	},
} as const satisfies Record<string, ModelInfo>
