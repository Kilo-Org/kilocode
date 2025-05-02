import { Anthropic } from "@anthropic-ai/sdk"
import { ApiHandlerOptions, ModelInfo } from "../../shared/api"
import { ApiStream } from "../transform/stream"
import { BaseProvider } from "./base-provider"
import { SingleCompletionHandler } from "../index"
import { KilocodeOpenrouterHandler } from "./kilocode-openrouter"

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
