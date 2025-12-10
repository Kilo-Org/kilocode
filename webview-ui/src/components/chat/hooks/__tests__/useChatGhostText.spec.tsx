import { renderHook, act, waitFor } from "@testing-library/react"
import { vi } from "vitest"
import { useChatGhostText } from "../useChatGhostText"

// Mock vscode
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

describe("useChatGhostText", () => {
	let mockTextArea: HTMLTextAreaElement
	let textAreaRef: React.RefObject<HTMLTextAreaElement>

	beforeEach(() => {
		mockTextArea = document.createElement("textarea")
		mockTextArea.value = "Hello world"
		document.body.appendChild(mockTextArea)
		textAreaRef = { current: mockTextArea }
		document.execCommand = vi.fn(() => true)
	})

	afterEach(() => {
		document.body.removeChild(mockTextArea)
		vi.clearAllMocks()
	})

	describe("Tab key acceptance", () => {
		it("should accept full ghost text on Tab key", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate receiving ghost text
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " completion text",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			// Wait for ghost text to be set
			waitFor(() => {
				expect(result.current.ghostText).toBe(" completion text")
			})

			// Simulate Tab key press
			const tabEvent = {
				key: "Tab",
				shiftKey: false,
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLTextAreaElement>

			act(() => {
				result.current.handleKeyDown(tabEvent)
			})

			expect(tabEvent.preventDefault).toHaveBeenCalled()
			expect(document.execCommand).toHaveBeenCalledWith("insertText", false, " completion text")
			expect(result.current.ghostText).toBe("")
		})
	})

	describe("Right Arrow key - word-by-word acceptance", () => {
		it("should accept next word when cursor is at end", () => {
			mockTextArea.value = "Hello world"
			mockTextArea.selectionStart = 11 // At end
			mockTextArea.selectionEnd = 11

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Set ghost text manually for test
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " this is more text",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			// Simulate Right Arrow key press
			const arrowEvent = {
				key: "ArrowRight",
				shiftKey: false,
				ctrlKey: false,
				metaKey: false,
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLTextAreaElement>

			act(() => {
				result.current.handleKeyDown(arrowEvent)
			})

			expect(arrowEvent.preventDefault).toHaveBeenCalled()
			expect(document.execCommand).toHaveBeenCalledWith("insertText", false, " this ")
			expect(result.current.ghostText).toBe("is more text")
		})

		it("should handle multiple word acceptances", () => {
			mockTextArea.value = "Start"
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Set ghost text
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " word1 word2 word3",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			const arrowEvent = {
				key: "ArrowRight",
				shiftKey: false,
				ctrlKey: false,
				metaKey: false,
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLTextAreaElement>

			// First word
			act(() => {
				result.current.handleKeyDown(arrowEvent)
			})
			expect(result.current.ghostText).toBe("word2 word3")

			// Second word
			act(() => {
				result.current.handleKeyDown(arrowEvent)
			})
			expect(result.current.ghostText).toBe("word3")

			// Third word
			act(() => {
				result.current.handleKeyDown(arrowEvent)
			})
			expect(result.current.ghostText).toBe("")
		})

		it("should NOT accept word when cursor is not at end", () => {
			mockTextArea.value = "Hello world"
			mockTextArea.selectionStart = 5 // In middle
			mockTextArea.selectionEnd = 5

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Set ghost text
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " more text",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			const arrowEvent = {
				key: "ArrowRight",
				shiftKey: false,
				ctrlKey: false,
				metaKey: false,
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLTextAreaElement>

			const handled = result.current.handleKeyDown(arrowEvent)

			expect(handled).toBe(false)
			expect(arrowEvent.preventDefault).not.toHaveBeenCalled()
			expect(result.current.ghostText).toBe(" more text") // Ghost text unchanged
		})

		it("should NOT accept word with Shift modifier", () => {
			mockTextArea.value = "Test"
			mockTextArea.selectionStart = 4
			mockTextArea.selectionEnd = 4

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Set ghost text
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " text",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			const arrowEvent = {
				key: "ArrowRight",
				shiftKey: true, // Shift is pressed
				ctrlKey: false,
				metaKey: false,
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLTextAreaElement>

			const handled = result.current.handleKeyDown(arrowEvent)

			expect(handled).toBe(false)
			expect(arrowEvent.preventDefault).not.toHaveBeenCalled()
		})

		it("should NOT accept word with Ctrl modifier", () => {
			mockTextArea.value = "Test"
			mockTextArea.selectionStart = 4
			mockTextArea.selectionEnd = 4

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Set ghost text
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " text",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			const arrowEvent = {
				key: "ArrowRight",
				shiftKey: false,
				ctrlKey: true, // Ctrl is pressed
				metaKey: false,
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLTextAreaElement>

			const handled = result.current.handleKeyDown(arrowEvent)

			expect(handled).toBe(false)
			expect(arrowEvent.preventDefault).not.toHaveBeenCalled()
		})
	})

	describe("Escape key", () => {
		it("should clear ghost text on Escape", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Set ghost text
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " world",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			expect(result.current.ghostText).toBe(" world")

			// Simulate Escape key
			const escapeEvent = {
				key: "Escape",
			} as React.KeyboardEvent<HTMLTextAreaElement>

			act(() => {
				result.current.handleKeyDown(escapeEvent)
			})

			expect(result.current.ghostText).toBe("")
		})
	})

	describe("Edge cases", () => {
		it("should handle ghost text with only whitespace", () => {
			mockTextArea.value = "Test"
			mockTextArea.selectionStart = 4
			mockTextArea.selectionEnd = 4

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Set ghost text with only whitespace
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: "   ",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			const arrowEvent = {
				key: "ArrowRight",
				shiftKey: false,
				ctrlKey: false,
				metaKey: false,
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLTextAreaElement>

			act(() => {
				result.current.handleKeyDown(arrowEvent)
			})

			expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "   ")
			expect(result.current.ghostText).toBe("")
		})

		it("should handle single word ghost text", () => {
			mockTextArea.value = "Test"
			mockTextArea.selectionStart = 4
			mockTextArea.selectionEnd = 4

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Set single word ghost text
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: "word",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			const arrowEvent = {
				key: "ArrowRight",
				shiftKey: false,
				ctrlKey: false,
				metaKey: false,
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLTextAreaElement>

			act(() => {
				result.current.handleKeyDown(arrowEvent)
			})

			expect(document.execCommand).toHaveBeenCalledWith("insertText", false, "word")
			expect(result.current.ghostText).toBe("")
		})

		it("should handle empty ghost text gracefully", () => {
			mockTextArea.value = "Test"
			mockTextArea.selectionStart = 4
			mockTextArea.selectionEnd = 4

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			const arrowEvent = {
				key: "ArrowRight",
				shiftKey: false,
				ctrlKey: false,
				metaKey: false,
				preventDefault: vi.fn(),
			} as unknown as React.KeyboardEvent<HTMLTextAreaElement>

			const handled = result.current.handleKeyDown(arrowEvent)

			expect(handled).toBe(false)
			expect(arrowEvent.preventDefault).not.toHaveBeenCalled()
		})
	})

	describe("clearGhostText", () => {
		it("should clear ghost text when called", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Set ghost text
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " completion",
						requestId: "",
					},
				})
				window.dispatchEvent(messageEvent)
			})

			expect(result.current.ghostText).toBe(" completion")

			act(() => {
				result.current.clearGhostText()
			})

			expect(result.current.ghostText).toBe("")
		})
	})
})
