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
		const id = (this.options.apiModelId as SyntheticModelId) ?? syntheticDefaultModelId
		const info = this.models[id] ?? syntheticModels[id] ?? syntheticModels[syntheticDefaultModelId]

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
