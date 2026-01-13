/**
 * Tests for /new command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { newCommand } from "../new.js"
import type { CommandContext } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"

describe("/new command", () => {
	let mockContext: CommandContext

	beforeEach(() => {
		vi.spyOn(process.stdout, "write").mockImplementation(() => true)

		mockContext = createMockContext({
			input: "/new",
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("Command metadata", () => {
		it("should have correct name", () => {
			expect(newCommand.name).toBe("new")
		})

		it("should have correct aliases", () => {
			expect(newCommand.aliases).toEqual(["n", "start"])
		})

		it("should have correct description", () => {
			expect(newCommand.description).toBe("Start a new task with a clean slate")
		})

		it("should have correct category", () => {
			expect(newCommand.category).toBe("system")
		})

		it("should have correct priority", () => {
			expect(newCommand.priority).toBe(9)
		})

		it("should have correct usage", () => {
			expect(newCommand.usage).toBe("/new")
		})

		it("should have examples", () => {
			expect(newCommand.examples).toEqual(["/new", "/n", "/start"])
		})
	})

	describe("Command execution", () => {
		it("should clear the extension task state", async () => {
			await newCommand.handler(mockContext)

			expect(mockContext.clearTask).toHaveBeenCalledTimes(1)
		})

		it("should replace CLI messages with welcome message", async () => {
			await newCommand.handler(mockContext)

			expect(mockContext.replaceMessages).toHaveBeenCalledTimes(1)
			const replacedMessages = (mockContext.replaceMessages as ReturnType<typeof vi.fn>).mock.calls[0][0]

			expect(replacedMessages).toHaveLength(1)
			expect(replacedMessages[0]).toMatchObject({
				type: "welcome",
				content: "",
			})

			expect(replacedMessages[0].metadata?.welcomeOptions).toMatchObject({
				showInstructions: true,
				instructions: [
					"🎉 Fresh start! Ready for a new task.",
					"All previous messages and task state have been cleared.",
					"Type your message to begin, or use /help to explore available commands.",
				],
			})
		})

		it("should execute operations in correct order", async () => {
			const callOrder: string[] = []

			mockContext.clearTask = vi.fn().mockImplementation(async () => {
				callOrder.push("clearTask")
			})

			mockContext.replaceMessages = vi.fn().mockImplementation(() => {
				callOrder.push("replaceMessages")
			})

			mockContext.refreshTerminal = vi.fn().mockImplementation(async () => {
				callOrder.push("refreshTerminal")
			})

			await newCommand.handler(mockContext)

			expect(callOrder).toEqual(["clearTask", "replaceMessages", "refreshTerminal"])
		})

		it("should handle clearTask errors gracefully", async () => {
			const error = new Error("Failed to clear task")
			mockContext.clearTask = vi.fn().mockRejectedValue(error)

			await expect(newCommand.handler(mockContext)).rejects.toThrow("Failed to clear task")
		})
	})

	describe("Integration scenarios", () => {
		it("should work with all aliases", async () => {
			for (const alias of newCommand.aliases) {
				const context = {
					...mockContext,
					input: `/${alias}`,
					clearTask: vi.fn().mockResolvedValue(undefined),
					replaceMessages: vi.fn(),
				}
				await newCommand.handler(context)

				expect(context.clearTask).toHaveBeenCalled()
				expect(context.replaceMessages).toHaveBeenCalled()
			}
		})

		it("should create a complete fresh start experience", async () => {
			await newCommand.handler(mockContext)

			expect(mockContext.clearTask).toHaveBeenCalled()
			expect(mockContext.replaceMessages).toHaveBeenCalled()
			expect(mockContext.refreshTerminal).toHaveBeenCalled()

			const replacedMessages = (mockContext.replaceMessages as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(replacedMessages).toHaveLength(1)
			expect(replacedMessages[0].type).toBe("welcome")
			expect(replacedMessages[0].metadata?.welcomeOptions?.showInstructions).toBe(true)
		})
	})
})
