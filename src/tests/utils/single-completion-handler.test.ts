import { singleCompletionHandler } from "../../utils/single-completion-handler"
import { buildApiHandler } from "../../api"
import { ProviderSettings } from "@roo-code/types"

vi.mock("../../api")

describe("singleCompletionHandler", () => {
	it("should call completePrompt for providers that support it", async () => {
		const mockCompletePrompt = vi.fn().mockResolvedValue("enhanced prompt")
		const mockBuildApiHandler = buildApiHandler as vi.Mock
		mockBuildApiHandler.mockReturnValue({
			completePrompt: mockCompletePrompt,
		})

		const apiConfiguration: ProviderSettings = {
			apiProvider: "some-provider-with-complete",
			// other settings...
		} as any

		const result = await singleCompletionHandler(apiConfiguration, "prompt")

		expect(mockBuildApiHandler).toHaveBeenCalledWith(apiConfiguration)
		expect(mockCompletePrompt).toHaveBeenCalledWith("prompt")
		expect(result).toBe("enhanced prompt")
	})

	it("should use streamResponseFromHandler for providers without completePrompt", async () => {
		const mockCreateMessage = vi.fn().mockImplementation(async function* () {
			yield { type: "text", text: "streamed " }
			yield { type: "text", text: "response" }
		})
		const mockBuildApiHandler = buildApiHandler as vi.Mock
		mockBuildApiHandler.mockReturnValue({
			createMessage: mockCreateMessage,
		})

		const apiConfiguration: ProviderSettings = {
			apiProvider: "some-other-provider",
			// other settings...
		} as any

		const result = await singleCompletionHandler(apiConfiguration, "prompt")

		expect(mockBuildApiHandler).toHaveBeenCalledWith(apiConfiguration)
		expect(mockCreateMessage).toHaveBeenCalled()
		expect(result).toBe("streamed response")
	})
})
