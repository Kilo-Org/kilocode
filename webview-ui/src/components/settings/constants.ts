import {
	type ProviderName,
	type ModelInfo,
	anthropicModels,
	bedrockModels,
	deepSeekModels,
	geminiModels,
	mistralModels,
	openAiNativeModels,
	vertexModels,
	xaiModels,
	groqModels,
	chutesModels,
} from "@roo-code/types"

import { fireworksModels, cerebrasModels } from "@roo/api" // kilocode_change

export const MODELS_BY_PROVIDER: Partial<Record<ProviderName, Record<string, ModelInfo>>> = {
	anthropic: anthropicModels,
	bedrock: bedrockModels,
	deepseek: deepSeekModels,
	gemini: geminiModels,
	fireworks: fireworksModels, // kilocode_change
	mistral: mistralModels,
	"openai-native": openAiNativeModels,
	vertex: vertexModels,
	xai: xaiModels,
	groq: groqModels,
	chutes: chutesModels,
	cerebras: cerebrasModels, // kilocode_change
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
	{ value: "xai", label: "xAI (Grok)" },
	{ value: "groq", label: "Groq" },
	{ value: "chutes", label: "Chutes AI" },
	{ value: "cerebras", label: "Cerebras" }, // kilocode_change
	{ value: "litellm", label: "LiteLLM" },
] // .sort((a, b) => a.label.localeCompare(b.label)) // kilocode_change: Sort providers with kilocode first
