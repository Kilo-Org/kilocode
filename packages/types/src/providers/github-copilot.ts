// kilocode_change - new file
import type { ModelInfo } from "../model.js"

// GitHub Copilot available models
// These are the models available through GitHub Copilot subscription
// NOTE: Copilot is subscription-based - pricing fields are 0
export const githubCopilotModels = {
	"gpt-4o": {
		maxTokens: 16384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		description: "GPT-4o - Latest multimodal model",
	},
	"gpt-4o-mini": {
		maxTokens: 16384,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		description: "GPT-4o Mini - Fast and efficient",
	},
	"gpt-4.1": {
		maxTokens: 32768,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		description: "GPT-4.1 - Extended context",
	},
	"claude-sonnet-4.5": {
		maxTokens: 32768,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		description: "Claude Sonnet 4.5 via Copilot",
	},
	"claude-opus-4.5": {
		maxTokens: 32768,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		description: "Claude Opus 4.5 via Copilot",
	},
	"claude-haiku-4.5": {
		maxTokens: 32768,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: false,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		description: "Claude Haiku 4.5 via Copilot - Fast",
	},
} as const satisfies Record<string, ModelInfo>

export type GitHubCopilotModelId = keyof typeof githubCopilotModels
export const githubCopilotDefaultModelId: GitHubCopilotModelId = "claude-sonnet-4.5"
