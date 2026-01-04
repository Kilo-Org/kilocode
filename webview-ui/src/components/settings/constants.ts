import {
	type ProviderName,
	type ModelInfo,
	anthropicModels,
	bedrockModels,
	cerebrasModels,
	claudeCodeModels,
	deepSeekModels,
	moonshotModels,
	// kilocode_change start
	// geminiModels,
	geminiCliModels,
	// kilocode_change end
	mistralModels,
	openAiNativeModels,
	qwenCodeModels,
	vertexModels,
	xaiModels,
	groqModels,
	sambaNovaModels,
	doubaoModels,
	internationalZAiModels,
	fireworksModels,
	rooModels,
	featherlessModels,
	minimaxModels,
	basetenModels,
} from "@roo-code/types"

export const MODELS_BY_PROVIDER: Partial<Record<ProviderName, Record<string, ModelInfo>>> = {
	anthropic: anthropicModels,
	"claude-code": claudeCodeModels,
	bedrock: bedrockModels,
	cerebras: cerebrasModels,
	deepseek: deepSeekModels,
	doubao: doubaoModels,
	moonshot: moonshotModels,
	// kilocode_change start
	// gemini: geminiModels,
	"gemini-cli": geminiCliModels,
	// kilocode_change end
	mistral: mistralModels,
	"openai-native": openAiNativeModels,
	"qwen-code": qwenCodeModels,
	vertex: vertexModels,
	xai: xaiModels,
	groq: groqModels,
	// chutes: chutesModels, // kilocode_change
	sambanova: sambaNovaModels,
	zai: internationalZAiModels,
	fireworks: fireworksModels,
	roo: rooModels,
	featherless: featherlessModels,
	minimax: minimaxModels,
	baseten: basetenModels,
}

export const PROVIDERS = [
	{ value: "openrouter", label: "OpenRouter" },
	{ value: "zenmux", label: "ZenMux" }, // kilocode_change
	{ value: "deepinfra", label: "DeepInfra" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "claude-code", label: "Claude Code" },
	{ value: "cerebras", label: "Cerebras" },
	{ value: "gemini", label: "Google Gemini" },
	{ value: "doubao", label: "Doubao" },
	// kilocode_change start
	{ value: "inception", label: "Inception" },
	{ value: "gemini-cli", label: "Gemini CLI" },
	{ value: "virtual-quota-fallback", label: "Virtual Quota Fallback" },
	{ value: "synthetic", label: "Synthetic" },
	{ value: "ovhcloud", label: "OVHcloud AI Endpoints" },
	{ value: "sap-ai-core", label: "SAP AI Core" },
	// kilocode_change end
	{ value: "deepseek", label: "DeepSeek" },
	{ value: "moonshot", label: "Moonshot" },
	{ value: "openai-native", label: "OpenAI" },
	{ value: "openai", label: "OpenAI Compatible" },
	{ value: "qwen-code", label: "Qwen Code" },
	{ value: "vertex", label: "GCP Vertex AI" },
	{ value: "bedrock", label: "Amazon Bedrock" },
	{ value: "glama", label: "Glama" }, // kilocode_change
	{ value: "nano-gpt", label: "Nano-GPT" }, //kilocode_change
	{ value: "vscode-lm", label: "VS Code LM API" },
	{ value: "mistral", label: "Mistral" },
	{ value: "lmstudio", label: "LM Studio" },
	{ value: "ollama", label: "Ollama" },
	{ value: "unbound", label: "Unbound" },
	{ value: "requesty", label: "Requesty" },
	{ value: "human-relay", label: "Human Relay" },
	{ value: "xai", label: "xAI (Grok)" },
	{ value: "groq", label: "Groq" },
	{ value: "huggingface", label: "Hugging Face" },
	{ value: "chutes", label: "Chutes AI" },
	{ value: "litellm", label: "LiteLLM" },
	{ value: "sambanova", label: "SambaNova" },
	{ value: "zai", label: "Z.ai" },
	{ value: "fireworks", label: "Fireworks AI" },
	{ value: "featherless", label: "Featherless AI" },
	{ value: "io-intelligence", label: "IO Intelligence" },
	// kilocode_change start
	// { value: "roo", label: "Roo Code Cloud" },
	// kilocode_change end
	{ value: "vercel-ai-gateway", label: "Vercel AI Gateway" },
	{ value: "minimax", label: "MiniMax" },
	{ value: "baseten", label: "Baseten" },
].sort((a, b) => a.label.localeCompare(b.label))

PROVIDERS.unshift({ value: "kilocode", label: "Kilo Gateway" }) // kilocode_change
