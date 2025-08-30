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
		// Clear any existing event listeners - no need to actually remove since we're in a test environment
	})

	it("should initialize with empty keybindings object", () => {
		const { result } = renderHook(() => useKeybindings(["test.command"]))

		expect(result.current).toEqual({})
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

	it("should ignore non-keybindings messages", async () => {
		const commandIds = ["test.command"]
		const { result } = renderHook(() => useKeybindings(commandIds))

		// Simulate receiving a different type of message
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "otherMessage",
				data: "some data",
			},
		})
		window.dispatchEvent(messageEvent)

		// Should still be empty
		expect(result.current).toEqual({})
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

	it("should re-request keybindings when commandIds change", () => {
		const { rerender } = renderHook(({ commandIds }) => useKeybindings(commandIds), {
			initialProps: { commandIds: ["command1"] },
		})

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "getKeybindings",
			commandIds: ["command1"],
		})

		// Change the commandIds
		rerender({ commandIds: ["command1", "command2"] })

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "getKeybindings",
			commandIds: ["command1", "command2"],
		})
	})
})
