import {
	siliconCloudApiLineConfigs,
	siliconCloudDefaultApiLine,
	SiliconCloudApiLine,
	openAiModelInfoSaneDefaults,
	ModelInfo,
} from "@roo-code/types"
import axios from "axios"

import { ModelRecord } from "../../../shared/api"

interface SiliconCloudModel {
	id: string
	object: "model"
	created: number
	owned_by: string
}

interface SiliconCloudModelsResponse {
	object: "list"
	data: SiliconCloudModel[]
}

export async function getSiliconCloudModels(
	apiKey?: string,
	apiLine?: string,
	customModelInfo?: ModelInfo | null,
): Promise<ModelRecord> {
	if (!apiKey) {
		return {}
	}

	const line = (apiLine as SiliconCloudApiLine) || siliconCloudDefaultApiLine
	const baseUrl = siliconCloudApiLineConfigs[line]?.baseUrl

	if (!baseUrl) {
		return {}
	}

	const response = await axios.get<SiliconCloudModelsResponse>(`${baseUrl}/models`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	})

	const models: ModelRecord = {}
	for (const model of response.data.data) {
		const modelInfo: ModelInfo = {
			...customModelInfo,
			displayName: model.id,
			contextWindow: customModelInfo?.contextWindow || 65536,
			supportsPromptCache: customModelInfo?.supportsPromptCache || false,
		}
		console.log(model.id, modelInfo, customModelInfo)
		models[model.id] = modelInfo
	}

	return models
}
