import type { ModelInfo } from "../model.js"

/**
 * Rate limit information from Claude Code API
 */
export interface ClaudeCodeRateLimitInfo {
	// 5-hour limit info
	fiveHour: {
		status: string
		utilization: number
		resetTime: number // Unix timestamp
	}
	// 7-day (weekly) limit info (Sonnet-specific)
	weekly?: {
		status: string
		utilization: number
		resetTime: number // Unix timestamp
	}
	// 7-day unified limit info
	weeklyUnified?: {
		status: string
		utilization: number
		resetTime: number // Unix timestamp
	}
	// Representative claim type
	representativeClaim?: string
	// Overage status
	overage?: {
		status: string
		disabledReason?: string
	}
	// Fallback percentage
	fallbackPercentage?: number
	// Organization ID
	organizationId?: string
	// Timestamp when this was fetched
	fetchedAt: number
}

// Regex pattern to strip date suffix from model names
const DATE_SUFFIX_PATTERN = /-\d{8}$/

// Models that work with Claude Code OAuth tokens
// See: https://docs.anthropic.com/en/docs/claude-code
// NOTE: Claude Code is subscription-based with no per-token cost - pricing fields are 0
export const claudeCodeModels = {
	"claude-haiku-4-5": {
		maxTokens: 32768,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		supportsReasoningEffort: ["disable", "low", "medium", "high"],
		reasoningEffort: "medium",
		description: "Claude Haiku 4.5 - Fast and efficient with thinking",
	},
	"claude-sonnet-4-5": {
		maxTokens: 32768,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		supportsReasoningEffort: ["disable", "low", "medium", "high"],
		reasoningEffort: "medium",
		description: "Claude Sonnet 4.5 - Balanced performance with thinking",
	},
	"claude-opus-4-5": {
		maxTokens: 32768,
		contextWindow: 200_000,
		supportsImages: true,
		supportsPromptCache: true,
		supportsNativeTools: true,
		defaultToolProtocol: "native",
		supportsReasoningEffort: ["disable", "low", "medium", "high"],
		reasoningEffort: "medium",
		description: "Claude Opus 4.5 - Most capable with thinking",
	},
} as const satisfies Record<string, ModelInfo>

// Claude Code - Only models that work with Claude Code OAuth tokens
export type ClaudeCodeModelId = keyof typeof claudeCodeModels
export const claudeCodeDefaultModelId: ClaudeCodeModelId = "claude-sonnet-4-5"

/**
 * Model family patterns for normalization.
 * Maps regex patterns to their canonical Claude Code model IDs.
 *
 * Order matters - more specific patterns should come first.
 */
const MODEL_FAMILY_PATTERNS: Array<{ pattern: RegExp; target: ClaudeCodeModelId }> = [
	// Opus models (any version) → claude-opus-4-5
	{ pattern: /opus/i, target: "claude-opus-4-5" },
	// Haiku models (any version) → claude-haiku-4-5
	{ pattern: /haiku/i, target: "claude-haiku-4-5" },
	// Sonnet models (any version) → claude-sonnet-4-5
	{ pattern: /sonnet/i, target: "claude-sonnet-4-5" },
]

/**
 * Normalizes a Claude model ID to a valid Claude Code model ID.
 *
 * This function handles backward compatibility for legacy model names
 * that may include version numbers or date suffixes. It maps:
 * - claude-sonnet-4-5-20250929, claude-sonnet-4-20250514, claude-3-7-sonnet-20250219, claude-3-5-sonnet-20241022 → claude-sonnet-4-5
 * - claude-opus-4-5-20251101, claude-opus-4-1-20250805, claude-opus-4-20250514 → claude-opus-4-5
 * - claude-haiku-4-5-20251001, claude-3-5-haiku-20241022 → claude-haiku-4-5
 *
 * @param modelId - The model ID to normalize (may be a legacy format)
 * @returns A valid ClaudeCodeModelId, or the original ID if already valid
 *
 * @example
 * normalizeClaudeCodeModelId("claude-sonnet-4-5") // returns "claude-sonnet-4-5"
 * normalizeClaudeCodeModelId("claude-3-5-sonnet-20241022") // returns "claude-sonnet-4-5"
 * normalizeClaudeCodeModelId("claude-opus-4-1-20250805") // returns "claude-opus-4-5"
 */
export function normalizeClaudeCodeModelId(modelId: string): ClaudeCodeModelId {
	// If already a valid model ID, return as-is
	// Use Object.hasOwn() instead of 'in' operator to avoid matching inherited properties like 'toString'
	if (Object.hasOwn(claudeCodeModels, modelId)) {
		return modelId as ClaudeCodeModelId
	}

	// Strip date suffix if present (e.g., -20250514)
	const withoutDate = modelId.replace(DATE_SUFFIX_PATTERN, "")

	// Check if stripping the date makes it valid
	if (Object.hasOwn(claudeCodeModels, withoutDate)) {
		return withoutDate as ClaudeCodeModelId
	}

	// Match by model family
	for (const { pattern, target } of MODEL_FAMILY_PATTERNS) {
		if (pattern.test(modelId)) {
			return target
		}
	}

	// Fallback to default if no match (shouldn't happen with valid Claude models)
	return claudeCodeDefaultModelId
}

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
