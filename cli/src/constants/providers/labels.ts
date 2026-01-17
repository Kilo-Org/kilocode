import type { ProviderName } from "../../types/messages.js"

/**
 * Provider display labels mapping
 * Maps provider internal names to user-friendly display names
 */
export const PROVIDER_LABELS: Record<ProviderName, string> = {
	kilocode: "Kilo Code",
	anthropic: "Anthropic",
	"openai-native": "OpenAI",
	openrouter: "OpenRouter",
	bedrock: "Amazon Bedrock",
	gemini: "Google Gemini",
	vertex: "GCP Vertex AI",
	"claude-code": "Claude Code",
	mistral: "Mistral",
	groq: "Groq",
	deepseek: "DeepSeek",
	xai: "xAI (Grok)",
	cerebras: "Cerebras",
	ollama: "Ollama",
	lmstudio: "LM Studio",
	"vscode-lm": "VS Code LM API",
	openai: "OpenAI Compatible",
	glama: "Glama",
	"nano-gpt": "Nano-GPT",
	huggingface: "Hugging Face",
	litellm: "LiteLLM",
	moonshot: "Moonshot",
	doubao: "Doubao",
	chutes: "Chutes AI",
	sambanova: "SambaNova",
	fireworks: "Fireworks",
	featherless: "Featherless",
	deepinfra: "DeepInfra",
	"io-intelligence": "IO Intelligence",
	"qwen-code": "Qwen Code",
	"gemini-cli": "Gemini CLI",
	zai: "Zai",
	minimax: "MiniMax",
	unbound: "Unbound",
	requesty: "Requesty",
	roo: "Roo",
	"vercel-ai-gateway": "Vercel AI Gateway",
	"virtual-quota-fallback": "Virtual Quota Fallback",
	"human-relay": "Human Relay",
	"fake-ai": "Fake AI",
	ovhcloud: "OVHcloud AI Endpoints",
	inception: "Inception",
	synthetic: "Synthetic",
	"sap-ai-core": "SAP AI Core",
	baseten: "BaseTen",
	corethink: "Corethink"
}

/**
 * Provider list with value and label pairs
 * Used for selection components and dropdowns
 */
export const PROVIDER_OPTIONS: Array<{ value: ProviderName; label: string }> = Object.entries(PROVIDER_LABELS).map(
	([value, label]) => ({ value: value as ProviderName, label }),
)

/**
 * Get provider display label by provider name
 * @param provider - Provider name or undefined
 * @returns User-friendly display name
 */
export const getProviderLabel = (provider: ProviderName | undefined): string => {
	return provider ? PROVIDER_LABELS[provider] || provider : "No provider selected"
}
