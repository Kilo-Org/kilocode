// npx vitest core/webview/__tests__/webviewMessageHandler.spec.ts

import type { Mock } from "vitest"

// Mock dependencies - must come before imports
vi.mock("../../../api/providers/fetchers/modelCache")

import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import { getModels } from "../../../api/providers/fetchers/modelCache"
import type { ModelRecord } from "../../../shared/api"

const mockGetModels = getModels as Mock<typeof getModels>

// Mock ClineProvider
const mockClineProvider = {
	getState: vi.fn(),
	postMessageToWebview: vi.fn(),
	customModesManager: {
		getCustomModes: vi.fn(),
		deleteCustomMode: vi.fn(),
	},
	context: {
		extensionPath: "/mock/extension/path",
		globalStorageUri: { fsPath: "/mock/global/storage" },
	},
	contextProxy: {
		context: {
			extensionPath: "/mock/extension/path",
			globalStorageUri: { fsPath: "/mock/global/storage" },
		},
		setValue: vi.fn(),
		getValue: vi.fn(),
	},
	log: vi.fn(),
	postStateToWebview: vi.fn(),
	getCurrentTask: vi.fn(),
	getTaskWithId: vi.fn(),
	createTaskWithHistoryItem: vi.fn(),
} as unknown as ClineProvider

import { t } from "../../../i18n"

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })), // kilocode_change
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
	},
}))

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string, args?: Record<string, any>) => {
		// For the delete confirmation with rules, we need to return the interpolated string
		if (key === "common:confirmation.delete_custom_mode_with_rules" && args) {
			return `Are you sure you want to delete this ${args.scope} mode?\n\nThis will also delete the associated rules folder at:\n${args.rulesFolderPath}`
		}
		// Return the translated value for "Yes"
		if (key === "common:answers.yes") {
			return "Yes"
		}
		// Return the translated value for "Cancel"
		if (key === "common:answers.cancel") {
			return "Cancel"
		}
		return key
	}),
}))

vi.mock("fs/promises", () => {
	const mockRm = vi.fn().mockResolvedValue(undefined)
	const mockMkdir = vi.fn().mockResolvedValue(undefined)

	return {
		default: {
			rm: mockRm,
			mkdir: mockMkdir,
		},
		rm: mockRm,
		mkdir: mockMkdir,
	}
})

import * as vscode from "vscode"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import * as fsUtils from "../../../utils/fs"
import { getWorkspacePath } from "../../../utils/path"
import { ensureSettingsDirectoryExists } from "../../../utils/globalContext"
import type { ModeConfig } from "@roo-code/types"

vi.mock("../../../utils/fs")
vi.mock("../../../utils/path")
vi.mock("../../../utils/globalContext")

describe("webviewMessageHandler - requestLmStudioModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				lmStudioModelId: "model-1",
				lmStudioBaseUrl: "http://localhost:1234",
			},
		})
	})

	it("successfully fetches models from LMStudio", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestLmStudioModels",
		})

		expect(mockGetModels).toHaveBeenCalledWith({ provider: "lmstudio", baseUrl: "http://localhost:1234" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "lmStudioModels",
			lmStudioModels: mockModels,
		})
	})
})

describe("webviewMessageHandler - requestOllamaModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				ollamaModelId: "model-1",
				ollamaBaseUrl: "http://localhost:1234",
			},
		})
	})

	it("successfully fetches models from Ollama", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestOllamaModels",
		})

		expect(mockGetModels).toHaveBeenCalledWith({ provider: "ollama", baseUrl: "http://localhost:1234" })

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "ollamaModels",
			ollamaModels: mockModels,
		})
	})
})

