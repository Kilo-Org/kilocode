// kilocode_change - new file
// npx vitest src/core/webview/__tests__/webviewMessageHandler.singleCompletion.spec.ts

import type { Mock } from "vitest"
import { webviewMessageHandler } from "../webviewMessageHandler"
import type { ClineProvider } from "../ClineProvider"
import * as singleCompletionHandler from "../../../utils/single-completion-handler"

// Mock the single completion handler
vi.mock("../../../utils/single-completion-handler", () => ({
	singleCompletionHandler: vi.fn(),
}))

// Mock vscode
vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
	},
}))

const mockSingleCompletionHandler = singleCompletionHandler.singleCompletionHandler as Mock

// Mock ClineProvider
const mockClineProvider = {
	getState: vi.fn(),
	postMessageToWebview: vi.fn(),
	log: vi.fn(),
	contextProxy: {
		getValue: vi.fn(),
		setValue: vi.fn(),
	},
} as unknown as ClineProvider

describe("webviewMessageHandler - singleCompletion", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockClineProvider.getState = vi.fn().mockResolvedValue({
			apiConfiguration: {
				apiProvider: "anthropic",
				apiKey: "test-key",
				apiModelId: "claude-3-5-sonnet-20241022",
			},
		})
	})

	describe("Successful Completion Flow", () => {
		it("should handle successful completion with all required parameters", async () => {
			const completionRequestId = "test-request-123"
			const promptText = "Write a hello world function"
			const expectedResult = "function helloWorld() {\n  console.log('Hello, World!');\n}"

			mockSingleCompletionHandler.mockResolvedValue(expectedResult)

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: promptText,
				completionRequestId,
			})

			// Verify handler was called with correct config and prompt
			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(
				expect.objectContaining({
					apiProvider: "anthropic",
					apiKey: "test-key",
					apiModelId: "claude-3-5-sonnet-20241022",
				}),
				promptText,
			)

			// Verify success response was sent
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionText: expectedResult,
				success: true,
			})
		})

		it("should handle empty completion result", async () => {
			const completionRequestId = "test-request-789"
			const promptText = "Generate nothing"

			mockSingleCompletionHandler.mockResolvedValue("")

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: promptText,
				completionRequestId,
			})

			// Verify success response with empty string
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionText: "",
				success: true,
			})
		})
	})

	describe("Error Handling", () => {
		it("should handle missing completionRequestId", async () => {
			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: "test prompt",
				// Missing completionRequestId
			})

			// Verify error response was sent
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId: undefined,
				completionError: "Missing completionRequestId",
				success: false,
			})

			// Handler should not be called
			expect(mockSingleCompletionHandler).not.toHaveBeenCalled()
		})

		it("should handle missing prompt text", async () => {
			const completionRequestId = "test-request-error-1"

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				completionRequestId,
				// Missing text
			})

			// Verify error response was sent
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionError: "Missing prompt text",
				success: false,
			})

			// Handler should not be called
			expect(mockSingleCompletionHandler).not.toHaveBeenCalled()
		})

		it("should handle API configuration errors", async () => {
			const completionRequestId = "test-request-error-2"
			const promptText = "test prompt"

			// Mock getState to return invalid config
			mockClineProvider.getState = vi.fn().mockResolvedValue({
				apiConfiguration: null,
			})

			mockSingleCompletionHandler.mockRejectedValue(new Error("No valid API configuration provided"))

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: promptText,
				completionRequestId,
			})

			// Verify error response was sent
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionError: "No valid API configuration provided",
				success: false,
			})
		})

		it("should handle completion handler failures", async () => {
			const completionRequestId = "test-request-error-3"
			const promptText = "test prompt"
			const errorMessage = "API rate limit exceeded"

			mockSingleCompletionHandler.mockRejectedValue(new Error(errorMessage))

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: promptText,
				completionRequestId,
			})

			// Verify error response was sent
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionError: errorMessage,
				success: false,
			})
		})

		it("should handle non-Error exceptions", async () => {
			const completionRequestId = "test-request-error-4"
			const promptText = "test prompt"

			mockSingleCompletionHandler.mockRejectedValue("String error")

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: promptText,
				completionRequestId,
			})

			// Verify error response was sent with string conversion
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionError: "String error",
				success: false,
			})
		})

		it("should handle network errors", async () => {
			const completionRequestId = "test-request-error-5"
			const promptText = "test prompt"

			mockSingleCompletionHandler.mockRejectedValue(new Error("Network request failed"))

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: promptText,
				completionRequestId,
			})

			// Verify error response was sent
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionError: "Network request failed",
				success: false,
			})
		})
	})

	describe("Edge Cases", () => {
		it("should handle very long prompts", async () => {
			const completionRequestId = "test-request-long"
			const longPrompt = "a".repeat(10000)
			const expectedResult = "result"

			mockSingleCompletionHandler.mockResolvedValue(expectedResult)

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: longPrompt,
				completionRequestId,
			})

			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(expect.any(Object), longPrompt)
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionText: expectedResult,
				success: true,
			})
		})

		it("should handle special characters in prompt", async () => {
			const completionRequestId = "test-request-special"
			const specialPrompt = "Test with\nnewlines\tand\ttabs and 'quotes' and \"double quotes\""
			const expectedResult = "result"

			mockSingleCompletionHandler.mockResolvedValue(expectedResult)

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: specialPrompt,
				completionRequestId,
			})

			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(expect.any(Object), specialPrompt)
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionText: expectedResult,
				success: true,
			})
		})

		it("should handle Unicode characters in prompt", async () => {
			const completionRequestId = "test-request-unicode"
			const unicodePrompt = "Test with émojis 🚀 and 中文字符"
			const expectedResult = "Unicode result 🎉"

			mockSingleCompletionHandler.mockResolvedValue(expectedResult)

			await webviewMessageHandler(mockClineProvider, {
				type: "singleCompletion",
				text: unicodePrompt,
				completionRequestId,
			})

			expect(mockSingleCompletionHandler).toHaveBeenCalledWith(expect.any(Object), unicodePrompt)
			expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "singleCompletionResult",
				completionRequestId,
				completionText: expectedResult,
				success: true,
			})
		})

		it("should handle multiple concurrent requests with different IDs", async () => {
			const requests = [
				{ id: "req-1", prompt: "prompt 1", result: "result 1" },
				{ id: "req-2", prompt: "prompt 2", result: "result 2" },
				{ id: "req-3", prompt: "prompt 3", result: "result 3" },
			]

			// Mock handler to return different results based on prompt
			mockSingleCompletionHandler.mockImplementation(async (_config, prompt) => {
				const req = requests.find((r) => r.prompt === prompt)
				return req?.result || "default"
			})

			// Send all requests concurrently
			await Promise.all(
				requests.map((req) =>
					webviewMessageHandler(mockClineProvider, {
						type: "singleCompletion",
						text: req.prompt,
						completionRequestId: req.id,
					}),
				),
			)

			// Verify each request got its own response
			requests.forEach((req) => {
				expect(mockClineProvider.postMessageToWebview).toHaveBeenCalledWith({
					type: "singleCompletionResult",
					completionRequestId: req.id,
					completionText: req.result,
					success: true,
				})
			})
		})
	})
})
