import type { ModelInfo } from "../model.js"

// Base model info for Claude Code models (subscription-based, no per-token cost)
// NOTE: We intentionally do NOT set supportsNativeTools or defaultToolProtocol here.
// Claude Code CLI with --disallowedTools prevents native tool_use blocks,
// so kilocode must use XML tool format for Claude Code provider.
const claudeCodeModelBase = {
	maxTokens: 32768,
	contextWindow: 200_000,
	supportsImages: false, // Claude Code CLI doesn't support images
	supportsPromptCache: false,
}

// Models that work with Claude Code CLI
// Using the same model IDs as Cline for compatibility
// See: https://github.com/cline/cline
export const claudeCodeModels = {
	// Short aliases (recommended)
	sonnet: {
		...claudeCodeModelBase,
		description: "Claude Sonnet 4.5 - Balanced performance",
	},
	opus: {
		...claudeCodeModelBase,
		description: "Claude Opus 4.5 - Most capable",
	},
	haiku: {
		...claudeCodeModelBase,
		description: "Claude Haiku 4.5 - Fast and efficient",
	},
	// Intermediate model IDs (without dates) - for backward compatibility
	"claude-sonnet-4-5": {
		...claudeCodeModelBase,
		description: "Claude Sonnet 4.5 - Balanced performance",
	},
	"claude-opus-4-5": {
		...claudeCodeModelBase,
		description: "Claude Opus 4.5 - Most capable",
	},
	"claude-haiku-4-5": {
		...claudeCodeModelBase,
		description: "Claude Haiku 4.5 - Fast and efficient",
	},
	"claude-sonnet-4": {
		...claudeCodeModelBase,
		description: "Claude Sonnet 4 - Previous generation",
	},
	"claude-opus-4": {
		...claudeCodeModelBase,
		description: "Claude Opus 4 - Previous generation",
	},
	"claude-opus-4-1": {
		...claudeCodeModelBase,
		description: "Claude Opus 4.1 - Previous generation",
	},
	// Full model IDs with dates (also supported)
	"claude-haiku-4-5-20251001": {
		...claudeCodeModelBase,
		description: "Claude Haiku 4.5 - Fast and efficient",
	},
	"claude-sonnet-4-5-20250929": {
		...claudeCodeModelBase,
		description: "Claude Sonnet 4.5 - Balanced performance",
	},
	"claude-sonnet-4-20250514": {
		...claudeCodeModelBase,
		description: "Claude Sonnet 4 - Previous generation",
	},
	"claude-opus-4-5-20251101": {
		...claudeCodeModelBase,
		description: "Claude Opus 4.5 - Most capable",
	},
	"claude-opus-4-20250514": {
		...claudeCodeModelBase,
		description: "Claude Opus 4 - Previous generation",
	},
	"claude-opus-4-1-20250805": {
		...claudeCodeModelBase,
		description: "Claude Opus 4.1 - Previous generation",
	},
	"claude-3-7-sonnet-20250219": {
		...claudeCodeModelBase,
		description: "Claude 3.7 Sonnet - Legacy",
	},
	"claude-3-5-haiku-20241022": {
		...claudeCodeModelBase,
		supportsImages: true,
		description: "Claude 3.5 Haiku - Legacy",
	},
} as const satisfies Record<string, ModelInfo>

// Claude Code - Only models that work with Claude Code CLI
export type ClaudeCodeModelId = keyof typeof claudeCodeModels
export const claudeCodeDefaultModelId: ClaudeCodeModelId = "sonnet"

/**
 * Reasoning effort configuration for Claude Code thinking mode.
 * Maps reasoning effort level to budget_tokens for the thinking process.
 *
 * Note: With interleaved thinking (enabled via beta header), budget_tokens
 * can exceed max_tokens as the token limit becomes the entire context window.
 * The max_tokens is drawn from the model's maxTokens definition.
 *
 * @see https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#interleaved-thinking
 */
export const claudeCodeReasoningConfig = {
	low: { budgetTokens: 16_000 },
	medium: { budgetTokens: 32_000 },
	high: { budgetTokens: 64_000 },
} as const

export type ClaudeCodeReasoningLevel = keyof typeof claudeCodeReasoningConfig
