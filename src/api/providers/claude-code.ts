import type { Anthropic } from "@anthropic-ai/sdk"
import {
	claudeCodeDefaultModelId,
	type ClaudeCodeModelId,
	claudeCodeModels,
	claudeCodeReasoningConfig,
	type ClaudeCodeReasoningLevel,
	type ModelInfo,
} from "@roo-code/types"
import { type ApiHandler, type SingleCompletionHandler } from ".."
import { ApiStreamUsageChunk, type ApiStream } from "../transform/stream"
import { ApiHandlerOptions } from "../../shared/api"
import { countTokens } from "../../utils/countTokens"
import { filterMessagesForClaudeCode } from "../../integrations/claude-code/message-filter"
import { runClaudeCode } from "../../integrations/claude-code/run"

interface ClaudeCodeHandlerOptions extends ApiHandlerOptions {
	claudeCodePath?: string
	thinkingBudgetTokens?: number
}

export class ClaudeCodeHandler implements ApiHandler, SingleCompletionHandler {
	private options: ClaudeCodeHandlerOptions

	constructor(options: ClaudeCodeHandlerOptions) {
		this.options = options
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

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Filter out image blocks since Claude Code doesn't support them
		const filteredMessages = filterMessagesForClaudeCode(messages)

		const model = this.getModel()
		const reasoningLevel = this.getReasoningEffort(model.info)
		const thinkingBudgetTokens = reasoningLevel ? claudeCodeReasoningConfig[reasoningLevel].budgetTokens : undefined

		const claudeProcess = runClaudeCode({
			systemPrompt,
			messages: filteredMessages,
			path: this.options.claudeCodePath,
			modelId: model.id,
			thinkingBudgetTokens,
		})

		// Usage is included with assistant messages,
		// but cost is included in the result chunk
		const usage: ApiStreamUsageChunk = {
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		}

		let isPaidUsage = true
		let hasYieldedContent = false
		let hasYieldedUsage = false

		for await (const chunk of claudeProcess) {
			if (typeof chunk === "string") {
				yield {
					type: "text",
					text: chunk,
				}
				hasYieldedContent = true
				continue
			}

			if (chunk.type === "system" && chunk.subtype === "init") {
				// Based on tests, subscription usage sets the `apiKeySource` to "none"
				isPaidUsage = chunk.apiKeySource !== "none"
				continue
			}

			// Handle error chunks from Claude Code CLI
			if (chunk.type === "error") {
				throw new Error("Claude Code CLI returned an error response")
			}

			if (chunk.type === "assistant" && "message" in chunk) {
				const message = chunk.message

				// Check for API errors in the response content
				if (message.content && message.content.length > 0) {
					const firstContent = message.content[0]
					const textContent = "text" in firstContent ? firstContent : undefined

					if (textContent && textContent.text.startsWith(`API Error`)) {
						// Error messages are formatted as: `API Error: <<status code>> <<json>>`
						const errorMessageStart = textContent.text.indexOf("{")
						if (errorMessageStart === -1) {
							throw new Error(textContent.text)
						}
						const errorMessage = textContent.text.slice(errorMessageStart)

						const error = this.attemptParse(errorMessage)
						if (!error) {
							throw new Error(textContent.text)
						}

						if (error.error?.message?.includes("Invalid model name")) {
							throw new Error(
								textContent.text +
									`\n\nAPI keys and subscription plans allow different models. Make sure the selected model is included in your plan.`,
							)
						}

						throw new Error(errorMessage)
					}
				}

				// Process all content blocks
				for (const content of message.content) {
					switch (content.type) {
						case "text":
							yield {
								type: "text",
								text: content.text,
							}
							hasYieldedContent = true
							break
						case "thinking":
							yield {
								type: "reasoning",
								text: (content as { thinking?: string }).thinking || "",
							}
							break
						case "redacted_thinking":
							yield {
								type: "reasoning",
								text: "[Redacted thinking block]",
							}
							break
						case "tool_use":
							// Yield complete tool_use blocks for execution
							// Using "tool_call" (not "tool_call_partial") since Claude Code CLI
							// returns complete tool calls, not streaming deltas
							yield {
								type: "tool_call",
								id: content.id,
								name: content.name,
								arguments: JSON.stringify(content.input),
							}
							hasYieldedContent = true
							break
					}
				}

				// Update usage from message
				// According to Anthropic's API documentation:
				// https://docs.anthropic.com/en/api/messages#usage-object
				// The `input_tokens` field already includes both `cache_read_input_tokens` and `cache_creation_input_tokens`.
				// Therefore, we should not add cache tokens to the input_tokens count again, as this would result in double-counting.
				if (message.usage) {
					usage.inputTokens = message.usage.input_tokens ?? 0
					usage.outputTokens = message.usage.output_tokens ?? 0
					usage.cacheReadTokens =
						(message.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens ?? 0
					usage.cacheWriteTokens =
						(message.usage as { cache_creation_input_tokens?: number })?.cache_creation_input_tokens ?? 0
				}

				continue
			}

			if (chunk.type === "result" && "result" in chunk) {
				usage.totalCost = isPaidUsage ? chunk.total_cost_usd : 0
				yield usage
				hasYieldedUsage = true
			}
		}

		// Always yield usage at the end if we haven't already
		// This ensures kilocode gets the usage data even if there was no result chunk
		if (!hasYieldedUsage) {
			yield usage
		}

		// If we haven't yielded any content, yield an empty text to prevent "no assistant messages" error
		if (!hasYieldedContent) {
			console.warn("[ClaudeCodeHandler] No content received from Claude Code CLI")
		}
	}

	private attemptParse(str: string) {
		try {
			return JSON.parse(str)
		} catch (_err) {
			return null
		}
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
	 * Completes a prompt using the Claude Code CLI.
	 * This is used for context condensing and prompt enhancement.
	 */
	async completePrompt(prompt: string): Promise<string> {
		const model = this.getModel()

		const claudeProcess = runClaudeCode({
			systemPrompt: "",
			messages: [{ role: "user", content: prompt }],
			path: this.options.claudeCodePath,
			modelId: model.id,
			thinkingBudgetTokens: undefined, // No thinking for simple completions
		})

		let result = ""

		for await (const chunk of claudeProcess) {
			if (typeof chunk === "string") {
				result += chunk
				continue
			}

			if (chunk.type === "assistant" && "message" in chunk) {
				for (const content of chunk.message.content) {
					if (content.type === "text") {
						result += content.text
					}
				}
			}
		}

		return result
	}
}
