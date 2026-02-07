/**
 * Tests for the /condense command
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { condenseCommand } from "../condense.js"
import type { CommandContext } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"

describe("condenseCommand", () => {
	let mockContext: CommandContext

	beforeEach(() => {
		// Create context with currentTask so condense can proceed
		mockContext = createMockContext({
			input: "/condense",
			currentTask: {
				id: "test-task-123",
				ts: Date.now(),
				task: "Test task",
			},
			chatMessages: [
				{
					ts: Date.now(),
					type: "say",
					say: "text",
					text: "Hello, world!",
				},
			],
		})
	})

	describe("command metadata", () => {
		it("should have correct name", () => {
			expect(condenseCommand.name).toBe("condense")
		})

		it("should have correct aliases", () => {
			expect(condenseCommand.aliases).toEqual([])
		})

		it("should have correct category", () => {
			expect(condenseCommand.category).toBe("chat")
		})

		it("should have correct priority", () => {
			expect(condenseCommand.priority).toBe(6)
		})

		it("should have description", () => {
			expect(condenseCommand.description).toBeTruthy()
			expect(condenseCommand.description.toLowerCase()).toContain("condense")
		})

		it("should have usage examples", () => {
			expect(condenseCommand.examples).toHaveLength(1)
			expect(condenseCommand.examples).toContain("/condense")
		})
	})

	describe("handler", () => {
		it("should call condenseAndWait with task ID", async () => {
			await condenseCommand.handler(mockContext)

			expect(mockContext.condenseAndWait).toHaveBeenCalledTimes(1)
			expect(mockContext.condenseAndWait).toHaveBeenCalledWith("test-task-123")
		})

		it("should add system message before condensing", async () => {
			await condenseCommand.handler(mockContext)

			// First call is the "Condensing..." message
			const addedMessage = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(addedMessage.type).toBe("system")
			expect(addedMessage.content).toContain("Condensing")
		})

		it("should add completion message after successful condensation", async () => {
			await condenseCommand.handler(mockContext)

			// Should have two messages: start and complete
			expect(mockContext.addMessage).toHaveBeenCalledTimes(2)
			const completionMessage = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[1][0]
			expect(completionMessage.type).toBe("system")
			expect(completionMessage.content).toContain("complete")
		})

		it("should execute without errors", async () => {
			await expect(condenseCommand.handler(mockContext)).resolves.not.toThrow()
		})

		it("should NOT clear task state", async () => {
			await condenseCommand.handler(mockContext)

			expect(mockContext.clearTask).not.toHaveBeenCalled()
		})

		it("should NOT clear messages", async () => {
			await condenseCommand.handler(mockContext)

			expect(mockContext.clearMessages).not.toHaveBeenCalled()
		})

		it("should show error when no active task exists", async () => {
			const emptyContext = createMockContext({
				input: "/condense",
				currentTask: null,
				chatMessages: [],
			})

			await condenseCommand.handler(emptyContext)

			expect(emptyContext.condenseAndWait).not.toHaveBeenCalled()
			expect(emptyContext.addMessage).toHaveBeenCalledTimes(1)
			const addedMessage = (emptyContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(addedMessage.type).toBe("error")
			expect(addedMessage.content).toContain("No active task")
		})

		it("should show error message when condensation fails", async () => {
			const errorContext = createMockContext({
				input: "/condense",
				currentTask: {
					id: "test-task-123",
					ts: Date.now(),
					task: "Test task",
				},
				condenseAndWait: vi.fn().mockRejectedValue(new Error("Condensation timed out")),
			})

			await condenseCommand.handler(errorContext)

			expect(errorContext.addMessage).toHaveBeenCalledTimes(2)
			const errorMessage = (errorContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[1][0]
			expect(errorMessage.type).toBe("error")
			expect(errorMessage.content).toContain("Condensation timed out")
		})
	})
})
