import { renderHook, act } from "@testing-library/react"
import { vi } from "vitest"
import { useChatGhostText } from "../useChatGhostText"
import { vscode } from "@/utils/vscode"

// Mock vscode
vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock generateRequestId to return a predictable value
const MOCK_REQUEST_ID = "test-request-id"
vi.mock("@roo/id", () => ({
	generateRequestId: () => MOCK_REQUEST_ID,
}))

// Helper to simulate the full flow: focus -> input change -> completion result
function simulateCompletionFlow(
	result: ReturnType<typeof useChatGhostText>,
	mockTextArea: HTMLTextAreaElement,
	text: string,
	ghostText: string,
) {
	// First, focus the textarea
	act(() => {
		result.handleFocus()
	})

	// Then simulate input change (this sets the prefix and triggers completion request)
	act(() => {
		mockTextArea.value = text
		mockTextArea.selectionStart = text.length
		mockTextArea.selectionEnd = text.length
		const changeEvent = {
			target: mockTextArea,
		} as React.ChangeEvent<HTMLTextAreaElement>
		result.handleInputChange(changeEvent)
	})

	// Advance timers to trigger the debounced completion request
	act(() => {
		vi.advanceTimersByTime(300)
	})

	// Finally, simulate receiving the completion result
	// The requestId should match what was set during handleInputChange
	act(() => {
		const messageEvent = new MessageEvent("message", {
			data: {
				type: "chatCompletionResult",
				text: ghostText,
				requestId: MOCK_REQUEST_ID,
			},
		})
		window.dispatchEvent(messageEvent)
	})
}

