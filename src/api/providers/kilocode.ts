import { Anthropic } from "@anthropic-ai/sdk"
import { Stream as AnthropicStream } from "@anthropic-ai/sdk/streaming"
import { CacheControlEphemeral } from "@anthropic-ai/sdk/resources"
import { anthropicDefaultModelId, anthropicModels, ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from "./constants"
import { SingleCompletionHandler } from "../index"
import { KilocodeOpenrouterHandler } from "./kilocode-openrouter"
import { getModelParams } from "../getModelParams"

export class KiloCodeHandler extends BaseProvider implements SingleCompletionHandler {
	private handler: BaseProvider & SingleCompletionHandler
	private options: ApiHandlerOptions

	constructor(options: ApiHandlerOptions) {
		super()
		this.options = options
		const modelType = options.kilocodeModel || "claude37"

		const openrouterModels = ["claude37", "gemini25", "gpt41", "gemini25flashpreview"]

		if (openrouterModels.includes(modelType)) {
			// Determine the correct OpenRouter model ID based on the selected KiloCode model type
			const baseUri = getKiloBaseUri(options)
			const openrouterOptions = {
				...options,
				openRouterBaseUrl: `${baseUri}/api/openrouter/`,
				openRouterApiKey: options.kilocodeToken,
			}

			this.handler = new KilocodeOpenrouterHandler(openrouterOptions)
		} else {
			throw new Error("Invalid KiloCode provider")
		}
	}

	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		yield* this.handler.createMessage(systemPrompt, messages)
	}

	getModel(): { id: string; info: ModelInfo } {
		return this.handler.getModel()
	}

	override countTokens(content: Array<Anthropic.Messages.ContentBlockParam>): Promise<number> {
		if (this.handler.countTokens) {
			return this.handler.countTokens(content)
		} else {
			// Fallback to the base provider's implementation
			return super.countTokens(content)
		}
	}

	async completePrompt(prompt: string) {
		return this.handler.completePrompt(prompt)
	}
}

function getKiloBaseUri(options: ApiHandlerOptions) {
	try {
		const token = options.kilocodeToken as string
		const payload_string = token.split(".")[1]
		const payload = JSON.parse(Buffer.from(payload_string, "base64").toString())
		//note: this is UNTRUSTED, so we need to make sure we're OK with this being manipulated by an attacker; e.g. we should not read uri's from the JWT directly.
		if (payload.env === "development") return "http://localhost:3000"
	} catch (_error) {
		console.warn("Failed to get base URL from Kilo Code token")
	}
	return "https://kilocode.ai"
}
