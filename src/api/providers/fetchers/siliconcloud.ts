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
	try {
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

		// Handle malformed response data
		if (!response?.data?.data || !Array.isArray(response.data.data)) {
			return {}
		}

		const models: ModelRecord = {}
		for (const model of response.data.data) {
			// Skip invalid model entries
			if (!model || typeof model !== "object" || !model.id) {
				continue
			}

			const contextWindow = customModelInfo?.contextWindow
			const isValidContextWindow = typeof contextWindow === "number" && contextWindow > 0

			const modelInfo: ModelInfo = {
				...customModelInfo,
				displayName: model.id,
				contextWindow: isValidContextWindow ? contextWindow : 65536,
				supportsPromptCache: customModelInfo?.supportsPromptCache || false,
			}
			models[model.id] = modelInfo
		}

		return models
	} catch (error) {
		// Handle all errors gracefully - return empty object
		return {}
	}
}
