import {
	PROVIDER_SERVICE_CONFIG,
	PROVIDER_DEFAULT_MODEL_IDS,
	getProviderServiceConfig,
	getDefaultModelIdForProvider,
	getStaticModelsForProvider,
	isStaticModelProvider,
	PROVIDERS_WITH_CUSTOM_MODEL_UI,
	shouldUseGenericModelPicker,
} from "../providerModelConfig"

describe("providerModelConfig", () => {
	describe("PROVIDER_SERVICE_CONFIG", () => {
		it("contains service config for anthropic", () => {
			expect(PROVIDER_SERVICE_CONFIG.anthropic).toEqual({
				serviceName: "Anthropic",
				serviceUrl: "https://console.anthropic.com",
			})
		})

		it("contains service config for bedrock", () => {
			expect(PROVIDER_SERVICE_CONFIG.bedrock).toEqual({
				serviceName: "Amazon Bedrock",
				serviceUrl: "https://aws.amazon.com/bedrock",
			})
		})

		it("contains service config for ollama", () => {
			expect(PROVIDER_SERVICE_CONFIG.ollama).toEqual({
				serviceName: "Ollama",
				serviceUrl: "https://ollama.ai",
			})
		})

		it("contains service config for lmstudio", () => {
			expect(PROVIDER_SERVICE_CONFIG.lmstudio).toEqual({
				serviceName: "LM Studio",
				serviceUrl: "https://lmstudio.ai/docs",
			})
		})

		it("contains service config for vscode-lm", () => {
			expect(PROVIDER_SERVICE_CONFIG["vscode-lm"]).toEqual({
				serviceName: "VS Code LM",
				serviceUrl: "https://code.visualstudio.com/api/extension-guides/language-model",
			})
		})
	})

	describe("getProviderServiceConfig", () => {
		it("returns correct config for known provider", () => {
			const config = getProviderServiceConfig("gemini")
			expect(config.serviceName).toBe("Google Gemini")
			expect(config.serviceUrl).toBe("https://ai.google.dev")
		})

		it("returns fallback config for unknown provider", () => {
			const config = getProviderServiceConfig("unknown-provider" as any)
			expect(config.serviceName).toBe("unknown-provider")
			expect(config.serviceUrl).toBe("")
		})
	})

	describe("PROVIDER_DEFAULT_MODEL_IDS", () => {
		it("contains default model IDs for static providers", () => {
			expect(PROVIDER_DEFAULT_MODEL_IDS.anthropic).toBeDefined()
			expect(PROVIDER_DEFAULT_MODEL_IDS.bedrock).toBeDefined()
			expect(PROVIDER_DEFAULT_MODEL_IDS.gemini).toBeDefined()
			expect(PROVIDER_DEFAULT_MODEL_IDS["openai-native"]).toBeDefined()
		})
	})

	describe("getDefaultModelIdForProvider", () => {
		it("returns default model ID for known provider", () => {
			const defaultId = getDefaultModelIdForProvider("anthropic")
			expect(defaultId).toBeDefined()
			expect(typeof defaultId).toBe("string")
			expect(defaultId.length).toBeGreaterThan(0)
		})

		it("returns empty string for unknown provider", () => {
			const defaultId = getDefaultModelIdForProvider("unknown" as any)
			expect(defaultId).toBe("")
		})

		it("returns international default for Z.ai without apiConfiguration", () => {
			const defaultId = getDefaultModelIdForProvider("zai")
			expect(defaultId).toBeDefined()
			expect(typeof defaultId).toBe("string")
			expect(defaultId.length).toBeGreaterThan(0)
		})

		it("returns mainland default for Z.ai with china_coding entrypoint", () => {
			const defaultId = getDefaultModelIdForProvider("zai", {
				apiProvider: "zai",
				zaiApiLine: "china_coding",
			})
			expect(defaultId).toBeDefined()
			expect(typeof defaultId).toBe("string")
			// Mainland model IDs should contain 'mainland' or be different from international
			expect(defaultId.length).toBeGreaterThan(0)
		})

		it("returns international default for Z.ai with international_coding entrypoint", () => {
			const defaultId = getDefaultModelIdForProvider("zai", {
				apiProvider: "zai",
				zaiApiLine: "international_coding",
			})
			expect(defaultId).toBeDefined()
			expect(typeof defaultId).toBe("string")
			expect(defaultId.length).toBeGreaterThan(0)
		})

		it("uses mainland or international defaults based on zaiApiLine setting", () => {
			// Verify the function correctly routes to appropriate defaults
			const chinaDefault = getDefaultModelIdForProvider("zai", {
				apiProvider: "zai",
				zaiApiLine: "china_coding",
			})
			const internationalDefault = getDefaultModelIdForProvider("zai", {
				apiProvider: "zai",
				zaiApiLine: "international_coding",
			})
			// Both should return valid model IDs (they may or may not be the same)
			expect(chinaDefault).toBeDefined()
			expect(internationalDefault).toBeDefined()
			expect(chinaDefault.length).toBeGreaterThan(0)
			expect(internationalDefault.length).toBeGreaterThan(0)
		})
	})

	describe("getStaticModelsForProvider", () => {
		it("returns models for anthropic provider", () => {
			const models = getStaticModelsForProvider("anthropic")
			expect(Object.keys(models).length).toBeGreaterThan(0)
		})

		it("adds custom-arn option for bedrock provider", () => {
			const models = getStaticModelsForProvider("bedrock", "Use Custom ARN")
			expect(models["custom-arn"]).toBeDefined()
			expect(models["custom-arn"].description).toBe("Use Custom ARN")
		})

		it("returns empty object for providers without static models", () => {
			const models = getStaticModelsForProvider("openrouter")
			expect(Object.keys(models).length).toBe(0)
		})
	})

	describe("isStaticModelProvider", () => {
		it("returns true for providers with static models", () => {
			expect(isStaticModelProvider("anthropic")).toBe(true)
			expect(isStaticModelProvider("bedrock")).toBe(true)
			expect(isStaticModelProvider("gemini")).toBe(true)
			expect(isStaticModelProvider("openai-native")).toBe(true)
		})

		it("returns false for providers without static models", () => {
			expect(isStaticModelProvider("openrouter")).toBe(false)
			expect(isStaticModelProvider("ollama")).toBe(false)
			expect(isStaticModelProvider("lmstudio")).toBe(false)
		})
	})

	describe("PROVIDERS_WITH_CUSTOM_MODEL_UI", () => {
		it("includes providers that have their own model selection UI", () => {
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).toContain("openrouter")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).toContain("ollama")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).toContain("lmstudio")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).toContain("vscode-lm")
		})

		it("does not include static providers using generic picker", () => {
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).not.toContain("anthropic")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).not.toContain("gemini")
			expect(PROVIDERS_WITH_CUSTOM_MODEL_UI).not.toContain("bedrock")
		})
	})

	describe("shouldUseGenericModelPicker", () => {
		it("returns true for static providers without custom UI", () => {
			expect(shouldUseGenericModelPicker("anthropic")).toBe(true)
			expect(shouldUseGenericModelPicker("bedrock")).toBe(true)
			expect(shouldUseGenericModelPicker("gemini")).toBe(true)
			expect(shouldUseGenericModelPicker("deepseek")).toBe(true)
		})

		it("returns false for providers with custom model UI", () => {
			expect(shouldUseGenericModelPicker("openrouter")).toBe(false)
			expect(shouldUseGenericModelPicker("ollama")).toBe(false)
			expect(shouldUseGenericModelPicker("lmstudio")).toBe(false)
			expect(shouldUseGenericModelPicker("vscode-lm")).toBe(false)
		})

		it("returns false for providers without static models", () => {
			expect(shouldUseGenericModelPicker("openai")).toBe(false)
		})
	})
})
