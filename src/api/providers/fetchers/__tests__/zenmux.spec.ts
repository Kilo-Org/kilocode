// kilocode_change - new file
import { zenmuxDefaultModelInfo } from "@roo-code/types"
import { getZenmuxModels } from "../zenmux"

describe("getZenmuxModels", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.restoreAllMocks()
	})

	it("maps context_length from ZenMux model payload", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: vi.fn().mockResolvedValue({
				object: "list",
				data: [
					{
						id: "anthropic/claude-opus-4",
						object: "model",
						created: 1767146192,
						owned_by: "anthropic",
						display_name: "Claude Opus 4",
						context_length: 200000,
						input_modalities: ["text", "image"],
					},
				],
			}),
		})
		vi.stubGlobal("fetch", fetchMock)

		const models = await getZenmuxModels()

		expect(models["anthropic/claude-opus-4"]).toEqual({
			maxTokens: 0,
			contextWindow: 200000,
			supportsImages: true,
			supportsPromptCache: false,
			supportsNativeTools: true,
			defaultToolProtocol: "native",
			inputPrice: 0,
			outputPrice: 0,
			description: "anthropic model",
			displayName: "Claude Opus 4",
		})
		expect(models["anthropic/claude-opus-4"].contextWindow).toBeGreaterThan(0)
	})

	it("falls back to default context window when optional metadata is missing", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: vi.fn().mockResolvedValue({
				object: "list",
				data: [
					{
						id: "openai/gpt-5",
						object: "model",
						created: 1767146192,
						owned_by: "openai",
					},
				],
			}),
		})
		vi.stubGlobal("fetch", fetchMock)

		const models = await getZenmuxModels()

		expect(models["openai/gpt-5"].contextWindow).toBe(zenmuxDefaultModelInfo.contextWindow)
		expect(models["openai/gpt-5"].displayName).toBe("openai/gpt-5")
		expect(models["openai/gpt-5"].supportsNativeTools).toBe(true)
		expect(models["openai/gpt-5"].defaultToolProtocol).toBe("native")
	})
})
