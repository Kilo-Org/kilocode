import { Anthropic } from "@anthropic-ai/sdk"
import crypto from "crypto"

import { TelemetryService } from "@roo-code/telemetry"

import { ApiHandler } from "../../api"
import { MAX_CONDENSE_THRESHOLD, MIN_CONDENSE_THRESHOLD, summarizeConversation, SummarizeResponse } from "../condense"
import { ApiMessage } from "../task-persistence/apiMessages"
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from "@roo-code/types"

/**
 * Context Management
 *
 * This module provides Context Management for conversations, combining:
 * - Intelligent condensation of prior messages when approaching configured thresholds
 * - Sliding window truncation as a fallback when necessary
 *
 * Behavior and exports are preserved exactly from the previous sliding-window implementation.
 */

/**
 * Default percentage of the context window to use as a buffer when deciding when to truncate.
 * Used by Context Management to determine when to trigger condensation or (fallback) sliding window truncation.
 */
export const TOKEN_BUFFER_PERCENTAGE = 0.1

// kilocode_change start
export type ProfileCondenseOverride = {
	enabled: boolean
	mode: "percent" | "tokens"
	percent: number
	tokens: number
}

type CondenseTriggerResolution = {
	reservedTokens: number
	allowedTokens: number
	effectiveBudget: number
	mode: "global_percent" | "profile_percent" | "profile_tokens"
	thresholdPercent?: number
	thresholdTokens?: number
}

type ResolveCondenseTriggerOptions = {
	contextWindow: number
	maxTokens?: number | null
	autoCondenseContextPercent: number
	profileThresholds: Record<string, number>
	profileCondenseOverrides?: Record<string, ProfileCondenseOverride>
	currentProfileId: string
}

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const resolveCondenseTrigger = ({
	contextWindow,
	maxTokens,
	autoCondenseContextPercent,
	profileThresholds,
	profileCondenseOverrides = {},
	currentProfileId,
}: ResolveCondenseTriggerOptions): CondenseTriggerResolution => {
	const reservedTokens = maxTokens || ANTHROPIC_DEFAULT_MAX_TOKENS
	const allowedTokens = contextWindow * (1 - TOKEN_BUFFER_PERCENTAGE) - reservedTokens
	const effectiveBudget = Math.max(0, Math.floor(allowedTokens))

	const profileOverride = profileCondenseOverrides[currentProfileId]
	if (profileOverride?.enabled) {
		if (profileOverride.mode === "tokens") {
			const tokenThreshold = clampNumber(
				Math.floor(profileOverride.tokens),
				1,
				Math.max(1, Math.floor(effectiveBudget)),
			)
			return {
				reservedTokens,
				allowedTokens,
				effectiveBudget,
				mode: "profile_tokens",
				thresholdTokens: tokenThreshold,
			}
		}

		const percentThreshold = clampNumber(
			Math.floor(profileOverride.percent),
			MIN_CONDENSE_THRESHOLD,
			MAX_CONDENSE_THRESHOLD,
		)
		const thresholdTokens = Math.max(1, Math.floor((percentThreshold / 100) * Math.max(1, effectiveBudget)))
		return {
			reservedTokens,
			allowedTokens,
			effectiveBudget,
			mode: "profile_percent",
			thresholdPercent: percentThreshold,
			thresholdTokens,
		}
	}

	let effectiveThreshold = autoCondenseContextPercent
	const profileThreshold = profileThresholds[currentProfileId]
	if (profileThreshold !== undefined) {
		if (profileThreshold === -1) {
			effectiveThreshold = autoCondenseContextPercent
		} else if (profileThreshold >= MIN_CONDENSE_THRESHOLD && profileThreshold <= MAX_CONDENSE_THRESHOLD) {
			effectiveThreshold = profileThreshold
		}
	}

	return {
		reservedTokens,
		allowedTokens,
		effectiveBudget,
		mode: "global_percent",
		thresholdPercent: effectiveThreshold,
	}
}
// kilocode_change end

/**
 * Counts tokens for user content using the provider's token counting implementation.
 *
 * @param {Array<Anthropic.Messages.ContentBlockParam>} content - The content to count tokens for
 * @param {ApiHandler} apiHandler - The API handler to use for token counting
 * @returns {Promise<number>} A promise resolving to the token count
 */
export async function estimateTokenCount(
	content: Array<Anthropic.Messages.ContentBlockParam>,
	apiHandler: ApiHandler,
): Promise<number> {
	if (!content || content.length === 0) return 0
	return apiHandler.countTokens(content)
}

/**
 * Result of truncation operation, includes the truncation ID for UI events.
 */
export type TruncationResult = {
	messages: ApiMessage[]
	truncationId: string
	messagesRemoved: number
}

