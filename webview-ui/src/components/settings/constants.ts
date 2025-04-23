import {
	ApiProvider,
	ModelInfo,
	anthropicModels,
	bedrockModels,
	deepSeekModels,
	geminiModels,
	fireworksModels, // kilocode_change
	mistralModels,
	openAiNativeModels,
	vertexModels,
	xaiModels,
	REASONING_MODELS,
} from "../../../../src/shared/api"

export { REASONING_MODELS }

export const MODELS_BY_PROVIDER: Partial<Record<ApiProvider, Record<string, ModelInfo>>> = {
	anthropic: anthropicModels,
	bedrock: bedrockModels,
	deepseek: deepSeekModels,
	gemini: geminiModels,
	fireworks: fireworksModels, // kilocode_change
	mistral: mistralModels,
	"openai-native": openAiNativeModels,
	vertex: vertexModels,
	xai: xaiModels,
}

export const PROVIDERS = [
	{ value: "kilocode", label: "Kilo Code" },
	{ value: "openrouter", label: "OpenRouter" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "fireworks", label: "Fireworks" }, // kilocode_change
	{ value: "gemini", label: "Google Gemini" },
	{ value: "deepseek", label: "DeepSeek" },
	{ value: "openai-native", label: "OpenAI" },
	{ value: "openai", label: "OpenAI Compatible" },
	{ value: "vertex", label: "GCP Vertex AI" },
	{ value: "bedrock", label: "Amazon Bedrock" },
	{ value: "glama", label: "Glama" },
	{ value: "vscode-lm", label: "VS Code LM API" },
	{ value: "mistral", label: "Mistral" },
	{ value: "lmstudio", label: "LM Studio" },
	{ value: "ollama", label: "Ollama" },
	{ value: "unbound", label: "Unbound" },
	{ value: "requesty", label: "Requesty" },
	{ value: "human-relay", label: "Human Relay" },
	{ value: "xai", label: "xAI" },
]

export const VERTEX_REGIONS = [
	{ value: "us-east5", label: "us-east5" },
	{ value: "us-central1", label: "us-central1" },
	{ value: "europe-west1", label: "europe-west1" },
	{ value: "europe-west4", label: "europe-west4" },
	{ value: "asia-southeast1", label: "asia-southeast1" },
]
