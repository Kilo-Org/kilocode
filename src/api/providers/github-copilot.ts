// kilocode_change - new file
import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import {
	githubCopilotDefaultModelId,
	githubCopilotModels,
	openAiModelInfoSaneDefaults,
	type ModelInfo,
	NATIVE_TOOL_DEFAULTS,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { getModelParams } from "../transform/model-params"
import type { ApiStream } from "../transform/stream"

import { OpenAiHandler } from "./openai"
import type { ApiHandlerCreateMessageMetadata } from "../index"
import { fetchCopilotToken, resolveGitHubCopilotToken } from "./utils/github-copilot-auth"
import { getApiRequestTimeout } from "./utils/timeout-config"

const GITHUB_COPILOT_BASE_URL = "https://api.githubcopilot.com"
const COPILOT_TOKEN_REFRESH_BUFFER_MS = 60_000
const COPILOT_USER_AGENT = process.env.KILOCODE_COPILOT_USER_AGENT ?? "KiloCode/1.0"
const COPILOT_EDITOR_VERSION = process.env.KILOCODE_COPILOT_EDITOR_VERSION ?? "KiloCode/1.0"
const COPILOT_EDITOR_PLUGIN_VERSION = process.env.KILOCODE_COPILOT_EDITOR_PLUGIN_VERSION ?? "KiloCode/1.0"
const COPILOT_INTEGRATION_ID = process.env.KILOCODE_COPILOT_INTEGRATION_ID ?? "vscode-chat"
const COPILOT_INITIATOR = process.env.KILOCODE_COPILOT_INITIATOR
const COPILOT_API_HEADERS: Record<string, string> = {
	"Openai-Intent": "conversation-edits",
	"User-Agent": COPILOT_USER_AGENT,
	"Editor-Version": COPILOT_EDITOR_VERSION,
	"Editor-Plugin-Version": COPILOT_EDITOR_PLUGIN_VERSION,
	"Copilot-Integration-Id": COPILOT_INTEGRATION_ID,
}
if (COPILOT_INITIATOR) {
	COPILOT_API_HEADERS["x-initiator"] = COPILOT_INITIATOR
}

/**
 * GitHub Copilot provider handler.
 * Uses OAuth token from GitHub Copilot subscription to access the API.
 * API is OpenAI-compatible, so we extend OpenAiHandler.
 */
export class GitHubCopilotHandler extends OpenAiHandler {
	private copilotToken?: string
	private copilotTokenExpiresAt?: number
	private copilotTokenRefreshAt?: number
	private copilotTokenRequest?: Promise<string>

	constructor(options: ApiHandlerOptions) {
		// Set openAiModelId from githubCopilotModelId so parent class uses correct model
		const defaultModelId = options.githubCopilotModelId ?? githubCopilotDefaultModelId
		const mergedOptions = {
			...options,
			openAiModelId: defaultModelId,
			openAiBaseUrl: GITHUB_COPILOT_BASE_URL,
		}
		super(mergedOptions)

		this.client = new OpenAI({
			baseURL: GITHUB_COPILOT_BASE_URL,
			apiKey: "not-provided",
			timeout: getApiRequestTimeout(),
			defaultHeaders: COPILOT_API_HEADERS,
		})
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await this.ensureCopilotToken()

		try {
			yield* super.createMessage(systemPrompt, messages, metadata)
		} catch (error) {
			if (this.isAuthError(error)) {
				await this.ensureCopilotToken(true)
				yield* super.createMessage(systemPrompt, messages, metadata)
				return
			}

			throw error
		}
	}

	override async completePrompt(prompt: string): Promise<string> {
		await this.ensureCopilotToken()

		try {
			return await super.completePrompt(prompt)
		} catch (error) {
			if (this.isAuthError(error)) {
				await this.ensureCopilotToken(true)
				return await super.completePrompt(prompt)
			}

			throw error
		}
	}

	override getModel() {
		const id = this.options.githubCopilotModelId ?? githubCopilotDefaultModelId
		const copilotInfo = (githubCopilotModels as Record<string, ModelInfo>)[id]
		const info: ModelInfo = {
			...openAiModelInfoSaneDefaults,
			...NATIVE_TOOL_DEFAULTS,
			...(copilotInfo ?? {}),
		}
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })
		return { id, info, ...params }
	}

	private async ensureCopilotToken(forceRefresh = false): Promise<string> {
		if (!forceRefresh && !this.shouldRefreshToken()) {
			return this.copilotToken ?? ""
		}

		if (this.copilotTokenRequest) {
			return this.copilotTokenRequest
		}

		const githubToken = resolveGitHubCopilotToken(this.options.githubCopilotToken)
		if (!githubToken) {
			throw new Error("Missing GitHub Copilot token. Run `kilocode auth` to authenticate.")
		}

		this.copilotTokenRequest = (async () => {
			const result = await fetchCopilotToken(githubToken)
			this.copilotToken = result.token
			this.copilotTokenExpiresAt = result.expiresAt
			this.copilotTokenRefreshAt = result.refreshAt
			this.client.apiKey = result.token
			return result.token
		})()

		try {
			return await this.copilotTokenRequest
		} finally {
			this.copilotTokenRequest = undefined
		}
	}

	private shouldRefreshToken(): boolean {
		if (!this.copilotToken) {
			return true
		}

		const now = Date.now()
		if (this.copilotTokenRefreshAt) {
			return now >= this.copilotTokenRefreshAt - COPILOT_TOKEN_REFRESH_BUFFER_MS
		}

		if (this.copilotTokenExpiresAt) {
			return now >= this.copilotTokenExpiresAt - COPILOT_TOKEN_REFRESH_BUFFER_MS
		}

		return false
	}

	private isAuthError(error: unknown): boolean {
		if (!error || typeof error !== "object") {
			return false
		}

		const status = "status" in error ? Number((error as { status?: number }).status) : undefined
		if (status === 401 || status === 403) {
			return true
		}

		const message = error instanceof Error ? error.message : ""
		return /unauthorized|invalid token|not authenticated|authentication|401|403/i.test(message)
	}
}
