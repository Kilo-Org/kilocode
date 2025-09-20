import type { Anthropic } from "@anthropic-ai/sdk"
import {
	claudeCodeDefaultModelId,
	type ClaudeCodeModelId,
	claudeCodeModels,
	type ModelInfo,
	getClaudeCodeModelId,
	internationalZAiModels,
	qwenCodeModels,
	deepSeekModels,
} from "@roo-code/types"
import { type ApiHandler } from ".."
import { ApiStreamUsageChunk, type ApiStream } from "../transform/stream"
import { runClaudeCode } from "../../integrations/claude-code/run"
import { filterMessagesForClaudeCode } from "../../integrations/claude-code/message-filter"
import { BaseProvider } from "./base-provider"
import { t } from "../../i18n"
import { ApiHandlerOptions } from "../../shared/api"
import * as os from "os"
import * as path from "path"
import { promises as fs } from "fs"

export class ClaudeCodeHandler extends BaseProvider implements ApiHandler {
	private options: ApiHandlerOptions
	private cachedConfig: any = null
	private cachedModelInfo: { id: string; info: ModelInfo } | null = null

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		// Initialize model detection asynchronously
		this.initializeModelDetection()
	}

	/**
	 * Initialize model detection asynchronously
	 */
	private async initializeModelDetection(): Promise<void> {
		try {
			const providerInfo = await this.detectProviderFromConfig()
			if (providerInfo) {
				const { provider, models } = providerInfo
				const config = await this.readClaudeCodeConfig()
				const configModelId = config?.env?.ANTHROPIC_MODEL || Object.keys(models)[0]
				const finalModelId = this.options.apiModelId || configModelId

				// For alternative providers, always use a valid model from the detected models
				const validModelId = finalModelId in models ? finalModelId : Object.keys(models)[0]

				const modelInfo: ModelInfo = { ...models[validModelId] }

				// Override maxTokens with the configured value if provided
				if (this.options.claudeCodeMaxOutputTokens !== undefined) {
					modelInfo.maxTokens = this.options.claudeCodeMaxOutputTokens
				}

				this.cachedModelInfo = { id: validModelId, info: modelInfo }
				return
			}
			// Fall back to standard Claude models
			const modelId = this.options.apiModelId || claudeCodeDefaultModelId
			if (modelId in claudeCodeModels) {
				const id = modelId as ClaudeCodeModelId
				const modelInfo: ModelInfo = { ...claudeCodeModels[id] }

				// Override maxTokens with the configured value if provided
				if (this.options.claudeCodeMaxOutputTokens !== undefined) {
					modelInfo.maxTokens = this.options.claudeCodeMaxOutputTokens
				}

				this.cachedModelInfo = { id, info: modelInfo }
			} else {
				// Use default model
				const defaultModelInfo: ModelInfo = { ...claudeCodeModels[claudeCodeDefaultModelId] }
				if (this.options.claudeCodeMaxOutputTokens !== undefined) {
					defaultModelInfo.maxTokens = this.options.claudeCodeMaxOutputTokens
				}
				this.cachedModelInfo = {
					id: claudeCodeDefaultModelId,
					info: defaultModelInfo,
				}
			}
		} catch (error) {
			// Fallback to default Claude model on error
			const defaultModelInfo: ModelInfo = { ...claudeCodeModels[claudeCodeDefaultModelId] }
			if (this.options.claudeCodeMaxOutputTokens !== undefined) {
				defaultModelInfo.maxTokens = this.options.claudeCodeMaxOutputTokens
			}
			this.cachedModelInfo = {
				id: claudeCodeDefaultModelId,
				info: defaultModelInfo,
			}
		}
	}

	/**
	 * Static method to get available models based on Claude Code configuration
	 */
	static async getAvailableModels(
		claudeCodePath?: string,
	): Promise<{ provider: string; models: Record<string, ModelInfo> } | null> {
		try {
			// Create a temporary instance to access config reading methods
			const tempHandler = new ClaudeCodeHandler({ claudeCodePath })
			// Clear any cached config to ensure fresh detection
			tempHandler.cachedConfig = null
			const providerInfo = await tempHandler.detectProviderFromConfig()

			if (providerInfo) {
				// Ensure we always return valid models for alternative providers
				const { provider, models } = providerInfo
				if (Object.keys(models).length > 0) {
					return { provider, models }
				}
			}

			// Return default Claude models if no alternative provider detected or no models available
			return { provider: "claude-code", models: claudeCodeModels }
		} catch (error) {
			console.error("❌ [ClaudeCodeHandler] Error in getAvailableModels:", error)
			// Return default Claude models on error
			return { provider: "claude-code", models: claudeCodeModels }
		}
	}

	/**
	 * Read Claude Code's native configuration files to detect provider and models
	 * Checks multiple possible locations in order of priority:
	 * 1. ~/.claude/settings.json (global user settings)
	 * 2. ~/.claude/settings.local.json (local user settings)
	 * 3. ./.claude/settings.json (project-specific settings)
	 * 4. ./.claude/settings.local.json (project-specific local settings)
	 * 5. ~/.claude.json (main global config)
	 */
	private async readClaudeCodeConfig(): Promise<any> {
		if (this.cachedConfig) {
			return this.cachedConfig
		}

		const homeDir = os.homedir()
		const currentDir = process.cwd()

		// List of possible configuration file paths in order of priority
		const possibleConfigPaths = [
			// Global user settings
			path.join(homeDir, ".claude", "settings.json"),
			// Local user settings
			path.join(homeDir, ".claude", "settings.local.json"),
			// Project-specific settings
			path.join(currentDir, ".claude", "settings.json"),
			// Project-specific local settings
			path.join(currentDir, ".claude", "settings.local.json"),
			// Main global config
			path.join(homeDir, ".claude.json"),
		]

		// Try each path in order
		for (const configPath of possibleConfigPaths) {
			try {
				const configContent = await fs.readFile(configPath, "utf8")
				const config = JSON.parse(configContent)

				// Cache the first valid configuration found
				this.cachedConfig = config
				return config
			} catch (error) {
				// Continue to the next path if file doesn't exist or can't be read
				continue
			}
		}

		// No valid configuration file found
		return null
	}

	/**
	 * Detect alternative provider from Claude Code's configuration
	 */
	private async detectProviderFromConfig(): Promise<{ provider: string; models: Record<string, ModelInfo> } | null> {
		const config = await this.readClaudeCodeConfig()

		if (!config || !config.env) {
			return null
		}

		const baseUrl = config.env.ANTHROPIC_BASE_URL

		if (!baseUrl) {
			return null
		}

		// Check for Z.ai
		if (baseUrl.includes("z.ai")) {
			// Exclude `glm-4.5-flash` because not covered by claude code coding plan
			const { "glm-4.5-flash": _, ...filteredModels } = internationalZAiModels
			return { provider: "zai", models: filteredModels }
		}

		// Check for Qwen (Alibaba Cloud/Dashscope)
		if (baseUrl.includes("dashscope.aliyuncs.com") || baseUrl.includes("aliyuncs.com")) {
			return { provider: "qwen-code", models: qwenCodeModels }
		}

		// Check for DeepSeek
		if (baseUrl.includes("deepseek.com") || baseUrl.includes("api.deepseek.com")) {
			return { provider: "deepseek", models: deepSeekModels }
		}

		return null
	}

	override async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		// Filter out image blocks since Claude Code doesn't support them
		const filteredMessages = filterMessagesForClaudeCode(messages)

		const useVertex = process.env.CLAUDE_CODE_USE_VERTEX === "1"
		const model = this.getModel()

		// Check if we're using an alternative provider from Claude Code config
		const config = await this.readClaudeCodeConfig()
		const envVars = config?.env || {}
		const baseUrl = config?.env?.ANTHROPIC_BASE_URL

		// Detect if we're using an alternative provider
		const isAlternativeProvider =
			baseUrl &&
			(baseUrl.includes("z.ai") ||
				baseUrl.includes("dashscope.aliyuncs.com") ||
				baseUrl.includes("aliyuncs.com") ||
				baseUrl.includes("deepseek.com") ||
				baseUrl.includes("api.deepseek.com"))

		let finalModelId: string = model.id
		if (isAlternativeProvider) {
			// For alternative providers, use the model ID as-is from config or fallback
			finalModelId = envVars.ANTHROPIC_MODEL || model.id
		} else {
			// Validate that the model ID is a valid ClaudeCodeModelId for standard Claude
			finalModelId = model.id in claudeCodeModels ? (model.id as ClaudeCodeModelId) : claudeCodeDefaultModelId
		}

		let modelIdForClaudeCode: string
		if (isAlternativeProvider) {
			// For alternative providers, use the model ID as-is
			modelIdForClaudeCode = finalModelId
		} else {
			// For standard Claude, validate the model ID and apply Vertex formatting if needed
			const validClaudeModelId =
				finalModelId in claudeCodeModels ? (finalModelId as ClaudeCodeModelId) : claudeCodeDefaultModelId
			modelIdForClaudeCode = getClaudeCodeModelId(validClaudeModelId, useVertex)
		}

		const claudeProcess = runClaudeCode({
			systemPrompt,
			messages: filteredMessages,
			path: this.options.claudeCodePath,
			modelId: modelIdForClaudeCode,
			maxOutputTokens: this.options.claudeCodeMaxOutputTokens,
			envVars,
		})

		// Usage is included with assistant messages,
		// but cost is included in the result chunk
		let usage: ApiStreamUsageChunk = {
			type: "usage",
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		}

		let isPaidUsage = true

		for await (const chunk of claudeProcess) {
			if (typeof chunk === "string") {
				yield {
					type: "text",
					text: chunk,
				}

				continue
			}

			if (chunk.type === "system" && chunk.subtype === "init") {
				// Based on my tests, subscription usage sets the `apiKeySource` to "none"
				isPaidUsage = chunk.apiKeySource !== "none"
				continue
			}

			if (chunk.type === "assistant" && "message" in chunk) {
				const message = chunk.message

				if (message.stop_reason !== null) {
					const content = "text" in message.content[0] ? message.content[0] : undefined

					const isError = content && content.text.startsWith(`API Error`)
					if (isError) {
						// Error messages are formatted as: `API Error: <<status code>> <<json>>`
						const errorMessageStart = content.text.indexOf("{")
						const errorMessage = content.text.slice(errorMessageStart)

						const error = this.attemptParse(errorMessage)
						if (!error) {
							throw new Error(content.text)
						}

						if (error.error.message.includes("Invalid model name")) {
							throw new Error(
								content.text + `\n\n${t("common:errors.claudeCode.apiKeyModelPlanMismatch")}`,
							)
						}

						throw new Error(errorMessage)
					}
				}

				for (const content of message.content) {
					switch (content.type) {
						case "text":
							yield {
								type: "text",
								text: content.text,
							}
							break
						case "thinking":
							yield {
								type: "reasoning",
								text: content.thinking || "",
							}
							break
						case "redacted_thinking":
							yield {
								type: "reasoning",
								text: "[Redacted thinking block]",
							}
							break
						case "tool_use":
							console.error(`tool_use is not supported yet. Received: ${JSON.stringify(content)}`)
							break
					}
				}

				usage.inputTokens += message.usage.input_tokens
				usage.outputTokens += message.usage.output_tokens
				usage.cacheReadTokens = (usage.cacheReadTokens || 0) + (message.usage.cache_read_input_tokens || 0)
				usage.cacheWriteTokens =
					(usage.cacheWriteTokens || 0) + (message.usage.cache_creation_input_tokens || 0)

				continue
			}

			if (chunk.type === "result" && "result" in chunk) {
				usage.totalCost = isPaidUsage ? chunk.total_cost_usd : 0
			}
		}

		// Always yield usage at the end, even if no result chunk was received
		// If totalCost is not set (no result chunk), calculate it based on usage for paid usage
		if (usage.totalCost === undefined && isPaidUsage && usage.inputTokens > 0) {
			// For paid usage without result chunk, calculate cost based on current model's pricing
			const model = this.getModel()
			const inputCost = (usage.inputTokens / 1_000_000) * (model.info.inputPrice || 0)
			const outputCost = (usage.outputTokens / 1_000_000) * (model.info.outputPrice || 0)
			usage.totalCost = inputCost + outputCost
		} else if (usage.totalCost === undefined) {
			// For free usage or no usage data, cost is 0
			usage.totalCost = 0
		}
		yield usage
	}

	getModel() {
		// Return cached model info, or fallback to default if not yet initialized
		if (this.cachedModelInfo) {
			return this.cachedModelInfo
		}

		// Fallback to default Claude model if cache is not ready
		const defaultModelInfo: ModelInfo = { ...claudeCodeModels[claudeCodeDefaultModelId] }
		if (this.options.claudeCodeMaxOutputTokens !== undefined) {
			defaultModelInfo.maxTokens = this.options.claudeCodeMaxOutputTokens
		}

		return {
			id: claudeCodeDefaultModelId,
			info: defaultModelInfo,
		}
	}

	private attemptParse(str: string) {
		try {
			return JSON.parse(str)
		} catch (err) {
			return null
		}
	}
}