describe("webviewMessageHandler - requestRouterModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				glamaApiKey: "glama-key",
				unboundApiKey: "unbound-key",
				litellmApiKey: "litellm-key",
				litellmBaseUrl: "http://localhost:4000",
				// kilocode_change start
				chutesApiKey: "chutes-key",
				geminiApiKey: "gemini-key",
				googleGeminiBaseUrl: "https://gemini.example.com",
				nanoGptApiKey: "nano-gpt-key",
				ovhCloudAiEndpointsApiKey: "ovhcloud-key",
				inceptionLabsApiKey: "inception-key",
				inceptionLabsBaseUrl: "https://api.inceptionlabs.ai/v1/",
				// kilocode_change end
			},
			// Configured profiles - only these providers will be fetched
			listApiConfigMeta: [
				{ id: "1", name: "OpenRouter", apiProvider: "openrouter" },
				{ id: "2", name: "Gemini", apiProvider: "gemini" },
				{ id: "3", name: "Requesty", apiProvider: "requesty" },
				{ id: "4", name: "Glama", apiProvider: "glama" },
				{ id: "5", name: "Unbound", apiProvider: "unbound" },
				{ id: "6", name: "Nano-GPT", apiProvider: "nano-gpt" },
				{ id: "7", name: "OVHcloud", apiProvider: "ovhcloud" },
				{ id: "8", name: "Inception", apiProvider: "inception" },
				{ id: "9", name: "Roo", apiProvider: "roo" },
				{ id: "10", name: "Chutes", apiProvider: "chutes" },
				{ id: "11", name: "LiteLLM", apiProvider: "litellm" },
			],
		})
	})

	it("successfully fetches models from all providers", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
			"model-2": {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsPromptCache: false,
				description: "Test model 2",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify getModels was called for each provider that has a configured profile
		// Providers without configured profiles are skipped (deepinfra, kilocode, ollama, vercel-ai-gateway, synthetic, io-intelligence)
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "openrouter",
			apiKey: "openrouter-key",
			baseUrl: undefined,
		})
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "gemini",
			apiKey: "gemini-key",
			baseUrl: "https://gemini.example.com",
		})
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "requesty", apiKey: "requesty-key", baseUrl: undefined })
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "glama", apiKey: "glama-key" })
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "unbound", apiKey: "unbound-key" })
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "nano-gpt",
			apiKey: "nano-gpt-key",
			nanoGptModelList: undefined,
		})
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "ovhcloud", apiKey: "ovhcloud-key", baseUrl: undefined })
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "inception",
			apiKey: "inception-key",
			baseUrl: "https://api.inceptionlabs.ai/v1/",
		})
		// roo has a configured profile
		expect(mockGetModels).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "roo", baseUrl: expect.any(String) }),
		)
		expect(mockGetModels).toHaveBeenCalledWith({ provider: "chutes", apiKey: "chutes-key" })
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key",
			baseUrl: "http://localhost:4000",
		})

		// Verify providers without configured profiles are NOT called
		expect(mockGetModels).not.toHaveBeenCalledWith(expect.objectContaining({ provider: "deepinfra" }))
		expect(mockGetModels).not.toHaveBeenCalledWith(expect.objectContaining({ provider: "kilocode" }))
		expect(mockGetModels).not.toHaveBeenCalledWith(expect.objectContaining({ provider: "ollama" }))
		expect(mockGetModels).not.toHaveBeenCalledWith(expect.objectContaining({ provider: "vercel-ai-gateway" }))
		expect(mockGetModels).not.toHaveBeenCalledWith(expect.objectContaining({ provider: "synthetic" }))
		expect(mockGetModels).not.toHaveBeenCalledWith(expect.objectContaining({ provider: "io-intelligence" }))

		// Verify response was sent - only providers with configured profiles are in the result
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				// Providers that were fetched successfully (have configured profiles)
				openrouter: mockModels,
				gemini: mockModels,
				requesty: mockModels,
				glama: mockModels,
				unbound: mockModels,
				"nano-gpt": mockModels,
				ovhcloud: mockModels,
				inception: mockModels,
				roo: mockModels,
				chutes: mockModels,
				litellm: mockModels,
				// Providers without configured profiles are initialized to empty in routerModels
				deepinfra: {},
				kilocode: {},
				ollama: {},
				"vercel-ai-gateway": {},
				synthetic: {},
				"io-intelligence": {},
				// Static empty entries
				lmstudio: {},
				huggingface: {},
				"sap-ai-core": {},
			},
			values: undefined,
		})
	})

	it("skips providers without configured profiles", async () => {
		// This test verifies providers are only fetched if they have a configured profile in listApiConfigMeta
		// - Providers with configured profiles are fetched
		// - Providers without configured profiles are skipped, even if they have credentials

		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				// Both providers have credentials
				openRouterApiKey: "valid-key",
				deepInfraApiKey: "deepinfra-key",
				deepInfraBaseUrl: "https://api.deepinfra.com",
			},
			// But only openrouter and roo have configured profiles
			listApiConfigMeta: [
				{ id: "1", name: "OpenRouter", apiProvider: "openrouter" },
				{ id: "2", name: "Roo", apiProvider: "roo" },
			],
		})

		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify openrouter was fetched (has configured profile)
		expect(mockGetModels).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "openrouter", apiKey: "valid-key" }),
		)

		// Verify roo was fetched (has configured profile)
		expect(mockGetModels).toHaveBeenCalledWith(
			expect.objectContaining({ provider: "roo", baseUrl: expect.any(String) }),
		)

		// Verify deepinfra was NOT fetched (no configured profile, even though it has credentials)
		expect(mockGetModels).not.toHaveBeenCalledWith(expect.objectContaining({ provider: "deepinfra" }))

		// Verify vercel-ai-gateway was NOT fetched (no configured profile)
		expect(mockGetModels).not.toHaveBeenCalledWith(expect.objectContaining({ provider: "vercel-ai-gateway" }))
	})

	// Note: LiteLLM does NOT support getting values from message.values - only from apiConfiguration
	// The candidate definition uses apiConfiguration.litellmApiKey, not message?.values?.litellmApiKey

	it("skips LiteLLM when profile is not configured", async () => {
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				openRouterApiKey: "openrouter-key",
				requestyApiKey: "requesty-key",
				glamaApiKey: "glama-key",
				unboundApiKey: "unbound-key",
				// kilocode_change start
				ovhCloudAiEndpointsApiKey: "ovhcloud-key",
				chutesApiKey: "chutes-key",
				nanoGptApiKey: "nano-gpt-key",
				// kilocode_change end
				// Missing litellm config
			},
			// Configured profiles - LiteLLM profile is not included
			listApiConfigMeta: [
				{ id: "1", name: "OpenRouter", apiProvider: "openrouter" },
				{ id: "2", name: "Requesty", apiProvider: "requesty" },
				{ id: "3", name: "Glama", apiProvider: "glama" },
				{ id: "4", name: "Unbound", apiProvider: "unbound" },
				{ id: "5", name: "Nano-GPT", apiProvider: "nano-gpt" },
				{ id: "6", name: "OVHcloud", apiProvider: "ovhcloud" },
				{ id: "7", name: "Roo", apiProvider: "roo" },
				{ id: "8", name: "Chutes", apiProvider: "chutes" },
			],
		})

		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			// No values provided
		})

		// Verify LiteLLM was NOT called (no configured profile)
		expect(mockGetModels).not.toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "litellm",
			}),
		)

		// Verify response includes empty object for providers without configured profiles
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				// Providers with configured profiles were fetched successfully
				openrouter: mockModels,
				requesty: mockModels,
				glama: mockModels,
				unbound: mockModels,
				"nano-gpt": mockModels,
				ovhcloud: mockModels,
				roo: mockModels,
				chutes: mockModels,
				// Providers without configured profiles get empty objects
				gemini: {},
				deepinfra: {},
				kilocode: {},
				ollama: {},
				"vercel-ai-gateway": {},
				synthetic: {},
				"io-intelligence": {},
				inception: {},
				litellm: {},
				// Static empty entries
				lmstudio: {},
				huggingface: {},
				"sap-ai-core": {},
			},
			values: undefined,
		})
	})

	it("handles individual provider failures gracefully", async () => {
		const mockModels: ModelRecord = {
			"model-1": {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsPromptCache: false,
				description: "Test model 1",
			},
		}

		// The beforeEach mock includes these providers with configured profiles:
		// openrouter, gemini, requesty, glama, unbound, nano-gpt, ovhcloud, inception, roo, chutes, litellm
		// Providers without configured profiles (kilocode, ollama, deepinfra, vercel-ai-gateway, synthetic, io-intelligence)
		// are skipped before fetch - they don't call getModels at all.

		// Mock providers in order they appear in candidates array
		// (skipping those without configured profiles as they won't call getModels)
		mockGetModels
			.mockResolvedValueOnce(mockModels) // openrouter - success
			.mockResolvedValueOnce(mockModels) // gemini - success
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty - fail
			.mockResolvedValueOnce(mockModels) // glama - success
			.mockRejectedValueOnce(new Error("Unbound API error")) // unbound - fail
			// kilocode skipped (no configured profile)
			// ollama skipped (no configured profile)
			// vercel-ai-gateway skipped (no configured profile)
			// deepinfra skipped (no configured profile)
			.mockRejectedValueOnce(new Error("Nano-GPT API error")) // nano-gpt - fail
			.mockResolvedValueOnce(mockModels) // ovhcloud - success
			.mockRejectedValueOnce(new Error("Inception API error")) // inception - fail
			// synthetic skipped (no configured profile)
			.mockResolvedValueOnce(mockModels) // roo - success
			.mockRejectedValueOnce(new Error("Chutes API error")) // chutes - fail
			// io-intelligence skipped (no configured profile)
			.mockResolvedValueOnce(mockModels) // litellm - success

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify error messages were sent for failed providers
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Unbound API error",
			values: { provider: "unbound" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Nano-GPT API error",
			values: { provider: "nano-gpt" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Inception API error",
			values: { provider: "inception" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Chutes API error",
			values: { provider: "chutes" },
		})

		// Verify final routerModels response includes successful providers and empty objects for failed ones
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "routerModels",
			routerModels: {
				// Successfully fetched
				openrouter: mockModels,
				gemini: mockModels,
				glama: mockModels,
				ovhcloud: mockModels,
				roo: mockModels,
				litellm: mockModels,
				// Failed (API errors)
				requesty: {},
				unbound: {},
				"nano-gpt": {},
				inception: {},
				chutes: {},
				// Skipped (no configured profile - returned {} without calling getModels)
				kilocode: {},
				ollama: {},
				"vercel-ai-gateway": {},
				deepinfra: {},
				synthetic: {},
				"io-intelligence": {},
				// Static empty entries
				lmstudio: {},
				huggingface: {},
				"sap-ai-core": {},
			},
			values: undefined,
		})
	})

	it("handles Error objects and string errors correctly", async () => {
		// The beforeEach mock includes these providers with credentials:
		// openrouter, gemini, requesty, glama, unbound, nano-gpt, ovhcloud, inception, roo, chutes, litellm
		// Providers without credentials are skipped (don't call getModels)

		// Mock all providers to fail to verify error handling
		mockGetModels
			.mockRejectedValueOnce(new Error("OpenRouter API error")) // openrouter
			.mockRejectedValueOnce(new Error("Gemini API error")) // gemini
			.mockRejectedValueOnce(new Error("Requesty API error")) // requesty
			.mockRejectedValueOnce(new Error("Glama API error")) // glama
			.mockRejectedValueOnce(new Error("Unbound API error")) // unbound
			// kilocode skipped (no token)
			// ollama skipped (no baseUrl)
			// vercel-ai-gateway skipped (no apiKey)
			// deepinfra skipped (no apiKey)
			.mockRejectedValueOnce(new Error("Nano-GPT API error")) // nano-gpt
			.mockRejectedValueOnce(new Error("OVHcloud API error")) // ovhcloud
			.mockRejectedValueOnce(new Error("Inception API error")) // inception
			// synthetic skipped (no apiKey)
			.mockRejectedValueOnce(new Error("Roo API error")) // roo (has default baseUrl)
			.mockRejectedValueOnce(new Error("Chutes API error")) // chutes
			// io-intelligence skipped (no apiKey)
			.mockRejectedValueOnce(new Error("LiteLLM connection failed")) // litellm

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
		})

		// Verify error handling for each provider that was actually fetched
		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "OpenRouter API error",
			values: { provider: "openrouter" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Gemini API error",
			values: { provider: "gemini" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Requesty API error",
			values: { provider: "requesty" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Glama API error",
			values: { provider: "glama" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Unbound API error",
			values: { provider: "unbound" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Nano-GPT API error",
			values: { provider: "nano-gpt" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "OVHcloud API error",
			values: { provider: "ovhcloud" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Inception API error",
			values: { provider: "inception" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Roo API error",
			values: { provider: "roo" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "Chutes API error",
			values: { provider: "chutes" },
		})

		expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
			type: "singleRouterModelFetchResponse",
			success: false,
			error: "LiteLLM connection failed",
			values: { provider: "litellm" },
		})
	})

	it("uses config values for LiteLLM (message values are not used)", async () => {
		const mockModels: ModelRecord = {}
		mockGetModels.mockResolvedValue(mockModels)

		await webviewMessageHandler(mockClineProvider, {
			type: "requestRouterModels",
			values: {
				litellmApiKey: "message-key",
				litellmBaseUrl: "http://message-url",
			},
		})

		// LiteLLM does NOT use message.values - only apiConfiguration
		// (Unlike openrouter which supports both via fallback)
		expect(mockGetModels).toHaveBeenCalledWith({
			provider: "litellm",
			apiKey: "litellm-key", // From config
			baseUrl: "http://localhost:4000", // From config
		})
	})
})

describe("webviewMessageHandler - deleteCustomMode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(getWorkspacePath).mockReturnValue("/mock/workspace")
		vi.mocked(vscode.window.showErrorMessage).mockResolvedValue(undefined)
		vi.mocked(ensureSettingsDirectoryExists).mockResolvedValue("/mock/global/storage/.roo")
	})

	it("should delete a project mode and its rules folder", async () => {
		const slug = "test-project-mode"
		const rulesFolderPath = path.join("/mock/workspace", ".roo", `rules-${slug}`)

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Project Mode",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
	})

	it("should delete a global mode and its rules folder", async () => {
		const slug = "test-global-mode"
		const homeDir = os.homedir()
		const rulesFolderPath = path.join(homeDir, ".roo", `rules-${slug}`)

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Global Mode",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "global",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
	})

	it("should only delete the mode when rules folder does not exist", async () => {
		const slug = "test-mode-no-rules"
		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Mode No Rules",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(false)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		// The confirmation dialog is now handled in the webview, so we don't expect showInformationMessage to be called
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).not.toHaveBeenCalled()
	})

	it("should handle errors when deleting rules folder", async () => {
		const slug = "test-mode-error"
		const rulesFolderPath = path.join("/mock/workspace", ".roo", `rules-${slug}`)
		const error = new Error("Permission denied")

		vi.mocked(mockClineProvider.customModesManager.getCustomModes).mockResolvedValue([
			{
				name: "Test Mode Error",
				slug,
				roleDefinition: "Test Role",
				groups: [],
				source: "project",
			} as ModeConfig,
		])
		vi.mocked(fsUtils.fileExistsAtPath).mockResolvedValue(true)
		vi.mocked(mockClineProvider.customModesManager.deleteCustomMode).mockResolvedValue(undefined)
		vi.mocked(fs.rm).mockRejectedValue(error)

		await webviewMessageHandler(mockClineProvider, { type: "deleteCustomMode", slug })

		expect(mockClineProvider.customModesManager.deleteCustomMode).toHaveBeenCalledWith(slug)
		expect(fs.rm).toHaveBeenCalledWith(rulesFolderPath, { recursive: true, force: true })
		// Verify error message is shown to the user
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			t("common:errors.delete_rules_folder_failed", {
				rulesFolderPath,
				error: error.message,
			}),
		)
		// No error response is sent anymore - we just continue with deletion
		expect(mockClineProvider.postMessageToWebview).not.toHaveBeenCalled()
	})
})

