// kilocode_change - file added
import type { ModelInfo } from "../model.js"

// https://endpoints.ai.cloud.ovh.net/docs
export const ovhCloudAiEndpointsDefaultModelId = "gpt-oss-120b"

export const ovhCloudAiEndpointsDefaultModelInfo: ModelInfo = {
	maxTokens: 131000,
	contextWindow: 131000,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 0.08,
	outputPrice: 0.4,
	description:
		"gpt-oss-120b is a cutting-edge model designed for high-level reasoning, instruction-following, and advanced agent capabilities.",
	supportsReasoningEffort: true,
}
