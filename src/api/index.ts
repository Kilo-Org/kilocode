import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import type { ProviderSettings, ModelInfo, ToolProtocol } from "@roo-code/types"

import { ApiStream } from "./transform/stream"

import {
	GlamaHandler, // kilocode_change
	AnthropicHandler,
	AwsBedrockHandler,
	CerebrasHandler,
	OpenRouterHandler,
	VertexHandler,
	AnthropicVertexHandler,
	OpenAiHandler,
	OpenAiCodexHandler,
	LmStudioHandler,
	GeminiHandler,
	OpenAiNativeHandler,
	DeepSeekHandler,
	MoonshotHandler,
	NanoGptHandler, // kilocode_change
	MistralHandler,
	VsCodeLmHandler,
	UnboundHandler,
	RequestyHandler,
	HumanRelayHandler,
	FakeAIHandler,
	XAIHandler,
	GroqHandler,
	HuggingFaceHandler,
	ChutesHandler,
	LiteLLMHandler,
	// kilocode_change start
	VirtualQuotaFallbackHandler,
	SyntheticHandler,
	OVHcloudAIEndpointsHandler,
	SapAiCoreHandler,
	AihubmixHandler,
	// kilocode_change end
	ClaudeCodeHandler,
	QwenCodeHandler,
	SambaNovaHandler,
	IOIntelligenceHandler,
	DoubaoHandler,
	ZAiHandler,
	FireworksHandler,
	RooHandler,
	FeatherlessHandler,
	VercelAiGatewayHandler,
	DeepInfraHandler,
	MiniMaxHandler,
	BasetenHandler,
	OpenAiCompatibleResponsesHandler, // kilocode_change
} from "./providers"
// kilocode_change start
import { KilocodeOpenrouterHandler } from "./providers/kilocode-openrouter"
import { InceptionLabsHandler } from "./providers/inception"
import type { FimHandler } from "./providers/kilocode/FimHandler" // kilocode_change
export type { FimHandler } from "./providers/kilocode/FimHandler"
// kilocode_change end
import { NativeOllamaHandler } from "./providers/native-ollama"

export interface SingleCompletionHandler {
	completePrompt(prompt: string): Promise<string>
}

export interface ApiHandlerCreateMessageMetadata {
	/**
	 * Task ID used for tracking and provider-specific features:
	 * - DeepInfra: Used as prompt_cache_key for caching
	 * - Roo: Sent as X-Roo-Task-ID header
	 * - Requesty: Sent as trace_id
	 * - Unbound: Sent in unbound_metadata
	 */
	taskId: string
	/**
	 * Current mode slug for provider-specific tracking:
	 * - Requesty: Sent in extra metadata
	 * - Unbound: Sent in unbound_metadata
	 */
	mode?: string
	suppressPreviousResponseId?: boolean
	/**
	 * Controls whether the response should be stored for 30 days in OpenAI's Responses API.
	 * When true (default), responses are stored and can be referenced in future requests
	 * using the previous_response_id for efficient conversation continuity.
	 * Set to false to opt out of response storage for privacy or compliance reasons.
	 * @default true
	 */
	store?: boolean
	// kilocode_change start
	/**
	 * KiloCode-specific: The project ID for the current workspace (derived from git origin remote).
	 * Used by KiloCodeOpenrouterHandler for backend tracking. Ignored by other providers.
	 * @kilocode-only
	 */
	projectId?: string
	// kilocode_change end
	/**
	 * Optional array of tool definitions to pass to the model.
	 * For OpenAI-compatible providers, these are ChatCompletionTool definitions.
	 */
	tools?: OpenAI.Chat.ChatCompletionTool[]
	/**
	 * Controls which (if any) tool is called by the model.
	 * Can be "none", "auto", "required", or a specific tool choice.
	 */
	tool_choice?: OpenAI.Chat.ChatCompletionCreateParams["tool_choice"]
	/**
	 * The tool protocol being used (XML or Native).
	 * Used by providers to determine whether to include native tool definitions.
	 */
	toolProtocol?: ToolProtocol
	/**
	 * Controls whether the model can return multiple tool calls in a single response.
	 * When true, parallel tool calls are enabled (OpenAI's parallel_tool_calls=true).
	 * When false (default), only one tool call is returned per response.
	 * Only applies when toolProtocol is "native".
	 */
	parallelToolCalls?: boolean
	/**
	 * Optional array of tool names that the model is allowed to call.
	 * When provided, all tool definitions are passed to the model (so it can reference
	 * historical tool calls), but only the specified tools can actually be invoked.
	 * This is used when switching modes to prevent model errors from missing tool
	 * definitions while still restricting callable tools to the current mode's permissions.
	 * Only applies to providers that support function calling restrictions (e.g., Gemini).
	 */
	allowedFunctionNames?: string[]
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