describe("webviewMessageHandler - message dialog preferences", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Mock a current Cline instance
		vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
			taskId: "test-task-id",
			apiConversationHistory: [],
			clineMessages: [],
		} as any)
		// Reset getValue mock
		vi.mocked(mockClineProvider.contextProxy.getValue).mockReturnValue(false)
	})

	describe("deleteMessage", () => {
		it("should always show dialog for delete confirmation", async () => {
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				clineMessages: [],
				apiConversationHistory: [],
			} as any) // Mock current cline with proper structure

			await webviewMessageHandler(mockClineProvider, {
				type: "deleteMessage",
				value: 123456789, // Changed from messageTs to value
			})

			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "showDeleteMessageDialog",
				messageTs: 123456789,
				hasCheckpoint: false,
			})
		})
	})

	describe("submitEditedMessage", () => {
		it("should always show dialog for edit confirmation", async () => {
			vi.mocked(mockClineProvider.getCurrentTask).mockReturnValue({
				clineMessages: [],
				apiConversationHistory: [],
			} as any) // Mock current cline with proper structure

			await webviewMessageHandler(mockClineProvider, {
				type: "submitEditedMessage",
				value: 123456789,
				editedMessageContent: "edited content",
			})

			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "showEditMessageDialog",
				messageTs: 123456789,
				text: "edited content",
				hasCheckpoint: false,
				images: undefined,
			})
		})
	})
})

