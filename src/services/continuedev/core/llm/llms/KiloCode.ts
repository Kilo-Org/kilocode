import { ChatMessage, CompletionOptions, LLMOptions } from "../../index.js"
import { getKiloUrlFromToken } from "@roo-code/types"
import {
	X_KILOCODE_VERSION,
	X_KILOCODE_ORGANIZATIONID,
	X_KILOCODE_TASKID,
	X_KILOCODE_PROJECTID,
	X_KILOCODE_TESTER,
} from "../../../../../shared/kilocode/headers"
import { Package } from "../../../../../shared/package"
import OpenRouter from "./OpenRouter"
import { streamSse } from "../../fetch/stream.js"

/**
 * Extended CompletionOptions to include KiloCode-specific per-request metadata
 */
export interface KiloCodeCompletionOptions extends CompletionOptions {
	kilocodeTaskId?: string
	kilocodeProjectId?: string
}

/**
 * KiloCode LLM provider that extends OpenRouter with KiloCode-specific features:
 * - Custom base URL using getKiloUrlFromToken()
 * - KiloCode-specific headers (organizationId, taskId, projectId, version, tester)
 * - Support for both static (organizationId) and per-request (taskId, projectId) metadata
 *
 * This provider maintains API parity with the kilocode-openrouter API provider
 * while working within the continuedev LLM architecture.
 */
class KiloCode extends OpenRouter {
	static override providerName = "kilocode"

	// Instance variables to store per-request metadata
	private currentTaskId?: string
	private currentProjectId?: string
	private organizationId?: string
	private testerSuppressUntil?: number
	private apiFIMBase?: string

	constructor(options: LLMOptions) {
		// Extract KiloCode-specific config from env
		const kilocodeToken = options.apiKey ?? ""
		const organizationId = options.env?.kilocodeOrganizationId as string | undefined
		const testerSuppressUntil = options.env?.kilocodeTesterWarningsDisabledUntil as number | undefined

		// Transform apiBase to use KiloCode backend
		const transformedOptions = {
			...options,
			apiBase: getKiloUrlFromToken("https://api.kilocode.ai/api/openrouter/v1/", kilocodeToken),
		}

		super(transformedOptions)

		// Store static metadata
		this.organizationId = organizationId
		this.testerSuppressUntil = testerSuppressUntil
		this.apiFIMBase = getKiloUrlFromToken("https://api.kilocode.ai/api/", kilocodeToken)
	}

	/**
	 * Override _streamChat to extract per-request metadata from options
	 * This allows dynamic taskId and projectId per request
	 */
	protected override async *_streamChat(
		messages: ChatMessage[],
		signal: AbortSignal,
		options: CompletionOptions,
	): AsyncGenerator<ChatMessage> {
		// Extract KiloCode metadata from options if available
		const kilocodeOptions = options as KiloCodeCompletionOptions
		this.currentTaskId = kilocodeOptions.kilocodeTaskId
		this.currentProjectId = kilocodeOptions.kilocodeProjectId

		try {
			// Call parent implementation
			yield* super._streamChat(messages, signal, options)
		} finally {
			// Clear per-request metadata after stream completes
			this.currentTaskId = undefined
			this.currentProjectId = undefined
		}
	}

	/**
	 * Override _streamComplete to support per-request metadata
	 */
	protected override async *_streamComplete(
		prompt: string,
		signal: AbortSignal,
		options: CompletionOptions,
	): AsyncGenerator<string> {
		// Extract metadata (same pattern as _streamChat)
		const kilocodeOptions = options as KiloCodeCompletionOptions
		this.currentTaskId = kilocodeOptions.kilocodeTaskId
		this.currentProjectId = kilocodeOptions.kilocodeProjectId

		try {
			yield* super._streamComplete(prompt, signal, options)
		} finally {
			// Clear metadata
			this.currentTaskId = undefined
			this.currentProjectId = undefined
		}
	}

	/**
	 * Override _streamFim to support per-request metadata
	 */
	protected override async *_streamFim(
		prefix: string,
		suffix: string,
		signal: AbortSignal,
		options: CompletionOptions,
	): AsyncGenerator<string> {
		// Extract metadata (same pattern as _streamChat)
		const kilocodeOptions = options as KiloCodeCompletionOptions
		this.currentTaskId = kilocodeOptions.kilocodeTaskId
		this.currentProjectId = kilocodeOptions.kilocodeProjectId

		const endpoint = new URL("fim/completions", this.apiFIMBase)

		try {
			const resp = await fetch(endpoint, {
				method: "POST",
				body: JSON.stringify({
					model: options.model,
					prompt: prefix,
					suffix,
					max_tokens: options.maxTokens,
					temperature: options.temperature,
					top_p: options.topP,
					frequency_penalty: options.frequencyPenalty,
					presence_penalty: options.presencePenalty,
					stop: options.stop,
					stream: true,
					...this.extraBodyProperties(),
				}),
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					"x-api-key": this.apiKey ?? "",
					Authorization: `Bearer ${this.apiKey}`,
				},
				signal,
			})
			for await (const chunk of streamSse(resp)) {
				yield chunk.choices[0].delta.content
			}
		} finally {
			// Clear metadata
			this.currentTaskId = undefined
			this.currentProjectId = undefined
		}
	}

	/**
	 * Override _getHeaders to inject KiloCode-specific headers
	 * Reads from both static (organizationId) and per-request (taskId, projectId) metadata
	 */
	protected override _getHeaders() {
		const baseHeaders = super._getHeaders()

		// Build KiloCode-specific headers
		const kilocodeHeaders: Record<string, string> = {
			[X_KILOCODE_VERSION]: Package.version,
		}

		// Add organization ID (static, from LLMOptions.env)
		if (this.organizationId) {
			kilocodeHeaders[X_KILOCODE_ORGANIZATIONID] = this.organizationId
		}

		// Add task ID (per-request, from options)
		if (this.currentTaskId) {
			kilocodeHeaders[X_KILOCODE_TASKID] = this.currentTaskId
		}

		// Add project ID (per-request, only if organizationId is set)
		if (this.organizationId && this.currentProjectId) {
			kilocodeHeaders[X_KILOCODE_PROJECTID] = this.currentProjectId
		}

		// Add tester suppression header if configured
		if (this.testerSuppressUntil && this.testerSuppressUntil > Date.now()) {
			kilocodeHeaders[X_KILOCODE_TESTER] = "SUPPRESS"
		}

		return {
			...baseHeaders,
			...kilocodeHeaders,
		}
	}

	override supportsFim(): boolean {
		if (this.model.includes("codestral")) {
			return true
		}
		return false
	}
}

export default KiloCode
