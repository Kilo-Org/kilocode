/**
 * Integration test for provider selection status bar update (kc-9sq)
 * Verifies that when a user selects a provider via /provider select,
 * the status bar immediately updates with the new provider/model info
 */

import { describe, it, expect, beforeEach } from "vitest"
import { createStore } from "jotai"
import { updateExtensionStateAtom, apiConfigurationAtom } from "../state/atoms/extension.js"
import type { ExtensionState, ProviderSettings } from "../types/messages.js"

describe("Provider Selection Status Bar Update (kc-9sq)", () => {
	let store: ReturnType<typeof createStore>

	beforeEach(() => {
		store = createStore()
	})

	it("should update apiConfigurationAtom when extension state is updated with new provider", async () => {
		// Initial state with Anthropic provider
		const initialState: ExtensionState = {
			version: "1.0.0",
			cwd: "/home/user/project",
			mode: "code",
			currentApiConfigName: "default",
			apiConfiguration: {
				id: "default",
				provider: "anthropic",
				apiKey: "sk-ant-...",
				apiModelId: "claude-3-sonnet-20240229",
				apiProvider: "anthropic",
			},
			chatMessages: [],
			currentTaskItem: null,
			currentTaskTodos: [],
			clineMessages: [],
			taskHistory: [],
			taskHistoryFullLength: 0,
			listApiConfigMeta: [],
			experiments: {},
			customModes: [],
			mcpServers: [],
			renderContext: "cli",
			kilocodeDefaultModel: "",
			kilocodeOrganizationId: undefined,
		}

		// Set initial state
		store.set(updateExtensionStateAtom, initialState)

		// Verify initial provider is Anthropic
		let currentConfig = store.get(apiConfigurationAtom)
		expect(currentConfig?.apiProvider).toBe("anthropic")
		expect(currentConfig?.apiModelId).toBe("claude-3-sonnet-20240229")

		// Simulate extension state update after user selects Z.ai provider
		// This would happen when syncConfigToExtensionEffectAtom runs after selectProviderAtom
		const updatedState: ExtensionState = {
			...initialState,
			apiConfiguration: {
				id: "default",
				provider: "zai",
				apiKey: "z-ai-key-...",
				apiModelId: "glm-4.7",
				apiProvider: "zai",
				zaiApiLine: "international_coding",
			},
		}

		// Update extension state (this is what happens when extension sends stateChange event)
		store.set(updateExtensionStateAtom, updatedState)

		// Verify provider has been updated to Z.ai
		currentConfig = store.get(apiConfigurationAtom)
		expect(currentConfig?.apiProvider).toBe("zai")
		expect(currentConfig?.apiModelId).toBe("glm-4.7")
		expect(currentConfig?.zaiApiLine).toBe("international_coding")
	})

	it("should preserve provider info across multiple state updates", async () => {
		const createState = (provider: string, model: string): ExtensionState => {
			const providerSettings: ProviderSettings = {
				id: "default",
				provider,
				apiKey: "test-key",
				apiModelId: model,
				apiProvider: provider,
			}
			return {
				version: "1.0.0",
				cwd: "/home/user/project",
				mode: "code",
				currentApiConfigName: "default",
				apiConfiguration: providerSettings,
				chatMessages: [],
				currentTaskItem: null,
				currentTaskTodos: [],
				clineMessages: [],
				taskHistory: [],
				taskHistoryFullLength: 0,
				listApiConfigMeta: [],
				experiments: {},
				customModes: [],
				mcpServers: [],
				renderContext: "cli",
				kilocodeDefaultModel: "",
				kilocodeOrganizationId: undefined,
			}
		}

		// First: Anthropic
		store.set(updateExtensionStateAtom, createState("anthropic", "claude-3-sonnet-20240229"))
		let config = store.get(apiConfigurationAtom)
		expect(config?.apiProvider).toBe("anthropic")

		// Second: Switch to OpenAI
		store.set(updateExtensionStateAtom, createState("openai", "gpt-4"))
		config = store.get(apiConfigurationAtom)
		expect(config?.apiProvider).toBe("openai")
		expect(config?.apiModelId).toBe("gpt-4")

		// Third: Switch to Z.ai
		store.set(updateExtensionStateAtom, createState("zai", "glm-4.7"))
		config = store.get(apiConfigurationAtom)
		expect(config?.apiProvider).toBe("zai")
		expect(config?.apiModelId).toBe("glm-4.7")

		// Fourth: Switch back to Anthropic
		store.set(updateExtensionStateAtom, createState("anthropic", "claude-3-haiku-20240307"))
		config = store.get(apiConfigurationAtom)
		expect(config?.apiProvider).toBe("anthropic")
		expect(config?.apiModelId).toBe("claude-3-haiku-20240307")
	})

	it("should handle null apiConfiguration gracefully", () => {
		const state: ExtensionState = {
			version: "1.0.0",
			cwd: "/home/user/project",
			mode: "code",
			currentApiConfigName: "default",
			apiConfiguration: {
				id: "default",
				provider: "anthropic",
				apiKey: "test-key",
				apiModelId: "claude-3-sonnet-20240229",
				apiProvider: "anthropic",
			},
			chatMessages: [],
			currentTaskItem: null,
			currentTaskTodos: [],
			clineMessages: [],
			taskHistory: [],
			taskHistoryFullLength: 0,
			listApiConfigMeta: [],
			experiments: {},
			customModes: [],
			mcpServers: [],
			renderContext: "cli",
			kilocodeDefaultModel: "",
			kilocodeOrganizationId: undefined,
		}

		store.set(updateExtensionStateAtom, state)
		let config = store.get(apiConfigurationAtom)
		expect(config?.apiProvider).toBe("anthropic")

		// Clear state
		store.set(updateExtensionStateAtom, null)
		config = store.get(apiConfigurationAtom)
		expect(config).toBeNull()
	})
})
