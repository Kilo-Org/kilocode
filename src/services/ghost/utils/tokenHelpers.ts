/**
 * Advanced tokenizer utilities for dynamic context expansion.
 * Uses tiktoken for accurate token counting with fallback to heuristic.
 */

import { Tiktoken } from "tiktoken/lite"
import o200kBase from "tiktoken/encoders/o200k_base"

// Cached encoder instance to avoid repeated initialization
let encoder: Tiktoken | null = null

/**
 * Get or create the tiktoken encoder instance.
 * Uses o200k_base encoding which is compatible with GPT-4o and similar models.
 */
function getEncoder(): Tiktoken {
	if (!encoder) {
		encoder = new Tiktoken(o200kBase.bpe_ranks, o200kBase.special_tokens, o200kBase.pat_str)
	}
	return encoder
}

/**
 * Count tokens using tiktoken for accurate tokenization.
 * Falls back to heuristic only if tiktoken fails.
 */
export function countTokens(text: string, modelName?: string): number {
	if (!text || text.length === 0) {
		return 0
	}

	try {
		const enc = getEncoder()
		const tokens = enc.encode(text, undefined, [])
		return tokens.length
	} catch (error) {
		// Fallback to heuristic if tiktoken fails
		console.warn("tiktoken encoding failed, using heuristic fallback:", error)
		return countTokensHeuristic(text, modelName)
	}
}

/**
 * Heuristic-based token counting fallback.
 * Only used when tiktoken fails or is unavailable.
 */
function countTokensHeuristic(text: string, modelName?: string): number {
	const charsPerToken = getCharsPerToken(modelName)
	return Math.ceil(text.length / charsPerToken)
}

/**
 * Get estimated characters per token for different model families.
 * Used only as fallback when tiktoken is unavailable.
 */
function getCharsPerToken(modelName?: string): number {
	if (!modelName) return 4 // Default fallback

	const modelLower = modelName.toLowerCase()

	// Mercury models tend to be more efficient
	if (modelLower.includes("mercury")) {
		return 3.5
	}

	// GPT models
	if (modelLower.includes("gpt")) {
		return 4
	}

	// Claude models
	if (modelLower.includes("claude")) {
		return 3.8
	}

	// Codestral and other code models
	if (modelLower.includes("codestral") || modelLower.includes("code")) {
		return 3.8
	}

	return 4 // Default fallback
}

/**
 * Prune lines from the top of text to fit within token budget.
 * Based on Continue's pruneLinesFromTop with dynamic token counting.
 */
export function pruneLinesFromTop(text: string, maxTokens: number, modelName?: string): string {
	const lines = text.split("\n")
	// Preprocess tokens for all lines and cache them
	const lineTokens = lines.map((line) => countTokens(line, modelName))
	let totalTokens = lineTokens.reduce((sum, tokens) => sum + tokens, 0)
	let start = 0
	const currentLines = lines.length

	// Calculate initial token count including newlines
	totalTokens += Math.max(0, currentLines - 1) // Add tokens for joining newlines

	// Remove lines from the top until the token count is within the limit
	while (totalTokens > maxTokens && start < currentLines) {
		totalTokens -= lineTokens[start]
		// Decrement token count for the removed line and its preceding/joining newline
		if (currentLines - start > 1) {
			totalTokens--
		}
		start++
	}

	return lines.slice(start).join("\n")
}

/**
 * Prune lines from the bottom of text to fit within token budget.
 * Based on Continue's pruneLinesFromBottom with dynamic token counting.
 */
export function pruneLinesFromBottom(text: string, maxTokens: number, modelName?: string): string {
	const lines = text.split("\n")
	const lineTokens = lines.map((line) => countTokens(line, modelName))
	let totalTokens = lineTokens.reduce((sum, tokens) => sum + tokens, 0)
	let end = lines.length

	// Calculate initial token count including newlines
	totalTokens += Math.max(0, end - 1) // Add tokens for joining newlines

	// Remove lines from the bottom until the token count is within the limit
	while (totalTokens > maxTokens && end > 0) {
		end--
		totalTokens -= lineTokens[end]
		// Decrement token count for the removed line and its following/joining newline
		if (end > 0) {
			totalTokens--
		}
	}

	return lines.slice(0, end).join("\n")
}

/**
 * Context expansion options based on Continue's approach
 */
export interface ContextExpansionOptions {
	maxPromptTokens: number
	prefixPercentage: number // e.g., 0.85 for 85% of tokens for prefix
	maxSuffixPercentage: number // e.g., 0.15 for max 15% for suffix
	modelName?: string
}

/**
 * Get pruned prefix and suffix with dynamic token allocation.
 * Based on Continue's sophisticated budget management.
 */
export function getPrunedPrefixSuffix(
	fullPrefix: string,
	fullSuffix: string,
	options: ContextExpansionOptions,
): { prunedPrefix: string; prunedSuffix: string; prunedCaretWindow: string } {
	const { maxPromptTokens, prefixPercentage, maxSuffixPercentage, modelName } = options

	// Calculate prefix budget
	const maxPrefixTokens = maxPromptTokens * prefixPercentage
	const prunedPrefix = pruneLinesFromTop(fullPrefix, maxPrefixTokens, modelName)

	// Calculate suffix budget based on remaining tokens
	const prefixTokens = countTokens(prunedPrefix, modelName)
	const remainingTokens = maxPromptTokens - prefixTokens
	const maxSuffixTokens = Math.min(remainingTokens, maxSuffixPercentage * maxPromptTokens)
	const prunedSuffix = pruneLinesFromBottom(fullSuffix, maxSuffixTokens, modelName)

	return {
		prunedPrefix,
		prunedSuffix,
		prunedCaretWindow: prunedPrefix + prunedSuffix,
	}
}

/**
 * Calculate optimal editable region based on token limits.
 * Dynamically expands context within budget constraints.
 */
export function calculateOptimalEditableRegion(
	fileContent: string,
	cursorOffset: number,
	options: ContextExpansionOptions,
): {
	prefix: string
	suffix: string
	prunedPrefix: string
	prunedSuffix: string
	startLine: number
	endLine: number
} {
	// Split content at cursor
	const fullPrefix = fileContent.slice(0, cursorOffset)
	const fullSuffix = fileContent.slice(cursorOffset)

	// Get pruned content using token-aware allocation
	const { prunedPrefix, prunedSuffix } = getPrunedPrefixSuffix(fullPrefix, fullSuffix, options)

	// Calculate line boundaries for the editable region
	const lines = fileContent.split("\n")
	const cursorLine = fullPrefix.split("\n").length - 1

	// Find how many lines the pruned prefix covers
	const prunedPrefixLines = prunedPrefix.split("\n").length
	const startLine = Math.max(0, cursorLine - prunedPrefixLines + 1)

	// Find how many lines the pruned suffix covers
	const prunedSuffixLines = prunedSuffix.split("\n").length
	const endLine = Math.min(lines.length - 1, cursorLine + prunedSuffixLines - 1)

	return {
		prefix: fullPrefix,
		suffix: fullSuffix,
		prunedPrefix,
		prunedSuffix,
		startLine,
		endLine,
	}
}