/**
 * Truncates a conversation by tagging messages as hidden instead of removing them.
 *
 * The first message is always retained, and a specified fraction (rounded to an even number)
 * of messages from the beginning (excluding the first) is tagged with truncationParent.
 * A truncation marker is inserted to track where truncation occurred.
 *
 * This implements non-destructive sliding window truncation, allowing messages to be
 * restored if the user rewinds past the truncation point.
 *
 * @param {ApiMessage[]} messages - The conversation messages.
 * @param {number} fracToRemove - The fraction (between 0 and 1) of messages (excluding the first) to hide.
 * @param {string} taskId - The task ID for the conversation, used for telemetry
 * @returns {TruncationResult} Object containing the tagged messages, truncation ID, and count of messages removed.
 */
export function truncateConversation(messages: ApiMessage[], fracToRemove: number, taskId: string): TruncationResult {
	TelemetryService.instance.captureSlidingWindowTruncation(taskId)

	const truncationId = crypto.randomUUID()

	// Filter to only visible messages (those not already truncated)
	// We need to track original indices to correctly tag messages in the full array
	const visibleIndices: number[] = []
	messages.forEach((msg, index) => {
		if (!msg.truncationParent && !msg.isTruncationMarker) {
			visibleIndices.push(index)
		}
	})

	// Calculate how many visible messages to truncate (excluding first visible message)
	const visibleCount = visibleIndices.length
	const rawMessagesToRemove = Math.floor((visibleCount - 1) * fracToRemove)
	const messagesToRemove = rawMessagesToRemove - (rawMessagesToRemove % 2)

	if (messagesToRemove <= 0) {
		// Nothing to truncate
		return {
			messages,
			truncationId,
			messagesRemoved: 0,
		}
	}

	// Get the indices of visible messages to truncate (skip first visible, take next N)
	const indicesToTruncate = new Set(visibleIndices.slice(1, messagesToRemove + 1))

	// Tag messages that are being "truncated" (hidden from API calls)
	const taggedMessages = messages.map((msg, index) => {
		if (indicesToTruncate.has(index)) {
			return { ...msg, truncationParent: truncationId }
		}
		return msg
	})

	// Find the actual boundary - the index right after the last truncated message
	const lastTruncatedVisibleIndex = visibleIndices[messagesToRemove] // Last visible message being truncated
	// If all visible messages except the first are truncated, insert marker at the end
	const firstKeptVisibleIndex = visibleIndices[messagesToRemove + 1] ?? taggedMessages.length

	// Insert truncation marker at the actual boundary (between last truncated and first kept)
	const firstKeptTs = messages[firstKeptVisibleIndex]?.ts ?? Date.now()
	const truncationMarker: ApiMessage = {
		role: "user",
		content: `[Sliding window truncation: ${messagesToRemove} messages hidden to reduce context]`,
		ts: firstKeptTs - 1,
		isTruncationMarker: true,
		truncationId,
	}

	// Insert marker at the boundary position
	// Find where to insert: right before the first kept visible message
	const insertPosition = firstKeptVisibleIndex
	const result = [
		...taggedMessages.slice(0, insertPosition),
		truncationMarker,
		...taggedMessages.slice(insertPosition),
	]

	return {
		messages: result,
		truncationId,
		messagesRemoved: messagesToRemove,
	}
}

/**
 * Options for checking if context management will likely run.
 * A subset of ContextManagementOptions with only the fields needed for threshold calculation.
 */
export type WillManageContextOptions = {
	totalTokens: number
	contextWindow: number
	maxTokens?: number | null
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	profileThresholds: Record<string, number>
	// kilocode_change
	profileCondenseOverrides?: Record<string, ProfileCondenseOverride>
	currentProfileId: string
	lastMessageTokens: number
}

/**
 * Checks whether context management (condensation or truncation) will likely run based on current token usage.
 *
 * This is useful for showing UI indicators before `manageContext` is actually called,
 * without duplicating the threshold calculation logic.
 *
 * @param {WillManageContextOptions} options - The options for threshold calculation
 * @returns {boolean} True if context management will likely run, false otherwise
 */
export function willManageContext({
	totalTokens,
	contextWindow,
	maxTokens,
	autoCondenseContext,
	autoCondenseContextPercent,
	profileThresholds,
	// kilocode_change
	profileCondenseOverrides = {},
	currentProfileId,
	lastMessageTokens,
}: WillManageContextOptions): boolean {
	// kilocode_change start
	const trigger = resolveCondenseTrigger({
		contextWindow,
		maxTokens,
		autoCondenseContextPercent,
		profileThresholds,
		profileCondenseOverrides,
		currentProfileId,
	})
	// kilocode_change end

	if (!autoCondenseContext) {
		// When auto-condense is disabled, only truncation can occur
		const prevContextTokens = totalTokens + lastMessageTokens
		return prevContextTokens > trigger.allowedTokens
	}

	const prevContextTokens = totalTokens + lastMessageTokens
	if (prevContextTokens > trigger.allowedTokens) {
		return true
	}

	if (trigger.mode === "global_percent") {
		const contextPercent = (100 * prevContextTokens) / contextWindow
		return contextPercent >= (trigger.thresholdPercent ?? autoCondenseContextPercent)
	}

	return prevContextTokens >= (trigger.thresholdTokens ?? 1)
}

