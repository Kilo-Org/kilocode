import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useKeybindings } from "./useKeybindings"
import { vscode } from "@/utils/vscode"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

describe("useKeybindings", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should gracefully handle missing keybindings", () => {
		const { result } = renderHook(() => useKeybindings(["test.command"]))
		expect(result.current).toEqual({ "test.command": "kilocode:autocomplete.settings.keybindingNotFound" })
	})

	it("should send getKeybindings message on mount", () => {
		const commandIds = ["test.command1", "test.command2"]
		renderHook(() => useKeybindings(commandIds))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "getKeybindings",
			commandIds,
		})
	})

	it("should update keybindings when receiving message", async () => {
		const commandIds = ["test.command1", "test.command2"]
		const mockKeybindings = {
			"test.command1": "Ctrl+A",
			"test.command2": "Ctrl+B",
		}

		const { result } = renderHook(() => useKeybindings(commandIds))

		// Simulate receiving a message from the extension
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "keybindingsResponse",
				keybindings: mockKeybindings,
			},
		})
		window.dispatchEvent(messageEvent)

		await waitFor(() => {
			expect(result.current).toEqual(mockKeybindings)
		})
	})

	it("should handle empty commandIds array", () => {
		const { result } = renderHook(() => useKeybindings([]))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "getKeybindings",
			commandIds: [],
		})
		expect(result.current).toEqual({})
	})

	it("should clean up event listener on unmount", () => {
		const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")
		const { unmount } = renderHook(() => useKeybindings(["test.command"]))

		unmount()

		expect(removeEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function))
	})
})
