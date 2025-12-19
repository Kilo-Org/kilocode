import type { ModelParameter } from "@roo-code/types"

export type KiloCodeModel = {
	id: string
	name: string
	description: string
	input_modalities: string[]
	context_length: number
	max_output_length: number
	output_modalities: string[]
	supported_sampling_parameters: string[]
	supported_features: string[]
	openrouter: {
		slug: string
	}
	datacenters: Array<{ country_code: string }>
	created: number
	owned_by: string
	pricing: {
		prompt?: string
		completion?: string
		image?: string
		request?: string
		input_cache_reads?: string
		input_cache_writes?: string
	}
}

export const KILO_CODE_MODELS: Record<string, KiloCodeModel> = {
	"axon-code": {
		id: "axon-code",
		name: "Axon Code",
		description: "Axon Code is super intelligent LLM model for coding tasks",
		input_modalities: ["text"],
		context_length: 256000,
		max_output_length: 32768,
		output_modalities: ["text"],
		supported_sampling_parameters: [
			"temperature",
			"top_p",
			"top_k",
			"repetition_penalty",
			"frequency_penalty",
			"presence_penalty",
			"seed",
			"stop",
		],
		supported_features: ["tools", "structured_outputs", "web_search"],
		openrouter: {
			slug: "matterai/axon",
		},
		datacenters: [{ country_code: "US" }],
		created: 1750426201,
		owned_by: "matterai",
		pricing: {
			prompt: "0.000001",
			completion: "0.000004",
			image: "0",
			request: "0",
			input_cache_reads: "0",
			input_cache_writes: "0",
		},
	},
	"axon-mini": {
		id: "axon-mini",
		name: "Axon Mini",
		description:
			"Axon Mini is an general purpose super intelligent LLM coding model for low-effort day-to-day tasks",
		input_modalities: ["text"],
		context_length: 256000,
		max_output_length: 16384,
		output_modalities: ["text"],
		supported_sampling_parameters: [
			"temperature",
			"top_p",
			"top_k",
			"repetition_penalty",
			"frequency_penalty",
			"presence_penalty",
			"seed",
			"stop",
		],
		supported_features: ["tools", "structured_outputs", "web_search"],
		openrouter: {
			slug: "matterai/axon",
		},
		datacenters: [{ country_code: "US" }],
		created: 1750426201,
		owned_by: "matterai",
		pricing: {
			prompt: "2.5e-7",
			completion: "0.000001",
			image: "0",
			request: "0",
			input_cache_reads: "0",
			input_cache_writes: "0",
		},
	},
	// "axon-code-exp": {
	// 	id: "axon-code-exp",
	// 	name: "Axon Code Exp",
	// 	description: "Axon Code is super intelligent LLM model for coding tasks",
	// 	input_modalities: ["text"],
	// 	context_length: 256000,
	// 	max_output_length: 32768,
	// 	output_modalities: ["text"],
	// 	supported_sampling_parameters: [
	// 		"temperature",
	// 		"top_p",
	// 		"top_k",
	// 		"repetition_penalty",
	// 		"frequency_penalty",
	// 		"presence_penalty",
	// 		"seed",
	// 		"stop",
	// 	],
	// 	supported_features: ["tools", "structured_outputs", "web_search"],
	// 	openrouter: {
	// 		slug: "matterai/axon",
	// 	},
	// 	datacenters: [{ country_code: "US" }],
	// 	created: 1750426201,
	// 	owned_by: "matterai",
	// 	pricing: {
	// 		prompt: "0.000001",
	// 		completion: "0.000004",
	// 		image: "0",
	// 		request: "0",
	// 		input_cache_reads: "0",
	// 		input_cache_writes: "0",
	// 	},
	// },
	// "gemini-3-flash-preview": {
	// 	id: "gemini-3-flash-preview",
	// 	name: "Gemini 3 Flash Preview",
	// 	description:
	// 		"Gemini 3 Flash Preview model is built for speed, combining frontier intelligence with superior search and grounding.",
	// 	input_modalities: ["text"],
	// 	context_length: 256000,
	// 	max_output_length: 32768,
	// 	output_modalities: ["text"],
	// 	supported_sampling_parameters: [
	// 		"temperature",
	// 		"top_p",
	// 		"top_k",
	// 		"repetition_penalty",
	// 		"frequency_penalty",
	// 		"presence_penalty",
	// 		"seed",
	// 		"stop",
	// 	],
	// 	supported_features: ["tools", "structured_outputs", "web_search"],
	// 	openrouter: {
	// 		slug: "google/gemini-3-flash-preview",
	// 	},
	// 	datacenters: [{ country_code: "US" }],
	// 	created: 1750426201,
	// 	owned_by: "google",
	// 	pricing: {
	// 		prompt: "0.000001",
	// 		completion: "0.000004",
	// 		image: "0",
	// 		request: "0",
	// 		input_cache_reads: "0",
	// 		input_cache_writes: "0",
	// 	},
	// },
	// "gemini-3-pro-preview": {
	// 	id: "gemini-3-pro-preview",
	// 	name: "Gemini 3 Pro Preview",
	// 	description: "Gemini 3 Pro Preview model is an agentic and vibe-coding model by Google",
	// 	input_modalities: ["text"],
	// 	context_length: 256000,
	// 	max_output_length: 32768,
	// 	output_modalities: ["text"],
	// 	supported_sampling_parameters: [
	// 		"temperature",
	// 		"top_p",
	// 		"top_k",
	// 		"repetition_penalty",
	// 		"frequency_penalty",
	// 		"presence_penalty",
	// 		"seed",
	// 		"stop",
	// 	],
	// 	supported_features: ["tools", "structured_outputs", "web_search"],
	// 	openrouter: {
	// 		slug: "google/gemini-3-pro-preview",
	// 	},
	// 	datacenters: [{ country_code: "US" }],
	// 	created: 1750426201,
	// 	owned_by: "google",
	// 	pricing: {
	// 		prompt: "0.000001",
	// 		completion: "0.000004",
	// 		image: "0",
	// 		request: "0",
	// 		input_cache_reads: "0",
	// 		input_cache_writes: "0",
	// 	},
	// },
}
