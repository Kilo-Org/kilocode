// npx vitest core/config/__tests__/ContextProxy.spec.ts

import * as vscode from "vscode"

import { GLOBAL_STATE_KEYS, SECRET_STATE_KEYS, GLOBAL_SECRET_KEYS } from "@roo-code/types"

import { ContextProxy } from "../ContextProxy"

vi.mock("vscode", () => ({
	Uri: {
		file: vi.fn((path) => ({ path })),
	},
	ExtensionMode: {
		Development: 1,
		Production: 2,
		Test: 3,
	},
}))

describe("ContextProxy", () => {
	let proxy: ContextProxy
	let mockContext: any
	let mockGlobalState: any
	let mockSecrets: any

	beforeEach(async () => {
		// Reset mocks
		vi.clearAllMocks()

		// Mock globalState
		mockGlobalState = {
			get: vi.fn(),
			update: vi.fn().mockResolvedValue(undefined),
		}

		// Mock secrets
		mockSecrets = {
			get: vi.fn().mockResolvedValue("test-secret"),
			store: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
		}

		// Mock the extension context
		mockContext = {
			globalState: mockGlobalState,
			secrets: mockSecrets,
			extensionUri: { path: "/test/extension" },
			extensionPath: "/test/extension",
			globalStorageUri: { path: "/test/storage" },
			logUri: { path: "/test/logs" },
			extension: { packageJSON: { version: "1.0.0" } },
			extensionMode: vscode.ExtensionMode.Development,
		}

		// Create proxy instance
		proxy = new ContextProxy(mockContext)
		await proxy.initialize()
	})

	describe("read-only pass-through properties", () => {
		it("should return extension properties from the original context", () => {
			expect(proxy.extensionUri).toBe(mockContext.extensionUri)
			expect(proxy.extensionPath).toBe(mockContext.extensionPath)
			expect(proxy.globalStorageUri).toBe(mockContext.globalStorageUri)
			expect(proxy.logUri).toBe(mockContext.logUri)
			expect(proxy.extension).toBe(mockContext.extension)
			expect(proxy.extensionMode).toBe(mockContext.extensionMode)
		})
	})

	describe("constructor", () => {
		it("should initialize state cache with all global state keys", () => {
			// +3 for the migration checks:
			// 1. openRouterImageGenerationSettings
			// 2. customCondensingPrompt
			// 3. customSupportPrompts (for migrateOldDefaultCondensingPrompt)
			expect(mockGlobalState.get).toHaveBeenCalledTimes(GLOBAL_STATE_KEYS.length + 3)
			for (const key of GLOBAL_STATE_KEYS) {
				expect(mockGlobalState.get).toHaveBeenCalledWith(key)
			}
			// Also check for migration calls
			expect(mockGlobalState.get).toHaveBeenCalledWith("openRouterImageGenerationSettings")
			expect(mockGlobalState.get).toHaveBeenCalledWith("customCondensingPrompt")
			expect(mockGlobalState.get).toHaveBeenCalledWith("customSupportPrompts")
		})

		it("should initialize secret cache with all secret keys", () => {
			expect(mockSecrets.get).toHaveBeenCalledTimes(SECRET_STATE_KEYS.length + GLOBAL_SECRET_KEYS.length)
			for (const key of SECRET_STATE_KEYS) {
				expect(mockSecrets.get).toHaveBeenCalledWith(key)
			}
			for (const key of GLOBAL_SECRET_KEYS) {
				expect(mockSecrets.get).toHaveBeenCalledWith(key)
			}
		})
	})

	describe("getGlobalState", () => {
		it("should return value from cache when it exists", async () => {
			// Manually set a value in the cache
			await proxy.updateGlobalState("apiProvider", "deepseek")

			// Should return the cached value
			const result = proxy.getGlobalState("apiProvider")
			expect(result).toBe("deepseek")

			// Original context should be called once during updateGlobalState (+3 for migration checks)
			expect(mockGlobalState.get).toHaveBeenCalledTimes(GLOBAL_STATE_KEYS.length + 3) // From initialization + migration checks
		})

		it("should handle default values correctly", async () => {
			// No value in cache
			const result = proxy.getGlobalState("apiProvider", "deepseek")
			expect(result).toBe("deepseek")
		})

		it("should bypass cache for pass-through state keys", async () => {
			// Setup mock return value
			mockGlobalState.get.mockReturnValue("pass-through-value")

			// Use a pass-through key (taskHistory)
			const result = proxy.getGlobalState("taskHistory")

			// Should get value directly from original context
			expect(result).toBe("pass-through-value")
			expect(mockGlobalState.get).toHaveBeenCalledWith("taskHistory")
		})

		it("should respect default values for pass-through state keys", async () => {
			// Setup mock to return undefined
			mockGlobalState.get.mockReturnValue(undefined)

			// Use a pass-through key with default value
			const historyItems = [
				{
					id: "1",
					number: 1,
					ts: 1,
					task: "test",
					tokensIn: 1,
					tokensOut: 1,
					totalCost: 1,
				},
			]

			const result = proxy.getGlobalState("taskHistory", historyItems)

			// Should return default value when original context returns undefined
			expect(result).toBe(historyItems)
		})
	})

	describe("updateGlobalState", () => {
		it("should update state directly in original context", async () => {
			await proxy.updateGlobalState("apiProvider", "deepseek")

			// Should have called original context
			expect(mockGlobalState.update).toHaveBeenCalledWith("apiProvider", "deepseek")

			// Should have stored the value in cache
			const storedValue = await proxy.getGlobalState("apiProvider")
			expect(storedValue).toBe("deepseek")
		})

		it("should bypass cache for pass-through state keys", async () => {
			const historyItems = [
				{
					id: "1",
					number: 1,
					ts: 1,
					task: "test",
					tokensIn: 1,
					tokensOut: 1,
					totalCost: 1,
				},
			]

			await proxy.updateGlobalState("taskHistory", historyItems)

			// Should update original context
			expect(mockGlobalState.update).toHaveBeenCalledWith("taskHistory", historyItems)

			// Setup mock for subsequent get
			mockGlobalState.get.mockReturnValue(historyItems)

			// Should get fresh value from original context
			const storedValue = proxy.getGlobalState("taskHistory")
			expect(storedValue).toBe(historyItems)
			expect(mockGlobalState.get).toHaveBeenCalledWith("taskHistory")
		})
	})

	describe("getSecret", () => {
		it("should return value from cache when it exists", async () => {
			// Manually set a value in the cache
			await proxy.storeSecret("apiKey", "cached-secret")

			// Should return the cached value
			const result = proxy.getSecret("apiKey")
			expect(result).toBe("cached-secret")
		})
	})

	describe("storeSecret", () => {
		it("should store secret directly in original context", async () => {
			await proxy.storeSecret("apiKey", "new-secret")

			// Should have called original context
			expect(mockSecrets.store).toHaveBeenCalledWith("apiKey", "new-secret")

			// Should have stored the value in cache
			const storedValue = await proxy.getSecret("apiKey")
			expect(storedValue).toBe("new-secret")
		})

		it("should handle undefined value for secret deletion", async () => {
			await proxy.storeSecret("apiKey", undefined)

			// Should have called delete on original context
			expect(mockSecrets.delete).toHaveBeenCalledWith("apiKey")

			// Should have stored undefined in cache
			const storedValue = await proxy.getSecret("apiKey")
			expect(storedValue).toBeUndefined()
		})
	})

	describe("setValue", () => {
		it("should route secret keys to storeSecret", async () => {
			// Spy on storeSecret
			const storeSecretSpy = vi.spyOn(proxy, "storeSecret")

			// Test with a known secret key
			await proxy.setValue("openAiApiKey", "test-api-key")

			// Should have called storeSecret
			expect(storeSecretSpy).toHaveBeenCalledWith("openAiApiKey", "test-api-key")

			// Should have stored the value in secret cache
			const storedValue = proxy.getSecret("openAiApiKey")
			expect(storedValue).toBe("test-api-key")
		})

		it("should route global state keys to updateGlobalState", async () => {
			// Spy on updateGlobalState
			const updateGlobalStateSpy = vi.spyOn(proxy, "updateGlobalState")

			// Test with a known global state key
			await proxy.setValue("apiModelId", "gpt-4")

			// Should have called updateGlobalState
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("apiModelId", "gpt-4")

			// Should have stored the value in state cache
			const storedValue = proxy.getGlobalState("apiModelId")
			expect(storedValue).toBe("gpt-4")
		})
	})

	describe("setValues", () => {
		it("should process multiple values correctly", async () => {
			// Spy on setValue
			const setValueSpy = vi.spyOn(proxy, "setValue")

			// Test with multiple values
			await proxy.setValues({
				apiModelId: "gpt-4",
				apiProvider: "openai",
				mode: "test-mode",
			})

			// Should have called setValue for each key
			expect(setValueSpy).toHaveBeenCalledTimes(3)
			expect(setValueSpy).toHaveBeenCalledWith("apiModelId", "gpt-4")
			expect(setValueSpy).toHaveBeenCalledWith("apiProvider", "openai")
			expect(setValueSpy).toHaveBeenCalledWith("mode", "test-mode")

			// Should have stored all values in state cache
			expect(proxy.getGlobalState("apiModelId")).toBe("gpt-4")
			expect(proxy.getGlobalState("apiProvider")).toBe("openai")
			expect(proxy.getGlobalState("mode")).toBe("test-mode")
		})

		it("should handle both secret and global state keys", async () => {
			// Spy on storeSecret and updateGlobalState
			const storeSecretSpy = vi.spyOn(proxy, "storeSecret")
			const updateGlobalStateSpy = vi.spyOn(proxy, "updateGlobalState")

			// Test with mixed keys
			await proxy.setValues({
				apiModelId: "gpt-4", // global state
				openAiApiKey: "test-api-key", // secret
			})

			// Should have called appropriate methods
			expect(storeSecretSpy).toHaveBeenCalledWith("openAiApiKey", "test-api-key")
			expect(updateGlobalStateSpy).toHaveBeenCalledWith("apiModelId", "gpt-4")

			// Should have stored values in appropriate caches
			expect(proxy.getSecret("openAiApiKey")).toBe("test-api-key")
			expect(proxy.getGlobalState("apiModelId")).toBe("gpt-4")
		})
	})

	describe("setProviderSettings", () => {
		it("should clear old API configuration values and set new ones", async () => {
			// Set up initial API configuration values
			await proxy.updateGlobalState("apiModelId", "old-model")
			await proxy.updateGlobalState("openAiBaseUrl", "https://old-url.com")
			await proxy.updateGlobalState("modelTemperature", 0.7)

			// Spy on setValues
			const setValuesSpy = vi.spyOn(proxy, "setValues")

			// Call setProviderSettings with new configuration
			await proxy.setProviderSettings({
				apiModelId: "new-model",
				apiProvider: "anthropic",
				// Note: openAiBaseUrl is not included in the new config
			})

			// Verify setValues was called with the correct parameters
			// It should include undefined for openAiBaseUrl (to clear it)
			// and the new values for apiModelId and apiProvider
			expect(setValuesSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					apiModelId: "new-model",
					apiProvider: "anthropic",
					openAiBaseUrl: undefined,
					modelTemperature: undefined,
				}),
			)

			// Verify the state cache has been updated correctly
			expect(proxy.getGlobalState("apiModelId")).toBe("new-model")
			expect(proxy.getGlobalState("apiProvider")).toBe("anthropic")
			expect(proxy.getGlobalState("openAiBaseUrl")).toBeUndefined()
			expect(proxy.getGlobalState("modelTemperature")).toBeUndefined()
		})

		it("should handle empty API configuration", async () => {
			// Set up initial API configuration values
			await proxy.updateGlobalState("apiModelId", "old-model")
			await proxy.updateGlobalState("openAiBaseUrl", "https://old-url.com")

			// Spy on setValues
			const setValuesSpy = vi.spyOn(proxy, "setValues")

			// Call setProviderSettings with empty configuration
			await proxy.setProviderSettings({})

			// Verify setValues was called with undefined for all existing API config keys
			expect(setValuesSpy).toHaveBeenCalledWith(
				expect.objectContaining({
					apiModelId: undefined,
					openAiBaseUrl: undefined,
				}),
			)

			// Verify the state cache has been cleared
			expect(proxy.getGlobalState("apiModelId")).toBeUndefined()
			expect(proxy.getGlobalState("openAiBaseUrl")).toBeUndefined()
		})
	})

	describe("resetAllState", () => {
		it("should clear all in-memory caches", async () => {
			// Setup initial state in caches
			await proxy.setValues({
				apiModelId: "gpt-4", // global state
				openAiApiKey: "test-api-key", // secret
			})

			// Verify initial state
			expect(proxy.getGlobalState("apiModelId")).toBe("gpt-4")
			expect(proxy.getSecret("openAiApiKey")).toBe("test-api-key")

			// Reset all state
			await proxy.resetAllState()

			// Caches should be reinitialized with values from the context
			// Since our mock globalState.get returns undefined by default,
			// the cache should now contain undefined values
			expect(proxy.getGlobalState("apiModelId")).toBeUndefined()
		})

		it("should update all global state keys to undefined", async () => {
			// Setup initial state
			await proxy.updateGlobalState("apiModelId", "gpt-4")
			await proxy.updateGlobalState("apiProvider", "openai")

			// Reset all state
			await proxy.resetAllState()

			// Should have called update with undefined for each key
			for (const key of GLOBAL_STATE_KEYS) {
				expect(mockGlobalState.update).toHaveBeenCalledWith(key, undefined)
			}

			// Total calls should include initial setup + reset operations
			const expectedUpdateCalls = 2 + GLOBAL_STATE_KEYS.length
			expect(mockGlobalState.update).toHaveBeenCalledTimes(expectedUpdateCalls)
		})

		it("should delete all secrets", async () => {
			// Setup initial secrets
			await proxy.storeSecret("apiKey", "test-api-key")
			await proxy.storeSecret("openAiApiKey", "test-openai-key")

			// Reset all state
			await proxy.resetAllState()

			// Should have called delete for each key
			for (const key of SECRET_STATE_KEYS) {
				expect(mockSecrets.delete).toHaveBeenCalledWith(key)
			}
			for (const key of GLOBAL_SECRET_KEYS) {
				expect(mockSecrets.delete).toHaveBeenCalledWith(key)
			}

			// Total calls should equal the number of secret keys
			expect(mockSecrets.delete).toHaveBeenCalledTimes(SECRET_STATE_KEYS.length + GLOBAL_SECRET_KEYS.length)
		})

		it("should reinitialize caches after reset", async () => {
			// Spy on initialization methods
			const initializeSpy = vi.spyOn(proxy as any, "initialize")

			// Reset all state
			await proxy.resetAllState()

			// Should reinitialize caches
			expect(initializeSpy).toHaveBeenCalledTimes(1)
		})
	})

	describe("invalid apiProvider migration", () => {
		it("should clear invalid apiProvider from storage during initialization", async () => {
			// Reset and create a new proxy with invalid provider in state
			vi.clearAllMocks()
			mockGlobalState.get.mockImplementation((key: string) => {
				if (key === "apiProvider") {
					return "invalid-removed-provider" // Invalid/removed provider
				}
				return undefined
			})

			const proxyWithInvalidProvider = new ContextProxy(mockContext)
			await proxyWithInvalidProvider.initialize()

			// Should have cleared the invalid apiProvider
			expect(mockGlobalState.update).toHaveBeenCalledWith("apiProvider", undefined)
		})

		it("should not modify valid apiProvider during initialization", async () => {
			// Reset and create a new proxy with valid provider in state
			vi.clearAllMocks()
			mockGlobalState.get.mockImplementation((key: string) => {
				if (key === "apiProvider") {
					return "anthropic" // Valid provider
				}
				return undefined
			})

			const proxyWithValidProvider = new ContextProxy(mockContext)
			await proxyWithValidProvider.initialize()

			// Should NOT have called update for apiProvider (it's valid)
			const updateCalls = mockGlobalState.update.mock.calls
			const apiProviderUpdateCalls = updateCalls.filter((call: any[]) => call[0] === "apiProvider")
			expect(apiProviderUpdateCalls.length).toBe(0)
		})
	})

	describe("getProviderSettings", () => {
		it("should sanitize invalid apiProvider before parsing", async () => {
			// Set an invalid provider in state
			await proxy.updateGlobalState("apiProvider", "invalid-removed-provider" as any)
			await proxy.updateGlobalState("apiModelId", "some-model")

			const settings = proxy.getProviderSettings()

			// The invalid apiProvider should be sanitized (removed)
			expect(settings.apiProvider).toBeUndefined()
			// Other settings should still be present
			expect(settings.apiModelId).toBe("some-model")
		})

		it("should pass through valid apiProvider", async () => {
			// Set a valid provider in state
			await proxy.updateGlobalState("apiProvider", "anthropic")
			await proxy.updateGlobalState("apiModelId", "claude-3-opus-20240229")

			const settings = proxy.getProviderSettings()

			// Valid provider should be returned
			expect(settings.apiProvider).toBe("anthropic")
			expect(settings.apiModelId).toBe("claude-3-opus-20240229")
		})

		it("should handle undefined apiProvider gracefully", async () => {
			// Ensure no provider is set
			await proxy.updateGlobalState("apiProvider", undefined)

			const settings = proxy.getProviderSettings()

			// Should not throw and should return undefined
			expect(settings.apiProvider).toBeUndefined()
		})
	})

	describe("old default condensing prompt migration", () => {
		// The old v1 default condensing prompt from before PR #10873
		const OLD_V1_DEFAULT_CONDENSE_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.

Your summary should be structured as follows:
Context: The context to continue the conversation with. If applicable based on the current task, this should include:
		1. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
		2. Current Work: Describe in detail what was being worked on prior to this request to summarize the conversation. Pay special attention to the more recent messages in the conversation.
		3. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
		4. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
		5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
		6. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.

Example summary structure:
1. Previous Conversation:
		[Detailed description]
2. Current Work:
		[Detailed description]
3. Key Technical Concepts:
		- [Concept 1]
		- [Concept 2]
		- [...]
4. Relevant Files and Code:
		- [File Name 1]
	- [Summary of why this file is important]
	- [Summary of the changes made to this file, if any]
	- [Important Code Snippet]
		- [File Name 2]
	- [Important Code Snippet]
		- [...]
5. Problem Solving:
		[Detailed description]
6. Pending Tasks and Next Steps:
		- [Task 1 details & next steps]
		- [Task 2 details & next steps]
		- [...]

Output only the summary of the conversation so far, without any additional commentary or explanation.`

		it("should clear old v1 default condensing prompt from customSupportPrompts during initialization", async () => {
			// Reset and create a new proxy with old v1 default prompt in customSupportPrompts
			vi.clearAllMocks()
			mockGlobalState.get.mockImplementation((key: string) => {
				if (key === "customSupportPrompts") {
					return { CONDENSE: OLD_V1_DEFAULT_CONDENSE_PROMPT }
				}
				return undefined
			})

			const proxyWithOldDefault = new ContextProxy(mockContext)
			await proxyWithOldDefault.initialize()

			// Should have cleared the old default by updating customSupportPrompts to undefined
			// (since CONDENSE was the only key)
			expect(mockGlobalState.update).toHaveBeenCalledWith("customSupportPrompts", undefined)
		})

		it("should preserve other custom prompts when clearing old v1 default", async () => {
			// Reset and create a new proxy with old v1 default plus other custom prompts
			vi.clearAllMocks()
			mockGlobalState.get.mockImplementation((key: string) => {
				if (key === "customSupportPrompts") {
					return {
						CONDENSE: OLD_V1_DEFAULT_CONDENSE_PROMPT,
						EXPLAIN: "Custom explain prompt",
					}
				}
				return undefined
			})

			const proxyWithOldDefault = new ContextProxy(mockContext)
			await proxyWithOldDefault.initialize()

			// Should have updated customSupportPrompts to keep EXPLAIN but remove CONDENSE
			expect(mockGlobalState.update).toHaveBeenCalledWith("customSupportPrompts", {
				EXPLAIN: "Custom explain prompt",
			})
		})

		it("should not clear truly customized condensing prompts", async () => {
			// Reset and create a new proxy with a truly customized condensing prompt
			vi.clearAllMocks()
			const customPrompt = "My custom condensing instructions"
			mockGlobalState.get.mockImplementation((key: string) => {
				if (key === "customSupportPrompts") {
					return { CONDENSE: customPrompt }
				}
				return undefined
			})

			const proxyWithCustomPrompt = new ContextProxy(mockContext)
			await proxyWithCustomPrompt.initialize()

			// Should NOT have called update for customSupportPrompts (custom prompt should be preserved)
			const updateCalls = mockGlobalState.update.mock.calls
			const customSupportPromptsUpdateCalls = updateCalls.filter(
				(call: any[]) => call[0] === "customSupportPrompts",
			)
			expect(customSupportPromptsUpdateCalls.length).toBe(0)
		})

		it("should not fail when customSupportPrompts is undefined", async () => {
			// Reset and create a new proxy with no customSupportPrompts
			vi.clearAllMocks()
			mockGlobalState.get.mockReturnValue(undefined)

			const proxyWithNoPrompts = new ContextProxy(mockContext)
			await proxyWithNoPrompts.initialize()

			// Should not have called update for customSupportPrompts
			const updateCalls = mockGlobalState.update.mock.calls
			const customSupportPromptsUpdateCalls = updateCalls.filter(
				(call: any[]) => call[0] === "customSupportPrompts",
			)
			expect(customSupportPromptsUpdateCalls.length).toBe(0)
		})
	})
})
