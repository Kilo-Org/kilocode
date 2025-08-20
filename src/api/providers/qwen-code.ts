// kilocode_change -- file added

import type { Anthropic } from "@anthropic-ai/sdk"
import { promises as fs } from "node:fs"
import * as os from "os"
import * as path from "path"
import OpenAI from "openai"

import { XmlMatcher } from "../../utils/xml-matcher"
import type { ModelInfo, QwenCodeModelId } from "@roo-code/types"
import { qwenCodeDefaultModelId, qwenCodeModels } from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"
import { t } from "../../i18n"
import { convertToOpenAiMessages } from "../transform/openai-format"
import type { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"
import type { SingleCompletionHandler, ApiHandlerCreateMessageMetadata } from "../index"
import { BaseProvider } from "./base-provider"
import { DEFAULT_HEADERS } from "./constants"

// --- Constants from qwenOAuth2.js ---

const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai"
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56"
const QWEN_DIR = ".qwen"
const QWEN_CREDENTIAL_FILENAME = "oauth_creds.json"

interface QwenOAuthCredentials {
	access_token: string
	refresh_token: string
	token_type: string
	expiry_date: number
	resource_url?: string
}

function getQwenCachedCredentialPath(): string {
	return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME)
}

function objectToUrlEncoded(data: Record<string, string>): string {
	return Object.keys(data)
		.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
		.join("&")
}

