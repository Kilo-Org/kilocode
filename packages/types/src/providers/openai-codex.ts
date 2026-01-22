import type { ModelInfo } from "../model.js"

/**
 * OpenAI Codex Provider
 *
 * This provider uses OAuth authentication via ChatGPT Plus/Pro subscription
 * instead of direct API keys. Requests are routed to the Codex backend at
 * https://chatgpt.com/backend-api/codex/responses
 *
 * Key differences from openai-native:
 * - Uses OAuth Bearer tokens instead of API keys
 * - Subscription-based pricing (no per-token costs)
 * - Limited model subset available
 * - Custom routing to Codex backend
 */

export type OpenAiCodexModelId = keyof typeof openAiCodexModels

export const openAiCodexDefaultModelId: OpenAiCodexModelId = "gpt-5.2-codex"

/**
 * Models available through the Codex OAuth flow.
 * These models are accessible to ChatGPT Plus/Pro subscribers.
 * Costs are 0 as they are covered by the subscription.
 */
export const openAiCodexModels = {
	"gpt-5.1-codex-max": {
		maxTokens: 128000,
		contextWindow: 400000,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high", "xhigh"],
		reasoningEffort: "xhigh",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		description: "GPT-5.1 Codex Max: Maximum capability coding model via ChatGPT subscription",
	},
	"gpt-5.1-codex": {
		maxTokens: 128000,
		contextWindow: 400000,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		description: "GPT-5.1 Codex: GPT-5.1 optimized for agentic coding via ChatGPT subscription",
	},
	"gpt-5.2-codex": {
		maxTokens: 128000,
		contextWindow: 400000,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high", "xhigh"],
		reasoningEffort: "medium",
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		description: "GPT-5.2 Codex: OpenAI's flagship coding model via ChatGPT subscription",
	},
	"gpt-5.1": {
		maxTokens: 128000,
		contextWindow: 400000,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["none", "low", "medium", "high"],
		reasoningEffort: "medium",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsVerbosity: true,
		supportsTemperature: false,
		description: "GPT-5.1: General GPT-5.1 model via ChatGPT subscription",
	},
	"gpt-5": {
		maxTokens: 128000,
		contextWindow: 400000,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["minimal", "low", "medium", "high"],
		reasoningEffort: "medium",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsVerbosity: true,
		supportsTemperature: false,
		description: "GPT-5: General GPT-5 model via ChatGPT subscription",
	},
	"gpt-5-codex": {
		maxTokens: 128000,
		contextWindow: 400000,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		description: "GPT-5 Codex: GPT-5 optimized for agentic coding via ChatGPT subscription",
	},
	"gpt-5-codex-mini": {
		maxTokens: 128000,
		contextWindow: 400000,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		// Subscription-based: no per-token costs
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		description: "GPT-5 Codex Mini: Faster coding model via ChatGPT subscription",
	},
	"gpt-5.1-codex-mini": {
		maxTokens: 128000,
		contextWindow: 400000,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["low", "medium", "high"],
		reasoningEffort: "medium",
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		description: "GPT-5.1 Codex Mini: Faster version for coding tasks via ChatGPT subscription",
	},
	"gpt-5.2": {
		maxTokens: 128000,
		contextWindow: 400000,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		includedTools: ["apply_patch"],
		excludedTools: ["apply_diff", "write_to_file"],
		supportsImages: true,
		supportsPromptCache: true,
		supportsReasoningEffort: ["none", "low", "medium", "high", "xhigh"],
		reasoningEffort: "medium",
		inputPrice: 0,
		outputPrice: 0,
		supportsTemperature: false,
		description: "GPT-5.2: Latest GPT model via ChatGPT subscription",
	},
} as const satisfies Record<string, ModelInfo>
