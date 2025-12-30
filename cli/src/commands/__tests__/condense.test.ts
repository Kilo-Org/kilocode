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
		it("should send condenseTaskContextRequest webview message", async () => {
			await condenseCommand.handler(mockContext)

			expect(mockContext.sendWebviewMessage).toHaveBeenCalledTimes(1)
			expect(mockContext.sendWebviewMessage).toHaveBeenCalledWith({
				type: "condenseTaskContextRequest",
				text: "test-task-123",
			})
		})

		it("should add system message before condensing", async () => {
			await condenseCommand.handler(mockContext)

			expect(mockContext.addMessage).toHaveBeenCalledTimes(1)
			const addedMessage = (mockContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(addedMessage.type).toBe("system")
			expect(addedMessage.content).toContain("Condensing")
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

			expect(emptyContext.sendWebviewMessage).not.toHaveBeenCalled()
			expect(emptyContext.addMessage).toHaveBeenCalledTimes(1)
			const addedMessage = (emptyContext.addMessage as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(addedMessage.type).toBe("error")
			expect(addedMessage.content).toContain("No active task")
		})
	})
})
