import { deviceAuthMessageHandler } from "../webviewMessageHandlerUtils"
import { ClineProvider } from "../../../webview/ClineProvider"
import { WebviewMessage } from "../../../../shared/WebviewMessage"

// Mock the buildApiHandler
vi.mock("../../../../api", () => ({
	buildApiHandler: vi.fn().mockReturnValue({}),
}))

describe("deviceAuthMessageHandler", () => {
	let mockProvider: Partial<ClineProvider>

	beforeEach(() => {
		mockProvider = {
			getState: vi.fn().mockResolvedValue({
				apiConfiguration: {},
				currentApiConfigName: "default",
			}),
			upsertProviderProfile: vi.fn().mockResolvedValue(undefined),
			getCurrentTask: vi.fn().mockReturnValue(null),
			postMessageToWebview: vi.fn(),
			log: vi.fn(),
		}
	})

	describe("startWithFreeModels", () => {
		it("should set up the profile with kilocode provider and free model", async () => {
			const message: WebviewMessage = { type: "startWithFreeModels" }

			const result = await deviceAuthMessageHandler(mockProvider as ClineProvider, message)

			expect(result).toBe(true)
			expect(mockProvider.upsertProviderProfile).toHaveBeenCalledWith("default", {
				apiProvider: "kilocode",
				kilocodeModel: "minimax/minimax-m2.1:free",
			})
		})

		it("should navigate to chat tab after setting up free models", async () => {
			const message: WebviewMessage = { type: "startWithFreeModels" }

			await deviceAuthMessageHandler(mockProvider as ClineProvider, message)

			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "action",
				action: "switchTab",
				tab: "chat",
			})
		})

		it("should preserve existing apiConfiguration when setting up free models", async () => {
			mockProvider.getState = vi.fn().mockResolvedValue({
				apiConfiguration: {
					existingSetting: "value",
					anotherSetting: 123,
				},
				currentApiConfigName: "my-profile",
			})

			const message: WebviewMessage = { type: "startWithFreeModels" }

			await deviceAuthMessageHandler(mockProvider as ClineProvider, message)

			expect(mockProvider.upsertProviderProfile).toHaveBeenCalledWith("my-profile", {
				existingSetting: "value",
				anotherSetting: 123,
				apiProvider: "kilocode",
				kilocodeModel: "minimax/minimax-m2.1:free",
			})
		})

		it("should log error if setup fails", async () => {
			const error = new Error("Test error")
			mockProvider.upsertProviderProfile = vi.fn().mockRejectedValue(error)

			const message: WebviewMessage = { type: "startWithFreeModels" }

			const result = await deviceAuthMessageHandler(mockProvider as ClineProvider, message)

			expect(result).toBe(true) // Still returns true even on error
			expect(mockProvider.log).toHaveBeenCalledWith("Error setting up free models: Test error")
		})
	})
})