describe("webviewMessageHandler - mcpEnabled", () => {
	let mockMcpHub: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Create a mock McpHub instance
		mockMcpHub = {
			handleMcpEnabledChange: vi.fn().mockResolvedValue(undefined),
		}

		// Ensure provider exposes getMcpHub and returns our mock
		;(mockClineProvider as any).getMcpHub = vi.fn().mockReturnValue(mockMcpHub)
	})

	it("delegates enable=true to McpHub and posts updated state", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: true },
		})

		expect((mockClineProvider as any).getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledWith(true)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("delegates enable=false to McpHub and posts updated state", async () => {
		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: false },
		})

		expect((mockClineProvider as any).getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledTimes(1)
		expect(mockMcpHub.handleMcpEnabledChange).toHaveBeenCalledWith(false)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})

	it("handles missing McpHub instance gracefully and still posts state", async () => {
		;(mockClineProvider as any).getMcpHub = vi.fn().mockReturnValue(undefined)

		await webviewMessageHandler(mockClineProvider, {
			type: "updateSettings",
			updatedSettings: { mcpEnabled: true },
		})

		expect((mockClineProvider as any).getMcpHub).toHaveBeenCalledTimes(1)
		expect(mockClineProvider.postStateToWebview).toHaveBeenCalledTimes(1)
	})
})
