import { describe, it, expect } from "vitest"
import { startSessionMessageSchema } from "../types"

/**
 * Test suite for startSession message validation using zod schema.
 * Ensures runtime validation of webview messages is working correctly.
 */
describe("startSessionMessageSchema validation", () => {
	describe("valid messages", () => {
		it("should accept minimal valid message with only prompt", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.prompt).toBe("Build a todo app")
				expect(result.data.model).toBeUndefined()
				expect(result.data.parallelMode).toBeUndefined()
			}
		})

		it("should accept message with model selection", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				model: "claude-sonnet-4-20250514",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.model).toBe("claude-sonnet-4-20250514")
			}
		})

		it("should accept message with parallel mode enabled", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				parallelMode: true,
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.parallelMode).toBe(true)
			}
		})

		it("should accept message with existing branch", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Continue work on feature",
				existingBranch: "feature/my-branch",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.existingBranch).toBe("feature/my-branch")
			}
		})

		it("should accept message with multi-version mode", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				versions: 3,
				labels: ["Version A", "Version B", "Version C"],
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.versions).toBe(3)
				expect(result.data.labels).toEqual(["Version A", "Version B", "Version C"])
			}
		})

		it("should accept fully populated message", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				model: "claude-sonnet-4-20250514",
				parallelMode: true,
				existingBranch: "feature/my-branch",
				versions: 2,
				labels: ["Version A", "Version B"],
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data.prompt).toBe("Build a todo app")
				expect(result.data.model).toBe("claude-sonnet-4-20250514")
				expect(result.data.parallelMode).toBe(true)
				expect(result.data.existingBranch).toBe("feature/my-branch")
				expect(result.data.versions).toBe(2)
				expect(result.data.labels).toEqual(["Version A", "Version B"])
			}
		})
	})

	describe("invalid messages", () => {
		it("should reject message without type", () => {
			const message = {
				prompt: "Build a todo app",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it("should reject message with wrong type", () => {
			const message = {
				type: "agentManager.stopSession",
				prompt: "Build a todo app",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it("should reject message without prompt", () => {
			const message = {
				type: "agentManager.startSession",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it("should reject message with non-string prompt", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: 123,
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it("should reject message with non-string model", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				model: 123,
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it("should reject message with non-boolean parallelMode", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				parallelMode: "true",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it("should reject message with non-number versions", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				versions: "3",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it("should reject message with non-array labels", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				labels: "Version A",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it("should reject message with non-string items in labels array", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				labels: [1, 2, 3],
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})
	})

	describe("type coercion behavior", () => {
		it("should not coerce string to number for versions", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				versions: "3",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})

		it("should not coerce string to boolean for parallelMode", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				parallelMode: "true",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(false)
		})
	})

	describe("extra fields handling", () => {
		it("should strip unknown fields by default", () => {
			const message = {
				type: "agentManager.startSession",
				prompt: "Build a todo app",
				unknownField: "should be stripped",
			}

			const result = startSessionMessageSchema.safeParse(message)
			expect(result.success).toBe(true)
			if (result.success) {
				expect((result.data as Record<string, unknown>).unknownField).toBeUndefined()
			}
		})
	})
})
