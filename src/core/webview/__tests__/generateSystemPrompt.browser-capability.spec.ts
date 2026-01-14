import { describe, test, expect, vi } from "vitest"

// Module under test
import { generateSystemPrompt } from "../generateSystemPrompt"

// Mock SYSTEM_PROMPT to capture its third argument (browser capability flag)
vi.mock("../../prompts/system", () => ({
	SYSTEM_PROMPT: vi.fn(async (_ctx, _cwd, canUseBrowserTool: boolean) => {
		// return a simple string to satisfy return type
		return `SYSTEM_PROMPT:${canUseBrowserTool}`
	}),
}))

// Mock API handler so we control model.info flags
vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn((_config) => ({
		getModel: () => ({
			id: "mock-model",
			info: {
				supportsImages: true,
				contextWindow: 200_000,
				maxTokens: 8192,
				supportsPromptCache: false,
			},
		}),
	})),
}))

// Minimal mode utilities: provide a custom mode that includes the "browser" group
const mockCustomModes = [
	{
		slug: "test-mode",
		name: "Test Mode",
		roleDefinition: "Test role",
		description: "",
		groups: ["browser"], // critical: include browser group
	},
]

// Minimal ClineProvider stub
function makeProviderStub() {
	return {
		cwd: "/tmp",
		context: {} as any,
		customModesManager: {
			getCustomModes: async () => mockCustomModes,
		},
		getCurrentTask: () => ({
			rooIgnoreController: { getInstructions: () => undefined },
		}),
		getMcpHub: () => undefined,
		getSkillsManager: () => undefined,
		// State must enable browser tool and provide apiConfiguration
		getState: async () => ({
			apiConfiguration: {
				apiProvider: "openrouter", // not used by the test beyond handler creation
			},
			customModePrompts: undefined,
			customInstructions: undefined,
			browserViewportSize: "900x600",
			diffEnabled: false,
			mcpEnabled: false,
			fuzzyMatchThreshold: 1.0,
			experiments: {},
			enableMcpServerCreation: false,
			browserToolEnabled: true, // critical: enabled in settings
			language: "en",
			maxReadFileLine: -1,
			maxConcurrentFileReads: 5,
		}),
	} as any
}

describe("generateSystemPrompt browser capability (supportsImages=true)", () => {
	test("passes canUseBrowserTool=true when mode has browser group and setting enabled", async () => {
		const provider = makeProviderStub()
		const message = { mode: "test-mode" } as any

		const result = await generateSystemPrompt(provider, message)

		// SYSTEM_PROMPT mock encodes the boolean into the returned string
		expect(result).toBe("SYSTEM_PROMPT:true")
	})
})
