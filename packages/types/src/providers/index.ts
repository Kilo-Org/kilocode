export * from "./anthropic.js"
export * from "./baseten.js"
export * from "./corethink.js"
export * from "./bedrock.js"
export * from "./cerebras.js"
export * from "./chutes.js"
export * from "./claude-code.js"
export * from "./deepseek.js"
export * from "./doubao.js"
export * from "./featherless.js"
export * from "./fireworks.js"
export * from "./gemini.js"
// kilocode_change start
export * from "./ovhcloud.js"
export * from "./synthetic.js"
export * from "./inception.js"
export * from "./minimax.js"
export * from "./glama.js"
export * from "./zenmux.js"
// kilocode_change end
export * from "./groq.js"
export * from "./huggingface.js"
export * from "./io-intelligence.js"
export * from "./lite-llm.js"
export * from "./lm-studio.js"
export * from "./mistral.js"
export * from "./moonshot.js"
export * from "./nano-gpt.js" // kilocode_change
export * from "./ollama.js"
export * from "./openai.js"
export * from "./openai-codex.js"
export * from "./openai-codex-rate-limits.js"
export * from "./openrouter.js"
export * from "./qwen-code.js"
export * from "./requesty.js"
export * from "./roo.js"
export * from "./sambanova.js"
export * from "./unbound.js"
export * from "./vertex.js"
export * from "./kilocode-vscode-llm.js"
export * from "./xai.js"
export * from "./vercel-ai-gateway.js"
export * from "./zai.js"
export * from "./deepinfra.js"
export * from "./minimax.js"

import { anthropicDefaultModelId } from "./anthropic.js"
import { basetenDefaultModelId } from "./baseten.js"
import { corethinkDefaultModelId } from "./corethink.js"
import { bedrockDefaultModelId } from "./bedrock.js"
import { cerebrasDefaultModelId } from "./cerebras.js"
import { chutesDefaultModelId } from "./chutes.js"
import { claudeCodeDefaultModelId } from "./claude-code.js"
import { deepSeekDefaultModelId } from "./deepseek.js"
import { doubaoDefaultModelId } from "./doubao.js"
import { featherlessDefaultModelId } from "./featherless.js"
import { fireworksDefaultModelId } from "./fireworks.js"
import { geminiDefaultModelId } from "./gemini.js"
import { glamaDefaultModelId } from "./glama.js" // kilocode_change
import { zenmuxDefaultModelId } from "./zenmux.js" // kilocode_change
import { groqDefaultModelId } from "./groq.js"
import { ioIntelligenceDefaultModelId } from "./io-intelligence.js"
import { litellmDefaultModelId } from "./lite-llm.js"
import { mistralDefaultModelId } from "./mistral.js"
import { moonshotDefaultModelId } from "./moonshot.js"
import { openAiCodexDefaultModelId } from "./openai-codex.js"
import { openRouterDefaultModelId } from "./openrouter.js"
import { qwenCodeDefaultModelId } from "./qwen-code.js"
import { requestyDefaultModelId } from "./requesty.js"
import { rooDefaultModelId } from "./roo.js"
import { sambaNovaDefaultModelId } from "./sambanova.js"
import { unboundDefaultModelId } from "./unbound.js"
import { vertexDefaultModelId } from "./vertex.js"
import { vscodeLlmDefaultModelId } from "./vscode-llm.js"
import { xaiDefaultModelId } from "./xai.js"
import { vercelAiGatewayDefaultModelId } from "./vercel-ai-gateway.js"
import { internationalZAiDefaultModelId, mainlandZAiDefaultModelId } from "./zai.js"
import { deepInfraDefaultModelId } from "./deepinfra.js"
import { minimaxDefaultModelId } from "./minimax.js"

// Import the ProviderName type from provider-settings to avoid duplication
import type { ProviderName } from "../provider-settings.js"

/**
 * Get the default model ID for a given provider.
 * This function returns only the provider's default model ID, without considering user configuration.
 * Used as a fallback when provider models are still loading.
 */
export function getProviderDefaultModelId(
	provider: ProviderName,
	options: { isChina?: boolean } = { isChina: false },
): string {
	switch (provider) {
		case "openrouter":
			return openRouterDefaultModelId
		case "zenmux": // kilocode_change
			return zenmuxDefaultModelId // kilocode_change
		case "requesty":
			return requestyDefaultModelId
		// kilocode_change start
		case "glama":
			return glamaDefaultModelId
		// kilocode_change end
		case "unbound":
			return unboundDefaultModelId
		case "litellm":
			return litellmDefaultModelId
		case "xai":
			return xaiDefaultModelId
		case "groq":
			return groqDefaultModelId
		case "huggingface":
			return "meta-llama/Llama-3.3-70B-Instruct"
		case "chutes":
			return chutesDefaultModelId
		case "baseten":
			return basetenDefaultModelId
		case "corethink":
			return corethinkDefaultModelId
		case "bedrock":
			return bedrockDefaultModelId
		case "vertex":
			return vertexDefaultModelId
		case "gemini":
			return geminiDefaultModelId
		case "deepseek":
			return deepSeekDefaultModelId
		case "doubao":
			return doubaoDefaultModelId
		case "moonshot":
			return moonshotDefaultModelId
		case "minimax":
			return minimaxDefaultModelId
		case "zai":
			return options?.isChina ? mainlandZAiDefaultModelId : internationalZAiDefaultModelId
		case "openai-native":
			return "gpt-4o" // Based on openai-native patterns
		case "openai-responses": // kilocode_change
			return "gpt-4o" // OpenAI-compatible Responses API // kilocode_change
		case "openai-codex":
			return openAiCodexDefaultModelId
		case "mistral":
			return mistralDefaultModelId
		case "openai":
			return "" // OpenAI provider uses custom model configuration
		case "ollama":
			return "" // Ollama uses dynamic model selection
		case "lmstudio":
			return "" // LMStudio uses dynamic model selection
		case "deepinfra":
			return deepInfraDefaultModelId
		case "vscode-lm":
			return vscodeLlmDefaultModelId
		case "claude-code":
			return claudeCodeDefaultModelId
		case "cerebras":
			return cerebrasDefaultModelId
		case "sambanova":
			return sambaNovaDefaultModelId
		case "fireworks":
			return fireworksDefaultModelId
		case "featherless":
			return featherlessDefaultModelId
		case "io-intelligence":
			return ioIntelligenceDefaultModelId
		case "roo":
			return rooDefaultModelId
		case "qwen-code":
			return qwenCodeDefaultModelId
		case "vercel-ai-gateway":
			return vercelAiGatewayDefaultModelId
		case "anthropic":
		case "human-relay":
		case "fake-ai":
		default:
			return anthropicDefaultModelId
	}
}
