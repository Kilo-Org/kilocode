import { describe, it, expect, vi, beforeEach } from "vitest"
import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"

// Mock vscode (minimal)
vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		// kilocode_change start
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
		// kilocode_change end
	},
	workspace: {
		workspaceFolders: undefined,
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
			update: vi.fn(),
		})),
	},
	env: {
		clipboard: { writeText: vi.fn() },
		openExternal: vi.fn(),
	},
	commands: {
		executeCommand: vi.fn(),
	},
	Uri: {
		parse: vi.fn((s: string) => ({ toString: () => s })),
		file: vi.fn((p: string) => ({ fsPath: p })),
	},
	ConfigurationTarget: {
		Global: 1,
		Workspace: 2,
		WorkspaceFolder: 3,
	},
}))

// Mock modelCache getModels/flushModels used by the handler
const getModelsMock = vi.fn()
vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: (...args: any[]) => getModelsMock(...args),
	flushModels: vi.fn(),
}))

describe("webviewMessageHandler - requestRouterModels provider filter", () => {
	let mockProvider: ClineProvider & {
		postMessageToWebview: ReturnType<typeof vi.fn>
		getState: ReturnType<typeof vi.fn>
		contextProxy: any
		log: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.clearAllMocks()

		mockProvider = {
			// Only methods used by this code path
			postMessageToWebview: vi.fn(),
			getState: vi.fn().mockResolvedValue({ apiConfiguration: {} }),
			contextProxy: {
				getValue: vi.fn(),
				setValue: vi.fn(),
				globalStorageUri: { fsPath: "/mock/storage" },
			},
			log: vi.fn(),
		} as any

		// Default mock: return distinct model maps per provider so we can verify keys
		getModelsMock.mockImplementation(async (options: any) => {
			switch (options?.provider) {
				case "roo":
					return { "roo/sonnet": { contextWindow: 8192, supportsPromptCache: false } }
				case "openrouter":
					return { "openrouter/qwen2.5": { contextWindow: 32768, supportsPromptCache: false } }
				case "requesty":
					return { "requesty/model": { contextWindow: 8192, supportsPromptCache: false } }
				case "deepinfra":
					return { "deepinfra/model": { contextWindow: 8192, supportsPromptCache: false } }
				case "glama":
					return { "glama/model": { contextWindow: 8192, supportsPromptCache: false } }
				case "unbound":
					return { "unbound/model": { contextWindow: 8192, supportsPromptCache: false } }
				case "vercel-ai-gateway":
					return { "vercel/model": { contextWindow: 8192, supportsPromptCache: false } }
				case "io-intelligence":
					return { "io/model": { contextWindow: 8192, supportsPromptCache: false } }
				case "litellm":
					return { "litellm/model": { contextWindow: 8192, supportsPromptCache: false } }
				default:
					return {}
			}
		})
	})

	it("fetches only requested provider when values.provider is present ('roo')", async () => {
		await webviewMessageHandler(
			mockProvider as any,
			{
				type: "requestRouterModels",
				values: { provider: "roo" },
			} as any,
		)

		// Should post a single routerModels message
		expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith(
			expect.objectContaining({ type: "routerModels", routerModels: expect.any(Object) }),
		)

		const call = (mockProvider.postMessageToWebview as any).mock.calls.find(
			(c: any[]) => c[0]?.type === "routerModels",
		)
		expect(call).toBeTruthy()
		const payload = call[0]
		const routerModels = payload.routerModels as Record<string, Record<string, any>>

		// Only "roo" key should be present
		const keys = Object.keys(routerModels)
		expect(keys).toEqual(["roo"])
		expect(Object.keys(routerModels.roo || {})).toContain("roo/sonnet")

		// getModels should have been called exactly once for roo
		const providersCalled = getModelsMock.mock.calls.map((c: any[]) => c[0]?.provider)
		expect(providersCalled).toEqual(["roo"])
	})

	it("defaults to aggregate fetching when no provider filter is sent", async () => {
		await webviewMessageHandler(
			mockProvider as any,
			{
				type: "requestRouterModels",
			} as any,
		)

		const call = (mockProvider.postMessageToWebview as any).mock.calls.find(
			(c: any[]) => c[0]?.type === "routerModels",
		)
		expect(call).toBeTruthy()
		const routerModels = call[0].routerModels as Record<string, Record<string, any>>

		// Aggregate handler initializes many known routers - ensure a few expected keys exist
		expect(routerModels).toHaveProperty("openrouter")
		expect(routerModels).toHaveProperty("roo")
		expect(routerModels).toHaveProperty("requesty")
	})

	it("supports filtering another single provider ('openrouter')", async () => {
		await webviewMessageHandler(
			mockProvider as any,
			{
				type: "requestRouterModels",
				values: { provider: "openrouter" },
			} as any,
		)

		const call = (mockProvider.postMessageToWebview as any).mock.calls.find(
			(c: any[]) => c[0]?.type === "routerModels",
		)
		expect(call).toBeTruthy()
		const routerModels = call[0].routerModels as Record<string, Record<string, any>>
		const keys = Object.keys(routerModels)

		expect(keys).toEqual(["openrouter"])
		expect(Object.keys(routerModels.openrouter || {})).toContain("openrouter/qwen2.5")

		const providersCalled = getModelsMock.mock.calls.map((c: any[]) => c[0]?.provider)
		expect(providersCalled).toEqual(["openrouter"])
	})
})
