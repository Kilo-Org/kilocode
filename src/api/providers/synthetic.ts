// kilocode_change - provider added

import { Anthropic } from "@anthropic-ai/sdk"
import OpenAI from "openai"

import { type SyntheticModelId, syntheticDefaultModelId, syntheticModels } from "@roo-code/types"

import type { ApiHandlerOptions, ModelRecord } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"
import { getModels } from "./fetchers/modelCache"
import { getModelParams } from "../transform/model-params"
import { ApiStream } from "../transform/stream"
import type { ApiHandlerCreateMessageMetadata } from "../index"

export class SyntheticHandler extends BaseOpenAiCompatibleProvider<SyntheticModelId> {
	protected models: ModelRecord = {}

	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Synthetic",
			baseURL: "https://api.synthetic.new/openai/v1",
			apiKey: options.syntheticApiKey,
			defaultProviderModelId: syntheticDefaultModelId,
			providerModels: syntheticModels,
			defaultTemperature: 0.5,
		})
	}

	public async fetchModel() {
		this.models = await getModels({ provider: "synthetic", apiKey: this.options.apiKey })
		return this.getModel()
	}

	override getModel() {
		const requestedId = (this.options.apiModelId as SyntheticModelId) ?? syntheticDefaultModelId
		let id = requestedId
		let info = this.models[id] ?? syntheticModels[id]

		// Debug logging
		console.log(`[SYNTHETIC_HANDLER] Requested model: ${requestedId}`)
		console.log(`[SYNTHETIC_HANDLER] Available API models:`, Object.keys(this.models))
		console.log(`[SYNTHETIC_HANDLER] Static models:`, Object.keys(syntheticModels))

		// If the requested model is not available from API or static config, fall back to default
		if (!info) {
			console.warn(`[SYNTHETIC_HANDLER] Model ${id} not found, trying default model`)
			// Try to use the default model
			id = syntheticDefaultModelId
			info = this.models[id] ?? syntheticModels[id]

			// If default is also not available, fall back to GLM-4.6 as a last resort
			if (!info) {
				console.warn(
					`[SYNTHETIC_HANDLER] Default model ${syntheticDefaultModelId} not found, falling back to GLM-4.6`,
				)
				id = "hf:zai-org/GLM-4.6"
				info = this.models[id] ?? syntheticModels[id]
			}
		}

		console.log(`[SYNTHETIC_HANDLER] Using model: ${id}`)

		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
		})

		return { id, info, ...params }
	}
	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		await this.fetchModel()
		yield* super.createMessage(systemPrompt, messages, metadata)
	}

	override async completePrompt(prompt: string): Promise<string> {
		await this.fetchModel()
		return super.completePrompt(prompt)
	}
}
