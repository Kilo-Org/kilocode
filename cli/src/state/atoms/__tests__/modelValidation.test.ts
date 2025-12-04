/**
 * Tests for model validation atom
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { createStore } from "jotai"
import { validateModelOnRouterModelsUpdateAtom } from "../modelValidation.js"
import { extensionStateAtom, routerModelsAtom } from "../extension.js"
import { configAtom } from "../config.js"
import type { CLIConfig } from "../../../config/types.js"
import type { ModelRecord, RouterModels } from "../../../constants/providers/models.js"
import type { ExtensionState } from "../../../types/messages.js"

// Mock the dependencies
vi.mock("../../../services/logs.js", () => ({
	logs: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock("../../../config/persistence.js", () => ({
	saveConfig: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../ui/utils/messages.js", () => ({
	generateModelFallbackMessage: vi.fn().mockReturnValue({
		type: "say",
		say: "Model switched",
		ts: Date.now(),
	}),
}))

vi.mock("../ui.js", async () => {
	const { atom } = await import("jotai")
	return {
		addMessageAtom: atom(null, () => {}),
	}
})

describe("modelValidation atom", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
		vi.clearAllMocks()
	})

	const createConfig = (model: string, token?: string, orgId?: string): CLIConfig => ({
		version: "1.0.0",
		mode: "code",
		telemetry: false,
		provider: "test-provider",
		providers: [
			{
				id: "test-provider",
				provider: "kilocode",
				kilocodeModel: model,
				kilocodeToken: token,
				kilocodeOrganizationId: orgId,
			},
		],
	})

	const createRouterModels = (models: string[]): RouterModels => {
		const modelRecord: ModelRecord = {}
		models.forEach((model) => {
			modelRecord[model] = {
				contextWindow: 200000,
				supportsPromptCache: true,
			}
		})
		return {
			kilocode: modelRecord,
		} as RouterModels
	}

	const createExtensionState = (defaultModel?: string): ExtensionState => ({
		version: "1.0.0",
		apiConfiguration: {},
		chatMessages: [],
		mode: "code",
		customModes: [],
		taskHistoryFullLength: 0,
		taskHistoryVersion: 0,
		renderContext: "cli",
		telemetrySetting: "disabled",
		kilocodeDefaultModel: defaultModel,
	})

	describe("when model is valid", () => {
		it("should not change model when current model is available", async () => {
			const config = createConfig("claude-sonnet-4", "test-token")
			const routerModels = createRouterModels(["claude-sonnet-4", "claude-haiku"])

			store.set(configAtom, config)
			store.set(routerModelsAtom, routerModels)

			await store.set(validateModelOnRouterModelsUpdateAtom)

			// Model should remain unchanged
			const updatedConfig = store.get(configAtom)
			expect(updatedConfig.providers[0].kilocodeModel).toBe("claude-sonnet-4")
		})
	})

	describe("when model is invalid", () => {
		it("should use extension state default model when available in router models", async () => {
			const config = createConfig("gpt-4", "test-token")
			const routerModels = createRouterModels(["claude-sonnet-4", "claude-haiku"])
			const extensionState = createExtensionState("claude-haiku")

			store.set(configAtom, config)
			store.set(routerModelsAtom, routerModels)
			store.set(extensionStateAtom, extensionState)

			await store.set(validateModelOnRouterModelsUpdateAtom)

			// Model should be updated to extension state default
			const updatedConfig = store.get(configAtom)
			expect(updatedConfig.providers[0].kilocodeModel).toBe("claude-haiku")
		})

		it("should fall back to first available model when extension state default is not set", async () => {
			const config = createConfig("gpt-4", "test-token")
			const routerModels = createRouterModels(["claude-sonnet-4", "claude-haiku"])
			const extensionState = createExtensionState()

			store.set(configAtom, config)
			store.set(routerModelsAtom, routerModels)
			store.set(extensionStateAtom, extensionState)

			await store.set(validateModelOnRouterModelsUpdateAtom)

			// Model should fall back to first available
			const updatedConfig = store.get(configAtom)
			expect(updatedConfig.providers[0].kilocodeModel).toBe("claude-sonnet-4")
		})

		it("should use extension state default model even if not in router models", async () => {
			const config = createConfig("gpt-4", "test-token")
			const routerModels = createRouterModels(["claude-sonnet-4", "claude-haiku"])
			const extensionState = createExtensionState("gpt-4-turbo")

			store.set(configAtom, config)
			store.set(routerModelsAtom, routerModels)
			store.set(extensionStateAtom, extensionState)

			await store.set(validateModelOnRouterModelsUpdateAtom)

			// Model uses extension state default even if not in router models
			// Note: This may be a bug - the model should be validated against available models
			const updatedConfig = store.get(configAtom)
			expect(updatedConfig.providers[0].kilocodeModel).toBe("gpt-4-turbo")
		})
	})

	describe("edge cases", () => {
		it("should skip validation for non-kilocode providers", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "test-provider",
				providers: [
					{
						id: "test-provider",
						provider: "anthropic",
						apiModelId: "claude-3-opus",
					},
				],
			}

			store.set(configAtom, config)
			store.set(routerModelsAtom, createRouterModels(["claude-sonnet-4"]))

			await store.set(validateModelOnRouterModelsUpdateAtom)

			// Config should remain unchanged for non-kilocode provider
			const updatedConfig = store.get(configAtom)
			expect(updatedConfig.providers[0].provider).toBe("anthropic")
		})

		it("should skip validation when no router models available", async () => {
			const config = createConfig("claude-sonnet-4", "test-token")

			store.set(configAtom, config)
			store.set(routerModelsAtom, undefined as unknown as RouterModels)

			await store.set(validateModelOnRouterModelsUpdateAtom)

			// Config should remain unchanged without router models
			const updatedConfig = store.get(configAtom)
			expect(updatedConfig.providers[0].kilocodeModel).toBe("claude-sonnet-4")
		})

		it("should skip validation when no current model set", async () => {
			const config: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "test-provider",
				providers: [
					{
						id: "test-provider",
						provider: "kilocode",
						kilocodeToken: "test-token",
					},
				],
			}

			store.set(configAtom, config)
			store.set(routerModelsAtom, createRouterModels(["claude-sonnet-4"]))

			await store.set(validateModelOnRouterModelsUpdateAtom)

			// Config should remain unchanged without current model
			const updatedConfig = store.get(configAtom)
			expect(updatedConfig.providers[0].kilocodeModel).toBeUndefined()
		})
	})
})
