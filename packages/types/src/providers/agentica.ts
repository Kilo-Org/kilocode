import type { ModelInfo } from "../model.js"

export type AgenticaModelId = keyof typeof agenticaModels

export const agenticaDefaultModelId: AgenticaModelId = "deca-coder-flash"

export const AGENTICA_DEFAULT_BASE_URL = "https://api.genlabs.dev/agentica/v1" as const

export const agenticaModels = {
	// Free Models
	"kimi-k2": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Moonshot AI Kimi K2 model",
		creditsMultiplier: 0, // Free model - 0x credits
		isFree: true,
	},
	"deca-2.5-pro-low": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "2.5 pro low",
		creditsMultiplier: 0, // Free model - 0x credits
		isFree: true,
	},
	"minimax-m2": {
		maxTokens: 32_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Minimax M2 model",
		creditsMultiplier: 0, // Free model - 0x credits
		isFree: true,
	},
	"deepseek-v3.1-terminus": {
		maxTokens: 64_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "DeepSeek V3.1 Terminus",
		creditsMultiplier: 0, // Free model - 0x credits
		isFree: true,
	},
	"qwen3-coder": {
		maxTokens: 32_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Qwen 3 Coder 480B",
		creditsMultiplier: 0, // Free model - 0x credits
		isFree: true,
	},
	"gpt-oss-120b": {
		maxTokens: 32_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "GPT OSS 120B",
		creditsMultiplier: 0, // Free model - 0x credits
		isFree: true,
	},
	"deca-coder-flash": {
		maxTokens: 64_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Deca Coder Flash (routes via classification)",
		creditsMultiplier: 0, // Free model - 0x credits
		isFree: true,
	},
	// Paid-Free Models (OpenRouter)
	"glm-4.6": {
		maxTokens: 32_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "GLM 4.6 (paid plans only, no credit cost)",
		requiresPaidPlan: true,
	},
	"kimi-k2-thinking": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: false,
		inputPrice: 0,
		outputPrice: 0,
		description: "Kimi K2 Thinking (paid plans only, no credit cost)",
		requiresPaidPlan: true,
	},
	// Premium Models (OpenRouter)
	"claude-4.5-sonnet": {
		maxTokens: 64_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.00,    // $3.00 per million tokens
		outputPrice: 15.00,  // $15.00 per million tokens
		description: "Claude 4.5 Sonnet",
	},
	"claude-4.5-opus": {
		maxTokens: 64_000,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 5.00,    // $5.00 per million tokens
		outputPrice: 25.00,  // $25.00 per million tokens
		description: "Claude 4.5 Opus",
	},
	"gpt-5.2": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 1.75,    // $1.75 per million tokens
		outputPrice: 14.00,  // $14.00 per million tokens
		description: "GPT-5.2",
	},
	"gpt-5.1-codex": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.25,    // $1.25 per million tokens
		outputPrice: 10.00,  // $10.00 per million tokens
		description: "GPT-5.1 Codex",
	},
	"gpt-5.1-codex-mini": {
		maxTokens: 64_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.25,    // $0.25 per million tokens
		outputPrice: 2.00,   // $2.00 per million tokens
		description: "GPT-5.1 Codex Mini",
	},
	"gemini-3-pro": {
		maxTokens: 64_000,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 2.00,    // $2.00 per million tokens
		outputPrice: 12.00,  // $12.00 per million tokens
		description: "Gemini 3 Pro",
	},
	"gemini-2.5-flash": {
		maxTokens: 128_000,
		contextWindow: 1_000_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.30,    // $0.30 per million tokens
		outputPrice: 2.50,   // $2.50 per million tokens
		description: "Gemini 2.5 Flash",
	},
	"grok-4": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 3.00,    // $3.00 per million tokens
		outputPrice: 15.00,  // $15.00 per million tokens
		description: "Grok 4",
	},
	"grok-4.1-fast": {
		maxTokens: 128_000,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.20,    // $0.20 per million tokens
		outputPrice: 0.50,   // $0.50 per million tokens
		description: "Grok 4.1 Fast",
	},
	"grok-code-fast-1": {
		maxTokens: 64_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.20,    // $0.20 per million tokens
		outputPrice: 1.50,   // $1.50 per million tokens
		description: "Grok Code Fast 1",
	},
	"deca-2.5-pro-high": {
		maxTokens: 128_000,
		contextWindow: 200_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 1.25,   // $1.25 per million tokens
		outputPrice: 4.00,  // $4.00 per million tokens
		description: "2.5 pro high",
	},
	"deca-2.5-mini": {
		maxTokens: 64_000,
		contextWindow: 128_000,
		supportsImages: false,
		supportsPromptCache: true,
		inputPrice: 0.50,   // $0.50 per million tokens
		outputPrice: 1.50,  // $1.50 per million tokens
		description: "2.5 mini premium model",
	},
	"gemini-3-flash": {
		maxTokens: 64_000,
		contextWindow: 128_000,
		supportsImages: true,
		supportsPromptCache: true,
		inputPrice: 0.50,    // $0.50 per million tokens
		outputPrice: 3.00,   // $3.00 per million tokens
		description: "Gemini 3 Flash",
	},
} as const satisfies Record<string, ModelInfo>
