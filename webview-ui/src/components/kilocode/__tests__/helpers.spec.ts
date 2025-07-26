import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockPostMessage = vi.fn()
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: mockPostMessage,
	},
}))

describe("helpers", () => {
	let originalAddEventListener: typeof window.addEventListener
	let mockEventListener: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockPostMessage.mockClear()
		originalAddEventListener = window.addEventListener
		mockEventListener = vi.fn()
		window.addEventListener = mockEventListener
		vi.resetModules()
	})

	afterEach(() => {
		window.addEventListener = originalAddEventListener
	})

	describe("getKiloCodeBackendSignInUrl", () => {
		it("should return sign-in URL with default base URL", async () => {
			const { getKiloCodeBackendSignInUrl } = await import("../helpers")

			const result = getKiloCodeBackendSignInUrl()

			expect(result).toBe("https://kilocode.ai/users/sign_in?source=vscode")
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "getVSCodeSetting",
				setting: "kilo-code.baseUrl",
			})
		})

		it("should use cached base URL after setting is received", async () => {
			const { getKiloCodeBackendSignInUrl } = await import("../helpers")

			// Simulate receiving a setting update
			const messageEvent = new MessageEvent("message", {
				data: {
					type: "vsCodeSetting",
					setting: "kilo-code.baseUrl",
					value: "https://custom.example.com",
				},
			})

			// Get the event listener that was registered
			expect(mockEventListener).toHaveBeenCalledWith("message", expect.any(Function))
			const eventHandler = mockEventListener.mock.calls[0][1]

			// Trigger the event handler
			eventHandler(messageEvent)

			const result = getKiloCodeBackendSignInUrl()
			expect(result).toBe("https://custom.example.com/users/sign_in?source=vscode")
		})

		it("should fallback to default when setting value is empty", async () => {
			const { getKiloCodeBackendSignInUrl } = await import("../helpers")

			// Simulate receiving an empty setting value
			const messageEvent = new MessageEvent("message", {
				data: {
					type: "vsCodeSetting",
					setting: "kilo-code.baseUrl",
					value: "",
				},
			})

			const eventHandler = mockEventListener.mock.calls[0][1]
			eventHandler(messageEvent)

			const result = getKiloCodeBackendSignInUrl()
			expect(result).toBe("https://kilocode.ai/users/sign_in?source=vscode")
		})

		it("should support custom uriScheme and uiKind parameters", async () => {
			const { getKiloCodeBackendSignInUrl } = await import("../helpers")

			const result = getKiloCodeBackendSignInUrl("custom-scheme", "Web")
			expect(result).toBe("https://kilocode.ai/users/sign_in?source=web")
		})
	})

	describe("getKiloCodeBackendSignUpUrl", () => {
		it("should return sign-up URL with default base URL", async () => {
			const { getKiloCodeBackendSignUpUrl } = await import("../helpers")

			const result = getKiloCodeBackendSignUpUrl()

			expect(result).toBe("https://kilocode.ai/users/sign_up?source=vscode")
			expect(mockPostMessage).toHaveBeenCalledWith({
				type: "getVSCodeSetting",
				setting: "kilo-code.baseUrl",
			})
		})

		it("should use cached base URL after setting is received", async () => {
			const { getKiloCodeBackendSignUpUrl } = await import("../helpers")

			// Simulate receiving a setting update
			const messageEvent = new MessageEvent("message", {
				data: {
					type: "vsCodeSetting",
					setting: "kilo-code.baseUrl",
					value: "https://custom.example.com",
				},
			})

			const eventHandler = mockEventListener.mock.calls[0][1]
			eventHandler(messageEvent)

			const result = getKiloCodeBackendSignUpUrl()
			expect(result).toBe("https://custom.example.com/users/sign_up?source=vscode")
		})

		it("should support custom uriScheme and uiKind parameters", async () => {
			const { getKiloCodeBackendSignUpUrl } = await import("../helpers")

			const result = getKiloCodeBackendSignUpUrl("custom-scheme", "Web")
			expect(result).toBe("https://kilocode.ai/users/sign_up?source=web")
		})
	})

	describe("message event handling", () => {
		it("should ignore non-vsCodeSetting messages", async () => {
			await import("../helpers")

			const messageEvent = new MessageEvent("message", {
				data: {
					type: "otherMessage",
					setting: "kilo-code.baseUrl",
					value: "https://should-be-ignored.com",
				},
			})

			const eventHandler = mockEventListener.mock.calls[0][1]
			eventHandler(messageEvent)

			const { getKiloCodeBackendSignInUrl } = await import("../helpers")
			const result = getKiloCodeBackendSignInUrl()
			expect(result).toBe("https://kilocode.ai/users/sign_in?source=vscode")
		})

		it("should ignore messages for different settings", async () => {
			await import("../helpers")

			const messageEvent = new MessageEvent("message", {
				data: {
					type: "vsCodeSetting",
					setting: "other.setting",
					value: "https://should-be-ignored.com",
				},
			})

			const eventHandler = mockEventListener.mock.calls[0][1]
			eventHandler(messageEvent)

			const { getKiloCodeBackendSignInUrl } = await import("../helpers")
			const result = getKiloCodeBackendSignInUrl()
			expect(result).toBe("https://kilocode.ai/users/sign_in?source=vscode")
		})
	})
})
