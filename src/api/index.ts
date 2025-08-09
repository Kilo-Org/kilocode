import { Anthropic } from "@anthropic-ai/sdk"

import type { ProviderSettings, ModelInfo } from "@roo-code/types"

import { ApiStream } from "./transform/stream"

import {
	GlamaHandler,
	AnthropicHandler,
	AwsBedrockHandler,
	CerebrasHandler,
	OpenRouterHandler,
	VertexHandler,
	AnthropicVertexHandler,
	OpenAiHandler,
	// OllamaHandler, // kilocode_change
	LmStudioHandler,
	GeminiHandler,
	GeminiCliHandler, // kilocode_change
	OpenAiNativeHandler,
	DeepSeekHandler,
	MoonshotHandler,
	MistralHandler,
	VsCodeLmHandler,
	UnboundHandler,
	RequestyHandler,
	HumanRelayHandler,
	FakeAIHandler,
	XAIHandler,
	BigModelHandler, // kilocode_change
	GroqHandler,
	HuggingFaceHandler,
	ChutesHandler,
	LiteLLMHandler,
	VirtualQuotaFallbackHandler, // kilocode_change
	ClaudeCodeHandler,
	SambaNovaHandler,
	DoubaoHandler,
	ZAiHandler,
	FireworksHandler,
} from "./providers"
// kilocode_change start
import { KilocodeOpenrouterHandler } from "./providers/kilocode-openrouter"
import { KilocodeOllamaHandler } from "./providers/kilocode-ollama"
// kilocode_change end

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

export interface ApiHandlerCreateMessageMetadata {
	mode?: string
	taskId: string
}

export interface ApiHandler {
	createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream

	getModel(): { id: string; info: ModelInfo }

	/**
	 * Counts tokens for content blocks
	 * All providers extend BaseProvider which provides a default tiktoken implementation,
	 * but they can override this to use their native token counting endpoints
	 *
	 * @param content The content to count tokens for
	 * @returns A promise resolving to the token count
	 */
	countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number>
}

export function buildApiHandler(configuration: ProviderSettings): ApiHandler {
	const { apiProvider, ...options } = configuration

	switch (apiProvider) {
		case "kilocode":
			return new KilocodeOpenrouterHandler(options)
		case "anthropic":
			return new AnthropicHandler(options)
		case "claude-code":
			return new ClaudeCodeHandler(options)
		case "glama":
			return new GlamaHandler(options)
		case "openrouter":
			return new OpenRouterHandler(options)
		case "bedrock":
			return new AwsBedrockHandler(options)
		case "vertex":
			return options.apiModelId?.startsWith("claude")
				? new AnthropicVertexHandler(options)
				: new VertexHandler(options)
		case "openai":
			return new OpenAiHandler(options)
		case "ollama":
			return new KilocodeOllamaHandler(options)
		case "lmstudio":
			return new LmStudioHandler(options)
		case "gemini":
			return new GeminiHandler(options)
		// kilocode_change start
		case "gemini-cli":
			return new GeminiCliHandler(options)
		// kilocode_change end
		case "openai-native":
			return new OpenAiNativeHandler(options)
		case "deepseek":
			return new DeepSeekHandler(options)
		case "doubao":
			return new DoubaoHandler(options)
		case "moonshot":
			return new MoonshotHandler(options)
		case "vscode-lm":
			return new VsCodeLmHandler(options)
		case "mistral":
			return new MistralHandler(options)
		case "unbound":
			return new UnboundHandler(options)
		case "requesty":
			return new RequestyHandler(options)
		case "human-relay":
			return new HumanRelayHandler()
		// kilocode_change start
		case "virtual-quota-fallback":
			return new VirtualQuotaFallbackHandler(options)
		case "bigmodel":
			return new BigModelHandler(options)
		// kilocode_change end
		case "fake-ai":
			return new FakeAIHandler(options)
		case "xai":
			return new XAIHandler(options)
		case "groq":
			return new GroqHandler(options)
		case "huggingface":
			return new HuggingFaceHandler(options)
		case "chutes":
			return new ChutesHandler(options)
		case "litellm":
			return new LiteLLMHandler(options)
		case "cerebras":
			return new CerebrasHandler(options)
		case "sambanova":
			return new SambaNovaHandler(options)
		case "zai":
			return new ZAiHandler(options)
		case "fireworks":
			return new FireworksHandler(options)
		default:
			apiProvider satisfies "gemini-cli" | undefined
			return new AnthropicHandler(options)
	}
}
