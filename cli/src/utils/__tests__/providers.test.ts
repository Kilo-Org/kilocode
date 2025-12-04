import { describe, it, expect } from "vitest"
import { getSelectedModelId } from "../providers.js"

describe("getSelectedModelId", () => {
	it("should return 'unknown' when apiConfiguration is undefined", () => {
		const result = getSelectedModelId("kilocode", undefined)
		expect(result).toBe("unknown")
	})

	it("should return 'unknown' when provider is unknown", () => {
		const result = getSelectedModelId("unknown", { kilocodeModel: "test-model" })
		expect(result).toBe("unknown")
	})

	it("should return 'unknown' when provider is empty", () => {
		const result = getSelectedModelId("", { kilocodeModel: "test-model" })
		expect(result).toBe("unknown")
	})

	it("should return correct model for kilocode provider", () => {
		const apiConfig = { kilocodeModel: "anthropic/claude-sonnet-4" }
		const result = getSelectedModelId("kilocode", apiConfig)
		expect(result).toBe("anthropic/claude-sonnet-4")
	})

	it("should return correct model for openrouter provider", () => {
		const apiConfig = { openRouterModelId: "openai/gpt-4" }
		const result = getSelectedModelId("openrouter", apiConfig)
		expect(result).toBe("openai/gpt-4")
	})

	it("should return correct model for ollama provider", () => {
		const apiConfig = { ollamaModelId: "llama2:7b" }
		const result = getSelectedModelId("ollama", apiConfig)
		expect(result).toBe("llama2:7b")
	})

	it("should return correct model for lmstudio provider", () => {
		const apiConfig = { lmStudioModelId: "local-model-1" }
		const result = getSelectedModelId("lmstudio", apiConfig)
		expect(result).toBe("local-model-1")
	})

	it("should return correct model for glama provider", () => {
		const apiConfig = { glamaModelId: "glama-model-1" }
		const result = getSelectedModelId("glama", apiConfig)
		expect(result).toBe("glama-model-1")
	})

	it("should return correct model for unbound provider", () => {
		const apiConfig = { unboundModelId: "unbound-model-1" }
		const result = getSelectedModelId("unbound", apiConfig)
		expect(result).toBe("unbound-model-1")
	})

	it("should return correct model for requesty provider", () => {
		const apiConfig = { requestyModelId: "requesty-model-1" }
		const result = getSelectedModelId("requesty", apiConfig)
		expect(result).toBe("requesty-model-1")
	})

	it("should return correct model for litellm provider", () => {
		const apiConfig = { litellmModelId: "litellm-model-1" }
		const result = getSelectedModelId("litellm", apiConfig)
		expect(result).toBe("litellm-model-1")
	})

	it("should return correct model for OVHcloud AI Endpoints provider", () => {
		const apiConfig = { ovhCloudAiEndpointsModelId: "ovhcloud-model" }
		const result = getSelectedModelId("ovhcloud", apiConfig)
		expect(result).toBe("ovhcloud-model")
	})

	it("should return 'unknown' when model field is not set", () => {
		const apiConfig = { someOtherField: "value" }
		const result = getSelectedModelId("kilocode", apiConfig)
		expect(result).toBe("unknown")
	})

	it("should return 'default' for providers without model selection", () => {
		const apiConfig = { apiKey: "some-key" }
		const result = getSelectedModelId("anthropic", apiConfig)
		expect(result).toBe("default")
	})

	it("should handle vscode-lm provider with selector", () => {
		const apiConfig = {
			vsCodeLmModelSelector: {
				vendor: "microsoft",
				family: "copilot",
			},
		}
		const result = getSelectedModelId("vscode-lm", apiConfig)
		expect(result).toBe("microsoft/copilot")
	})

	it("should return 'unknown' for vscode-lm without proper selector", () => {
		const apiConfig = {
			vsCodeLmModelSelector: {},
		}
		const result = getSelectedModelId("vscode-lm", apiConfig)
		expect(result).toBe("unknown")
	})

	it("should handle mixed case provider names", () => {
		const apiConfig = { kilocodeModel: "test-model" }
		const result = getSelectedModelId("KiloCode", apiConfig)
		expect(result).toBe("default") // Will be treated as unknown provider
	})
})