/**
 * Context Management: Conditionally manages the conversation context when approaching limits.
 *
 * Attempts intelligent condensation of prior messages when thresholds are reached.
 * Falls back to sliding window truncation if condensation is unavailable or fails.
 *
 * @param {ContextManagementOptions} options - The options for truncation/condensation
 * @returns {Promise<ApiMessage[]>} The original, condensed, or truncated conversation messages.
 */

export type ContextManagementOptions = {
	messages: ApiMessage[]
	totalTokens: number
	contextWindow: number
	maxTokens?: number | null
	apiHandler: ApiHandler
	autoCondenseContext: boolean
	autoCondenseContextPercent: number
	systemPrompt: string
	taskId: string
	customCondensingPrompt?: string
	condensingApiHandler?: ApiHandler
	profileThresholds: Record<string, number>
	// kilocode_change
	profileCondenseOverrides?: Record<string, ProfileCondenseOverride>
	currentProfileId: string
	useNativeTools?: boolean
}

export type ContextManagementResult = SummarizeResponse & {
	prevContextTokens: number
	truncationId?: string
	messagesRemoved?: number
	newContextTokensAfterTruncation?: number
}

/**
 * Conditionally manages conversation context (condense and fallback truncation).
 *
 * @param {ContextManagementOptions} options - The options for truncation/condensation
 * @returns {Promise<ApiMessage[]>} The original, condensed, or truncated conversation messages.
 */
export async function manageContext({
	messages,
	totalTokens,
	contextWindow,
	maxTokens,
	apiHandler,
	autoCondenseContext,
	autoCondenseContextPercent,
	systemPrompt,
	taskId,
	customCondensingPrompt,
	condensingApiHandler,
	profileThresholds,
	// kilocode_change
	profileCondenseOverrides = {},
	currentProfileId,
	useNativeTools,
}: ContextManagementOptions): Promise<ContextManagementResult> {
	let error: string | undefined
	let cost = 0
	// Estimate tokens for the last message (which is always a user message)
	const lastMessage = messages[messages.length - 1]
	const lastMessageContent = lastMessage.content
	const lastMessageTokens = Array.isArray(lastMessageContent)
		? await estimateTokenCount(lastMessageContent, apiHandler)
		: await estimateTokenCount([{ type: "text", text: lastMessageContent as string }], apiHandler)

	// Calculate total effective tokens (totalTokens never includes the last message)
	const prevContextTokens = totalTokens + lastMessageTokens

	// kilocode_change start
	const trigger = resolveCondenseTrigger({
		contextWindow,
		maxTokens,
		autoCondenseContextPercent,
		profileThresholds,
		profileCondenseOverrides,
		currentProfileId,
	})
	// kilocode_change end

	if (autoCondenseContext) {
		// kilocode_change start
		let shouldCondense = prevContextTokens > trigger.allowedTokens
		if (!shouldCondense) {
			if (trigger.mode === "global_percent") {
				const contextPercent = (100 * prevContextTokens) / contextWindow
				shouldCondense = contextPercent >= (trigger.thresholdPercent ?? autoCondenseContextPercent)
			} else {
				shouldCondense = prevContextTokens >= (trigger.thresholdTokens ?? 1)
			}
		}
		// kilocode_change end

		if (shouldCondense) {
			// Attempt to intelligently condense the context
			const result = await summarizeConversation(
				messages,
				apiHandler,
				systemPrompt,
				taskId,
				prevContextTokens,
				true, // automatic trigger
				customCondensingPrompt,
				condensingApiHandler,
				useNativeTools,
			)
			if (result.error) {
				error = result.error
				cost = result.cost
			} else {
				return { ...result, prevContextTokens }
			}
		}
	}

	// Fall back to sliding window truncation if needed
	if (prevContextTokens > trigger.allowedTokens) {
		const truncationResult = truncateConversation(messages, 0.5, taskId)

		// Calculate new context tokens after truncation by counting non-truncated messages
		// Messages with truncationParent are hidden, so we count only those without it
		const effectiveMessages = truncationResult.messages.filter(
			(msg) => !msg.truncationParent && !msg.isTruncationMarker,
		)

		// Include system prompt tokens so this value matches what we send to the API.
		// Note: `prevContextTokens` is computed locally here (totalTokens + lastMessageTokens).
		let newContextTokensAfterTruncation = await estimateTokenCount(
			[{ type: "text", text: systemPrompt }],
			apiHandler,
		)

		for (const msg of effectiveMessages) {
			const content = msg.content
			if (Array.isArray(content)) {
				newContextTokensAfterTruncation += await estimateTokenCount(content, apiHandler)
			} else if (typeof content === "string") {
				newContextTokensAfterTruncation += await estimateTokenCount(
					[{ type: "text", text: content }],
					apiHandler,
				)
			}
		}

		return {
			messages: truncationResult.messages,
			prevContextTokens,
			summary: "",
			cost,
			error,
			truncationId: truncationResult.truncationId,
			messagesRemoved: truncationResult.messagesRemoved,
			newContextTokensAfterTruncation,
		}
	}
	// No truncation or condensation needed
	return { messages, summary: "", cost, prevContextTokens, error }
}
