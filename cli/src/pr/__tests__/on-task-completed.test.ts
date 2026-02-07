import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
	finishWithOnTaskCompleted,
	onTaskCompletedTimeout,
	validateOnTaskCompletedPrompt,
} from "../on-task-completed.js"
import type { CLI } from "../../cli.js"

// Mock the logs module
vi.mock("../../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

// Mock the telemetry service
vi.mock("../../services/telemetry/index.js", () => ({
	getTelemetryService: () => ({
		trackFeatureUsed: vi.fn(),
		trackError: vi.fn(),
	}),
}))

describe("on-task-completed", () => {
	let mockCli: CLI
	let mockService: {
		sendWebviewMessage: ReturnType<typeof vi.fn>
	}

	beforeEach(() => {
		vi.useFakeTimers()

		mockService = {
			sendWebviewMessage: vi.fn().mockResolvedValue(undefined),
		}

		mockCli = {
			getService: vi.fn().mockReturnValue(mockService),
		} as unknown as CLI
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
	})

	describe("finishWithOnTaskCompleted", () => {
		it("should send the custom prompt to the agent", async () => {
			const customPrompt = "Create a pull request for this branch"

			const resultPromise = finishWithOnTaskCompleted(mockCli, {
				cwd: "/test/workspace",
				prompt: customPrompt,
			})

			// Advance timers to complete the timeout
			await vi.advanceTimersByTimeAsync(onTaskCompletedTimeout)

			const beforeExit = await resultPromise

			expect(mockService.sendWebviewMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: customPrompt,
			})

			// beforeExit should be a function
			expect(typeof beforeExit).toBe("function")
		})

		it("should return early if service is not available", async () => {
			const mockCliNoService = {
				getService: vi.fn().mockReturnValue(null),
			} as unknown as CLI

			const beforeExit = await finishWithOnTaskCompleted(mockCliNoService, {
				cwd: "/test/workspace",
				prompt: "Test prompt",
			})

			expect(mockService.sendWebviewMessage).not.toHaveBeenCalled()
			expect(typeof beforeExit).toBe("function")
		})

		it("should handle errors gracefully", async () => {
			mockService.sendWebviewMessage.mockRejectedValue(new Error("Network error"))

			const beforeExit = await finishWithOnTaskCompleted(mockCli, {
				cwd: "/test/workspace",
				prompt: "Test prompt",
			})

			expect(typeof beforeExit).toBe("function")
		})

		it("should support multiline prompts", async () => {
			const multilinePrompt = `Step 1: Check git status
Step 2: Stage all changes
Step 3: Commit with a message
Step 4: Push to remote`

			const resultPromise = finishWithOnTaskCompleted(mockCli, {
				cwd: "/test/workspace",
				prompt: multilinePrompt,
			})

			await vi.advanceTimersByTimeAsync(onTaskCompletedTimeout)

			await resultPromise

			expect(mockService.sendWebviewMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: multilinePrompt,
			})
		})

		it("should support prompts with special characters", async () => {
			const specialPrompt = `Create PR with title: "feat: add new feature" and body containing \`code\` blocks`

			const resultPromise = finishWithOnTaskCompleted(mockCli, {
				cwd: "/test/workspace",
				prompt: specialPrompt,
			})

			await vi.advanceTimersByTimeAsync(onTaskCompletedTimeout)

			await resultPromise

			expect(mockService.sendWebviewMessage).toHaveBeenCalledWith({
				type: "askResponse",
				askResponse: "messageResponse",
				text: specialPrompt,
			})
		})
	})

	describe("timeout constant", () => {
		it("should have a reasonable timeout value", () => {
			expect(onTaskCompletedTimeout).toBe(90000) // 90 seconds
		})
	})

	describe("validateOnTaskCompletedPrompt", () => {
		it("should accept a valid prompt", () => {
			const result = validateOnTaskCompletedPrompt("Create a pull request")
			expect(result.valid).toBe(true)
			expect(result.error).toBeUndefined()
		})

		it("should reject an empty prompt", () => {
			const result = validateOnTaskCompletedPrompt("")
			expect(result.valid).toBe(false)
			expect(result.error).toBe("--on-task-completed prompt cannot be empty")
		})

		it("should reject a whitespace-only prompt", () => {
			const result = validateOnTaskCompletedPrompt("   \t\n  ")
			expect(result.valid).toBe(false)
			expect(result.error).toBe("--on-task-completed prompt cannot be empty")
		})

		it("should reject a prompt exceeding maximum length", () => {
			const longPrompt = "a".repeat(50001)
			const result = validateOnTaskCompletedPrompt(longPrompt)
			expect(result.valid).toBe(false)
			expect(result.error).toContain("exceeds maximum length")
		})

		it("should accept a prompt at maximum length", () => {
			const maxPrompt = "a".repeat(50000)
			const result = validateOnTaskCompletedPrompt(maxPrompt)
			expect(result.valid).toBe(true)
		})

		describe("special characters and markdown", () => {
			it("should accept prompts with markdown formatting", () => {
				const result = validateOnTaskCompletedPrompt("# Title\n\n- item 1\n- item 2\n\n```code```")
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with special characters", () => {
				const result = validateOnTaskCompletedPrompt('Create PR with title: "feat: add feature"')
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with unicode characters", () => {
				const result = validateOnTaskCompletedPrompt("Create PR 🚀 with emoji and 中文")
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with newlines", () => {
				const result = validateOnTaskCompletedPrompt("Step 1\nStep 2\nStep 3")
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with tabs and mixed whitespace", () => {
				const result = validateOnTaskCompletedPrompt("Step 1\t\tStep 2\n\t\tStep 3")
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with quotes", () => {
				const result = validateOnTaskCompletedPrompt(`Use 'single' and "double" quotes`)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with escape sequences", () => {
				const result = validateOnTaskCompletedPrompt("Path: C:\\Users\\test\\file.txt")
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with JSON content", () => {
				const result = validateOnTaskCompletedPrompt('{"key": "value", "array": [1, 2, 3]}')
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with shell commands", () => {
				const result = validateOnTaskCompletedPrompt("Run: git commit -m 'message' && git push")
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with HTML/XML content", () => {
				const result = validateOnTaskCompletedPrompt("<div class='test'>Content</div>")
				expect(result.valid).toBe(true)
			})
		})
	})
})