export class QwenCodeHandler extends BaseProvider implements SingleCompletionHandler {
	protected options: ApiHandlerOptions
	private credentials: QwenOAuthCredentials | null = null
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		// Create the client instance once in the constructor.
		// The API key will be updated dynamically via ensureAuthenticated.
		this.client = new OpenAI({
			apiKey: "dummy-key-will-be-replaced",
			baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", // A default base URL
			defaultHeaders: DEFAULT_HEADERS,
		})
	}

	private async loadCachedQwenCredentials(): Promise<QwenOAuthCredentials> {
		try {
			const keyFile = getQwenCachedCredentialPath()
			const credsStr = await fs.readFile(keyFile, "utf-8")
			return JSON.parse(credsStr)
		} catch (error) {
			console.error(`Error reading or parsing credentials file at ${getQwenCachedCredentialPath()}`)
			throw new Error(t("common:errors.qwenCode.oauthLoadFailed", { error }))
		}
	}

	private async refreshAccessToken(credentials: QwenOAuthCredentials): Promise<QwenOAuthCredentials> {
		if (!credentials.refresh_token) {
			throw new Error("No refresh token available in credentials.")
		}

		const bodyData = {
			grant_type: "refresh_token",
			refresh_token: credentials.refresh_token,
			client_id: QWEN_OAUTH_CLIENT_ID,
		}

		const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: objectToUrlEncoded(bodyData),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Token refresh failed: ${response.status} ${response.statusText}. Response: ${errorText}`)
		}

		const tokenData = await response.json()

		if (tokenData.error) {
			throw new Error(`Token refresh failed: ${tokenData.error} - ${tokenData.error_description}`)
		}

		const newCredentials = {
			...credentials,
			access_token: tokenData.access_token,
			token_type: tokenData.token_type,
			refresh_token: tokenData.refresh_token || credentials.refresh_token,
			expiry_date: Date.now() + tokenData.expires_in * 1000,
		}

		const filePath = getQwenCachedCredentialPath()
		await fs.writeFile(filePath, JSON.stringify(newCredentials, null, 2))

		return newCredentials
	}

	private isTokenValid(credentials: QwenOAuthCredentials): boolean {
		const TOKEN_REFRESH_BUFFER_MS = 30 * 1000 // 30s buffer
		if (!credentials.expiry_date) {
			return false
		}
		return Date.now() < credentials.expiry_date - TOKEN_REFRESH_BUFFER_MS
	}

	private async ensureAuthenticated(): Promise<void> {
		if (!this.credentials) {
			this.credentials = await this.loadCachedQwenCredentials()
		}

		if (!this.isTokenValid(this.credentials)) {
			this.credentials = await this.refreshAccessToken(this.credentials)
		}

		// After authentication, just update the apiKey and baseURL on the existing client.
		this.client.apiKey = this.credentials.access_token
		this.client.baseURL = this.getBaseUrl(this.credentials)
	}

	private getBaseUrl(creds: QwenOAuthCredentials): string {
		let baseUrl = creds.resource_url || "https://dashscope.aliyuncs.com/compatible-mode/v1"
		if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
			baseUrl = `https://${baseUrl}`
		}
		return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`
	}

	private async callApiWithRetry<T>(apiCall: () => Promise<T>): Promise<T> {
		try {
			return await apiCall()
		} catch (error: any) {
			if (error.status === 401) {
				this.credentials = await this.refreshAccessToken(this.credentials!)
				// Just update the key, don't re-create the client
				this.client.apiKey = this.credentials.access_token
				this.client.baseURL = this.getBaseUrl(this.credentials)
				return await apiCall()
			} else {
				throw error
			}
		}
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await this.ensureAuthenticated()

		const { id: modelId, info: modelInfo } = this.getModel()

		const systemMessage: OpenAI.Chat.ChatCompletionSystemMessageParam = {
			role: "system",
			content: systemPrompt,
		}

		const convertedMessages = [systemMessage, ...convertToOpenAiMessages(messages)]

		const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
			model: modelId,
			temperature: this.options.modelTemperature ?? 0,
			messages: convertedMessages,
			stream: true,
			stream_options: { include_usage: true },
		}

		this.addMaxTokensIfNeeded(requestOptions, modelInfo)

		const stream = await this.callApiWithRetry(() => this.client!.chat.completions.create(requestOptions))

		const matcher = new XmlMatcher(
			"think",
			(chunk) =>
				({
					type: chunk.matched ? "reasoning" : "text",
					text: chunk.data,
				}) as const,
		)

		let lastUsage: any
		let fullContent = ""

		for await (const apiChunk of stream) {
			const delta = apiChunk.choices[0]?.delta ?? {}

			if (delta.content) {
				let newText = delta.content
				if (newText.startsWith(fullContent)) {
					newText = newText.substring(fullContent.length)
				}
				fullContent = delta.content

				if (newText) {
					for (const processedChunk of matcher.update(newText)) {
						yield processedChunk
					}
				}
			}

			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield {
					type: "reasoning",
					text: (delta.reasoning_content as string | undefined) || "",
				}
			}
			if (apiChunk.usage) {
				lastUsage = apiChunk.usage
			}
		}

		for (const chunk of matcher.final()) {
			yield chunk
		}

		if (lastUsage) {
			yield this.processUsageMetrics(lastUsage, modelInfo)
		}
	}

	async completePrompt(prompt: string): Promise<string> {
		await this.ensureAuthenticated()

		const { id: modelId, info: modelInfo } = this.getModel()

		const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
			model: modelId,
			messages: [{ role: "user", content: prompt }],
		}

		this.addMaxTokensIfNeeded(requestOptions, modelInfo)

		const response = await this.callApiWithRetry(() => this.client!.chat.completions.create(requestOptions))

		return response.choices[0]?.message.content || ""
	}

	override getModel() {
		const modelId = this.options.apiModelId
		const id = modelId && modelId in qwenCodeModels ? (modelId as QwenCodeModelId) : qwenCodeDefaultModelId
		const info: ModelInfo = qwenCodeModels[id]
		const params = getModelParams({ format: "openai", modelId: id, model: info, settings: this.options })

		return { id, info, ...params }
	}

	protected processUsageMetrics(usage: any, _modelInfo?: ModelInfo): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage?.prompt_tokens || 0,
			outputTokens: usage?.completion_tokens || 0,
		}
	}

	/**
	 * Adds max_completion_tokens to the request body if needed based on provider configuration
	 */
	private addMaxTokensIfNeeded(
		requestOptions:
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
			| OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
		modelInfo: ModelInfo,
	): void {
		if (this.options.includeMaxTokens === true) {
			requestOptions.max_completion_tokens = this.options.modelMaxTokens || modelInfo.maxTokens
		}
	}
}
