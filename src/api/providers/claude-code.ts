import type { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"
import {
	claudeCodeDefaultModelId,
	type ClaudeCodeModelId,
	claudeCodeModels,
	claudeCodeReasoningConfig,
	type ClaudeCodeReasoningLevel,
	type ModelInfo,
} from "@roo-code/types"
import { type ApiHandler, ApiHandlerCreateMessageMetadata, type SingleCompletionHandler } from ".."
import { ApiStreamUsageChunk, type ApiStream } from "../transform/stream"
import { claudeCodeOAuthManager, generateUserId } from "../../integrations/claude-code/oauth"
import {
	createStreamingMessage,
	type StreamChunk,
	type ThinkingConfig,
} from "../../integrations/claude-code/streaming-client"
import { t } from "../../i18n"
import { ApiHandlerOptions } from "../../shared/api"
import { countTokens } from "../../utils/countTokens"
import { convertOpenAIToolsToAnthropic } from "../../core/prompts/tools/native-tools/converters"

/**
 * Converts OpenAI tool_choice to Anthropic ToolChoice format
 * @param toolChoice - OpenAI tool_choice parameter
 * @param parallelToolCalls - When true, allows parallel tool calls. When false (default), disables parallel tool calls.
 */
function convertOpenAIToolChoice(
	toolChoice: OpenAI.Chat.ChatCompletionCreateParams["tool_choice"],
	parallelToolCalls?: boolean,
): Anthropic.Messages.MessageCreateParams["tool_choice"] | undefined {
	// Anthropic allows parallel tool calls by default. When parallelToolCalls is false or undefined,
	// we disable parallel tool use to ensure one tool call at a time.
	const disableParallelToolUse = !parallelToolCalls

	if (!toolChoice) {
		// Default to auto with parallel tool use control
		return { type: "auto", disable_parallel_tool_use: disableParallelToolUse }
	}

	if (typeof toolChoice === "string") {
		switch (toolChoice) {
			case "none":
				return undefined // Anthropic doesn't have "none", just omit tools
			case "auto":
				return { type: "auto", disable_parallel_tool_use: disableParallelToolUse }
			case "required":
				return { type: "any", disable_parallel_tool_use: disableParallelToolUse }
			default:
				return { type: "auto", disable_parallel_tool_use: disableParallelToolUse }
		}
	}

	// Handle object form { type: "function", function: { name: string } }
	if (typeof toolChoice === "object" && "function" in toolChoice) {
		return {
			type: "tool",
			name: toolChoice.function.name,
			disable_parallel_tool_use: disableParallelToolUse,
		}
	}

	return { type: "auto", disable_parallel_tool_use: disableParallelToolUse }
}

export class ClaudeCodeHandler implements ApiHandler, SingleCompletionHandler {
	private options: ApiHandlerOptions
	/**
	 * Store the last thinking block signature for interleaved thinking with tool use.
	 * This is captured from thinking_complete events during streaming and
	 * must be passed back to the API when providing tool results.
	 * Similar to Gemini's thoughtSignature pattern.
	 */
	private lastThinkingSignature?: string

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	/**
	 * Get the thinking signature from the last response.
	 * Used by Task.addToApiConversationHistory to persist the signature
	 * so it can be passed back to the API for tool use continuations.
	 * This follows the same pattern as Gemini's getThoughtSignature().
	 */
	public getThoughtSignature(): string | undefined {
		return this.lastThinkingSignature
	}

	/**
	 * Gets the reasoning effort level for the current request.
	 * Returns the effective reasoning level (low/medium/high) or null if disabled.
	 */
	private getReasoningEffort(modelInfo: ModelInfo): ClaudeCodeReasoningLevel | null {
		// Check if reasoning is explicitly disabled
		if (this.options.enableReasoningEffort === false) {
			return null
		}

		// Get the selected effort from settings or model default
		const selectedEffort = this.options.reasoningEffort ?? modelInfo.reasoningEffort

		// "disable" or no selection means no reasoning
		if (!selectedEffort || selectedEffort === "disable") {
			return null
		}

		// Only allow valid levels for Claude Code
		if (selectedEffort === "low" || selectedEffort === "medium" || selectedEffort === "high") {
			return selectedEffort
		}

		return null
	}

	async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		// Reset per-request state that we persist into apiConversationHistory
		this.lastThinkingSignature = undefined

		const buildNotAuthenticatedError = () =>
			new Error(
				t("common:errors.claudeCode.notAuthenticated", {
					defaultValue:
						"Not authenticated with Claude Code. Please sign in using the Claude Code OAuth flow.",
				}),
			)

		async function* streamOnce(this: ClaudeCodeHandler, accessToken: string): ApiStream {
			// Get user email for generating user_id metadata
			const email = await claudeCodeOAuthManager.getEmail()

			const model = this.getModel()

			// Validate that the model ID is a valid ClaudeCodeModelId
			const modelId = Object.hasOwn(claudeCodeModels, model.id)
				? (model.id as ClaudeCodeModelId)
				: claudeCodeDefaultModelId

			// Generate user_id metadata in the format required by Claude Code API
			const userId = generateUserId(email || undefined)

			// Convert OpenAI tools to Anthropic format if provided and protocol is native
			// Exclude tools when tool_choice is "none" since that means "don't use tools"
			const shouldIncludeNativeTools =
				metadata?.tools &&
				metadata.tools.length > 0 &&
				metadata?.toolProtocol !== "xml" &&
				metadata?.tool_choice !== "none"

			const anthropicTools = shouldIncludeNativeTools ? convertOpenAIToolsToAnthropic(metadata.tools!) : undefined

			const anthropicToolChoice = shouldIncludeNativeTools
				? convertOpenAIToolChoice(metadata.tool_choice, metadata.parallelToolCalls)
				: undefined

			// Determine reasoning effort and thinking configuration
			const reasoningLevel = this.getReasoningEffort(model.info)

			let thinking: ThinkingConfig
			// With interleaved thinking (enabled via beta header), budget_tokens can exceed max_tokens
			// as the token limit becomes the entire context window. We use the model's maxTokens.
			// See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking#interleaved-thinking
			const maxTokens = model.info.maxTokens ?? 16384

			if (reasoningLevel) {
				// Use thinking mode with budget_tokens from config
				const config = claudeCodeReasoningConfig[reasoningLevel]
				thinking = {
					type: "enabled",
					budget_tokens: config.budgetTokens,
				}
			} else {
				// Explicitly disable thinking
				thinking = { type: "disabled" }
			}

			// Create streaming request using OAuth
			const stream = createStreamingMessage({
				accessToken,
				model: modelId,
				systemPrompt,
				messages,
				maxTokens,
				thinking,
				tools: anthropicTools,
				toolChoice: anthropicToolChoice,
				metadata: {
					user_id: userId,
				},
			})

			// Track usage for cost calculation
			let inputTokens = 0
			let outputTokens = 0
			let cacheReadTokens = 0
			let cacheWriteTokens = 0

			for await (const chunk of stream) {
				switch (chunk.type) {
					case "text":
						yield {
							type: "text",
							text: chunk.text,
						}
						break

					case "reasoning":
						yield {
							type: "reasoning",
							text: chunk.text,
						}
						break

					case "thinking_complete":
						// Capture the signature for persistence in api_conversation_history
						// This enables tool use continuations where thinking blocks must be passed back
						if (chunk.signature) {
							this.lastThinkingSignature = chunk.signature
						}
						// Emit a complete thinking block with signature
						// This is critical for interleaved thinking with tool use
						// The signature must be included when passing thinking blocks back to the API
						yield {
							type: "reasoning",
							text: chunk.thinking,
							signature: chunk.signature,
						}
						break

					case "tool_call_partial":
						yield {
							type: "tool_call_partial",
							index: chunk.index,
							id: chunk.id,
							name: chunk.name,
							arguments: chunk.arguments,
						}
						break

					case "usage": {
						inputTokens = chunk.inputTokens
						outputTokens = chunk.outputTokens
						cacheReadTokens = chunk.cacheReadTokens || 0
						cacheWriteTokens = chunk.cacheWriteTokens || 0

						// Claude Code is subscription-based, no per-token cost
						const usageChunk: ApiStreamUsageChunk = {
							type: "usage",
							inputTokens,
							outputTokens,
							cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
							cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : undefined,
							totalCost: 0,
						}

						yield usageChunk
						break
					}

					case "error":
						throw new Error(chunk.error)
				}
			}
		}

		// Get access token from OAuth manager
		let accessToken = await claudeCodeOAuthManager.getAccessToken()
		if (!accessToken) {
			throw buildNotAuthenticatedError()
		}

		// Try the request with at most one force-refresh retry on auth failure
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				yield* streamOnce.call(this, accessToken)
				return
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				const isAuthFailure = /unauthorized|invalid token|not authenticated|authentication/i.test(message)

				// Only retry on auth failure during first attempt
				const canRetry = attempt === 0 && isAuthFailure
				if (!canRetry) {
					throw error
				}

				// Force refresh the token for retry
				const refreshed = await claudeCodeOAuthManager.forceRefreshAccessToken()
				if (!refreshed) {
					throw buildNotAuthenticatedError()
				}
				accessToken = refreshed
			}
		}

		// Unreachable: loop always returns on success or throws on failure
		throw buildNotAuthenticatedError()
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && Object.hasOwn(claudeCodeModels, modelId)) {
			const id = modelId as ClaudeCodeModelId
			return { id, info: { ...claudeCodeModels[id] } }
		}

		return {
			id: claudeCodeDefaultModelId,
			info: { ...claudeCodeModels[claudeCodeDefaultModelId] },
		}
	}

	async countTokens(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
		if (content.length === 0) {
			return 0
		}
		return countTokens(content, { useWorker: true })
	}

	/**
	 * Completes a prompt using the Claude Code API.
	 * This is used for context condensing and prompt enhancement.
	 * The Claude Code branding is automatically prepended by createStreamingMessage.
	 */
	async completePrompt(prompt: string): Promise<string> {
		// Get access token from OAuth manager
		const accessToken = await claudeCodeOAuthManager.getAccessToken()

		if (!accessToken) {
			throw new Error(
				t("common:errors.claudeCode.notAuthenticated", {
					defaultValue:
						"Not authenticated with Claude Code. Please sign in using the Claude Code OAuth flow.",
				}),
			)
		}

		// Get user email for generating user_id metadata
		const email = await claudeCodeOAuthManager.getEmail()

		const model = this.getModel()

		// Validate that the model ID is a valid ClaudeCodeModelId
		const modelId = Object.hasOwn(claudeCodeModels, model.id)
			? (model.id as ClaudeCodeModelId)
			: claudeCodeDefaultModelId

		// Generate user_id metadata in the format required by Claude Code API
		const userId = generateUserId(email || undefined)

		// Use maxTokens from model info for completion
		const maxTokens = model.info.maxTokens ?? 16384

		// Create streaming request using OAuth
		// The system prompt is empty here since the prompt itself contains all context
		// createStreamingMessage will still prepend the Claude Code branding
		const stream = createStreamingMessage({
			accessToken,
			model: modelId,
			systemPrompt: "", // Empty system prompt - the prompt text contains all necessary context
			messages: [{ role: "user", content: prompt }],
			maxTokens,
			thinking: { type: "disabled" }, // No thinking for simple completions
			metadata: {
				user_id: userId,
			},
		})

		// Collect all text chunks into a single response
		let result = ""

		for await (const chunk of stream) {
			switch (chunk.type) {
				case "text":
					result += chunk.text
					break
				case "error":
					throw new Error(chunk.error)
			}
		}

		return result
	}
}