describe("useChatGhostText", () => {
	let mockTextArea: HTMLTextAreaElement
	let textAreaRef: React.RefObject<HTMLTextAreaElement>

	beforeEach(() => {
		vi.useFakeTimers()
		mockTextArea = document.createElement("textarea")
		mockTextArea.value = "Hello world"
		mockTextArea.selectionStart = 11
		mockTextArea.selectionEnd = 11
		document.body.appendChild(mockTextArea)
		textAreaRef = { current: mockTextArea }
		document.execCommand = vi.fn(() => true)
	})

	afterEach(() => {
		document.body.removeChild(mockTextArea)
		vi.clearAllMocks()
		vi.useRealTimers()
	})

	describe("Tab key acceptance", () => {
		it("should accept full ghost text on Tab key", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow: focus -> input -> completion result
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion text")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion text")

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
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " this is more text")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" this is more text")

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

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Start", " word1 word2 word3")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" word1 word2 word3")

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
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " more text")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" more text")

			// Move cursor to middle
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

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
			mockTextArea.value = "Test1"
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Test1", " text")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" text")

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
			mockTextArea.value = "Test2"
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Test2", " text")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" text")

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

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " world")

			// Verify ghost text is set
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
			mockTextArea.value = "Test3"
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow with whitespace-only ghost text
			simulateCompletionFlow(result.current, mockTextArea, "Test3", "   ")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe("   ")

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
			mockTextArea.value = "Test4"
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow with single word ghost text
			simulateCompletionFlow(result.current, mockTextArea, "Test4", "word")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe("word")

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
			mockTextArea.value = "Test5"
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

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

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			act(() => {
				result.current.clearGhostText()
			})

			expect(result.current.ghostText).toBe("")
		})
	})

	describe("Focus and blur behavior", () => {
		it("should clear ghost text on blur and restore on focus", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			// Blur the textarea
			act(() => {
				result.current.handleBlur()
			})

			expect(result.current.ghostText).toBe("")

			// Focus the textarea again - ghost text should be restored
			act(() => {
				result.current.handleFocus()
			})

			expect(result.current.ghostText).toBe(" completion")
		})

		it("should not restore ghost text if text changed while unfocused", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			// Blur the textarea
			act(() => {
				result.current.handleBlur()
			})

			expect(result.current.ghostText).toBe("")

			// Change the text while unfocused (simulating external change)
			mockTextArea.value = "Different text"
			mockTextArea.selectionStart = 14
			mockTextArea.selectionEnd = 14

			// Focus the textarea again - ghost text should NOT be restored
			act(() => {
				result.current.handleFocus()
			})

			expect(result.current.ghostText).toBe("")
		})

		it("should not request completion when not focused", () => {
			// Clear any previous calls from beforeEach
			vi.mocked(vscode.postMessage).mockClear()

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Don't call handleFocus - simulate typing without focus
			act(() => {
				mockTextArea.value = "Hello world"
				const changeEvent = {
					target: mockTextArea,
				} as React.ChangeEvent<HTMLTextAreaElement>
				result.current.handleInputChange(changeEvent)
			})

			// Advance timers
			act(() => {
				vi.advanceTimersByTime(300)
			})

			// Verify that no completion request was made because we weren't focused
			expect(vscode.postMessage).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: "requestChatCompletion" }),
			)

			// Ghost text should remain empty
			expect(result.current.ghostText).toBe("")
		})

		it("should discard completion result if text changed", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Focus and type
			act(() => {
				result.current.handleFocus()
			})

			act(() => {
				mockTextArea.value = "Hello world"
				mockTextArea.selectionStart = 11
				mockTextArea.selectionEnd = 11
				const changeEvent = {
					target: mockTextArea,
				} as React.ChangeEvent<HTMLTextAreaElement>
				result.current.handleInputChange(changeEvent)
			})

			// Advance timers to trigger completion request
			act(() => {
				vi.advanceTimersByTime(300)
			})

			// Change the text before completion arrives (simulating paste or external change)
			mockTextArea.value = "Different text"

			// Simulate receiving completion result for the old text
			// Use the correct requestId to ensure we're testing the prefix mismatch, not requestId mismatch
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " completion",
						requestId: MOCK_REQUEST_ID,
					},
				})
				window.dispatchEvent(messageEvent)
			})

			// Ghost text should not be set because the text changed (prefix mismatch)
			expect(result.current.ghostText).toBe("")
		})

		it("should discard completion result if cursor is not at end", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Focus and type
			act(() => {
				result.current.handleFocus()
			})

			act(() => {
				mockTextArea.value = "Hello world"
				mockTextArea.selectionStart = 11
				mockTextArea.selectionEnd = 11
				const changeEvent = {
					target: mockTextArea,
				} as React.ChangeEvent<HTMLTextAreaElement>
				result.current.handleInputChange(changeEvent)
			})

			// Advance timers to trigger completion request
			act(() => {
				vi.advanceTimersByTime(300)
			})

			// Move cursor to middle before completion arrives
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			// Simulate receiving completion result
			act(() => {
				const messageEvent = new MessageEvent("message", {
					data: {
						type: "chatCompletionResult",
						text: " completion",
						requestId: MOCK_REQUEST_ID,
					},
				})
				window.dispatchEvent(messageEvent)
			})

			// Ghost text should not be set because cursor is not at end
			expect(result.current.ghostText).toBe("")
		})

		it("should clear ghost text when cursor moves away from end via handleSelect", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			// Move cursor to middle (simulating user clicking or using arrow keys)
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			// Call handleSelect (this is called on selection change events)
			act(() => {
				result.current.handleSelect()
			})

			// Ghost text should be cleared because cursor is no longer at end
			expect(result.current.ghostText).toBe("")
		})

		it("should not clear ghost text when cursor is still at end via handleSelect", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			// Cursor is still at end
			mockTextArea.selectionStart = 11
			mockTextArea.selectionEnd = 11

			// Call handleSelect
			act(() => {
				result.current.handleSelect()
			})

			// Ghost text should still be there
			expect(result.current.ghostText).toBe(" completion")
		})

		it("should clear ghost text when there is a selection via handleSelect", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			// Create a selection (not just cursor position)
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 11

			// Call handleSelect
			act(() => {
				result.current.handleSelect()
			})

			// Ghost text should be cleared because there's a selection
			expect(result.current.ghostText).toBe("")
		})

		it("should restore ghost text when cursor returns to end via handleSelect", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			// Move cursor to middle
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			// Call handleSelect - ghost text should be cleared
			act(() => {
				result.current.handleSelect()
			})
			expect(result.current.ghostText).toBe("")

			// Move cursor back to end
			mockTextArea.selectionStart = 11
			mockTextArea.selectionEnd = 11

			// Call handleSelect again - ghost text should be restored
			act(() => {
				result.current.handleSelect()
			})
			expect(result.current.ghostText).toBe(" completion")
		})

		it("should not restore ghost text when cursor returns to end if text changed", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			// Move cursor to middle
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			// Call handleSelect - ghost text should be cleared
			act(() => {
				result.current.handleSelect()
			})
			expect(result.current.ghostText).toBe("")

			// Change the text
			mockTextArea.value = "Different text"
			mockTextArea.selectionStart = 14
			mockTextArea.selectionEnd = 14

			// Call handleSelect again - ghost text should NOT be restored because text changed
			act(() => {
				result.current.handleSelect()
			})
			expect(result.current.ghostText).toBe("")
		})

		it("should cancel pending completion requests on blur", () => {
			// Clear any previous calls
			vi.mocked(vscode.postMessage).mockClear()

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Focus and type
			act(() => {
				result.current.handleFocus()
			})

			act(() => {
				mockTextArea.value = "Hello world"
				mockTextArea.selectionStart = 11
				mockTextArea.selectionEnd = 11
				const changeEvent = {
					target: mockTextArea,
				} as React.ChangeEvent<HTMLTextAreaElement>
				result.current.handleInputChange(changeEvent)
			})

			// Blur before the debounce timer fires
			act(() => {
				result.current.handleBlur()
			})

			// Advance timers past the debounce period
			act(() => {
				vi.advanceTimersByTime(300)
			})

			// Verify that no completion request was made because blur cancelled it
			expect(vscode.postMessage).not.toHaveBeenCalledWith(
				expect.objectContaining({ type: "requestChatCompletion" }),
			)
		})

		it("should not restore ghost text on focus if cursor is not at end", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			// Blur the textarea
			act(() => {
				result.current.handleBlur()
			})

			expect(result.current.ghostText).toBe("")

			// Move cursor to middle while unfocused
			mockTextArea.selectionStart = 5
			mockTextArea.selectionEnd = 5

			// Focus the textarea again - ghost text should NOT be restored because cursor is not at end
			act(() => {
				result.current.handleFocus()
			})

			expect(result.current.ghostText).toBe("")
		})

		it("should handle null textAreaRef gracefully in handleSelect", () => {
			const nullRef = { current: null } as React.RefObject<HTMLTextAreaElement>

			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef: nullRef,
					enableChatAutocomplete: true,
				}),
			)

			// This should not throw
			act(() => {
				result.current.handleSelect()
			})

			expect(result.current.ghostText).toBe("")
		})

		it("should handle rapid focus/blur/focus cycles correctly", () => {
			const { result } = renderHook(() =>
				useChatGhostText({
					textAreaRef,
					enableChatAutocomplete: true,
				}),
			)

			// Simulate the full flow
			simulateCompletionFlow(result.current, mockTextArea, "Hello world", " completion")

			// Verify ghost text is set
			expect(result.current.ghostText).toBe(" completion")

			// Rapid blur/focus/blur/focus
			act(() => {
				result.current.handleBlur()
			})
			expect(result.current.ghostText).toBe("")

			act(() => {
				result.current.handleFocus()
			})
			expect(result.current.ghostText).toBe(" completion")

			act(() => {
				result.current.handleBlur()
			})
			expect(result.current.ghostText).toBe("")

			act(() => {
				result.current.handleFocus()
			})
			expect(result.current.ghostText).toBe(" completion")
		})
	})
})