	// kilocode_change start
	/**
	 * Returns a FimHandler if the provider supports FIM (Fill-In-the-Middle) completions,
	 * or undefined if FIM is not supported.
	 */
	fimSupport?: () => FimHandler | undefined
	// kilocode_change end

	contextWindow?: number // kilocode_change: Add contextWindow property for virtual quota fallback
}

export function buildApiHandler(configuration: ProviderSettings): ApiHandler {
	const { apiProvider, ...options } = configuration

	switch (apiProvider) {
		// kilocode_change start
		case "kilocode":
			return new KilocodeOpenrouterHandler(options)
		case "virtual-quota-fallback":
			return new VirtualQuotaFallbackHandler(options)
		// kilocode_change end
		case "anthropic":
			return new AnthropicHandler(options)
		case "claude-code":
			return new ClaudeCodeHandler(options)
		// kilocode_change start
		case "glama":
			return new GlamaHandler(options)
		// kilocode_change end
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
			return new NativeOllamaHandler(options)
		case "lmstudio":
			return new LmStudioHandler(options)
		case "gemini":
			return new GeminiHandler(options)
		case "openai-codex":
			return new OpenAiCodexHandler(options)
		case "openai-native":
			return new OpenAiNativeHandler(options)
		case "openai-responses": // kilocode_change
			return new OpenAiCompatibleResponsesHandler(options) // kilocode_change
		case "deepseek":
			return new DeepSeekHandler(options)
		case "doubao":
			return new DoubaoHandler(options)
		case "qwen-code":
			return new QwenCodeHandler(options)
		case "moonshot":
			return new MoonshotHandler(options)
		// kilocode_change start
		case "nano-gpt":
			return new NanoGptHandler(options)
		// kilocode_change end
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
		case "fake-ai":
			return new FakeAIHandler(options)
		case "xai":
			return new XAIHandler(options)
		case "groq":
			return new GroqHandler(options)
		case "deepinfra":
			return new DeepInfraHandler(options)
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
		// kilocode_change start
		case "synthetic":
			return new SyntheticHandler(options)
		case "inception":
			return new InceptionLabsHandler(options)
		case "ovhcloud":
			return new OVHcloudAIEndpointsHandler(options)
		case "sap-ai-core":
			return new SapAiCoreHandler(options)
		case "aihubmix":
			return new AihubmixHandler(options)
		// kilocode_change end
		case "io-intelligence":
			return new IOIntelligenceHandler(options)
		case "roo":
			// Never throw exceptions from provider constructors
			// The provider-proxy server will handle authentication and return appropriate error codes
			return new RooHandler(options)
		case "featherless":
			return new FeatherlessHandler(options)
		case "vercel-ai-gateway":
			return new VercelAiGatewayHandler(options)
		case "minimax":
			return new MiniMaxHandler(options)
		case "baseten":
			return new BasetenHandler(options)
		default:
			apiProvider satisfies undefined
			return new AnthropicHandler(options)
	}
}
