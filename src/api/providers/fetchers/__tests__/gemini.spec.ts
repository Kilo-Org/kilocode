// kilocode_change - new file
import { beforeEach, describe, expect, it, vi } from "vitest"

const listModelsMock = vi.hoisted(() => vi.fn())
const googleGenAICtorMock = vi.hoisted(() =>
	vi.fn(() => ({
		models: {
			list: listModelsMock,
		},
	})),
)

vi.mock("@google/genai", () => ({
	GoogleGenAI: googleGenAICtorMock,
}))

import { getGeminiModels } from "../gemini"

const createPager = (models: Array<Record<string, any>>) => ({
	async *[Symbol.asyncIterator]() {
		for (const model of models) {
			yield model
		}
	},
})

describe("getGeminiModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// kilocode_change start
	it("adds customtools alias when gemini-3.1-pro-preview is available", async () => {
		listModelsMock.mockResolvedValueOnce(
			createPager([
				{
					name: "models/gemini-3.1-pro-preview",
					inputTokenLimit: 222_222,
					outputTokenLimit: 11_111,
					displayName: "Gemini 3.1 Pro",
				},
			]),
		)

		const models = await getGeminiModels({ apiKey: "test-key" })

		expect(googleGenAICtorMock).toHaveBeenCalledWith({ apiKey: "test-key" })
		expect(models["gemini-3.1-pro-preview"]).toBeDefined()
		expect(models["gemini-3.1-pro-preview-customtools"]).toMatchObject({
			supportsNativeTools: true,
			defaultToolProtocol: "native",
			contextWindow: 222_222,
			maxTokens: 11_111,
		})
	})

	it("does not add customtools alias when gemini-3.1-pro-preview is unavailable", async () => {
		listModelsMock.mockResolvedValueOnce(
			createPager([
				{
					name: "models/gemini-2.5-pro",
					inputTokenLimit: 1_048_576,
					outputTokenLimit: 65_536,
				},
			]),
		)

		const models = await getGeminiModels({ apiKey: "test-key" })

		expect(models["gemini-3.1-pro-preview-customtools"]).toBeUndefined()
	})

	it("does not overwrite API metadata when customtools alias is returned by API", async () => {
		listModelsMock.mockResolvedValueOnce(
			createPager([
				{
					name: "models/gemini-3.1-pro-preview",
					inputTokenLimit: 1_048_576,
					outputTokenLimit: 65_536,
				},
				{
					name: "models/gemini-3.1-pro-preview-customtools",
					inputTokenLimit: 333_333,
					outputTokenLimit: 12_345,
					displayName: "Gemini 3.1 Pro Custom Tools from API",
					description: "API alias description",
				},
			]),
		)

		const models = await getGeminiModels({ apiKey: "test-key" })
		const alias = models["gemini-3.1-pro-preview-customtools"]

		expect(alias).toBeDefined()
		expect(alias.displayName).toBe("Gemini 3.1 Pro Custom Tools from API")
		expect(alias.description).toBe("API alias description")
		expect(alias.maxTokens).toBe(12_345)
		expect(alias.contextWindow).toBe(333_333)
	})
	// kilocode_change end
})
