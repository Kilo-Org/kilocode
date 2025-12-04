/**
 * Tests for the /clear command
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { clearCommand } from "../clear.js"
import type { CommandContext } from "../core/types.js"
import { createMockContext } from "./helpers/mockContext.js"

describe("clearCommand", () => {
	let mockContext: CommandContext

	beforeEach(() => {
		mockContext = createMockContext({
			input: "/clear",
		})
	})

	describe("command metadata", () => {
		it("should have correct name", () => {
			expect(clearCommand.name).toBe("clear")
		})

		it("should have correct aliases", () => {
			expect(clearCommand.aliases).toEqual(["c", "cls"])
		})

		it("should have correct category", () => {
			expect(clearCommand.category).toBe("system")
		})

		it("should have correct priority", () => {
			expect(clearCommand.priority).toBe(8)
		})

		it("should have description", () => {
			expect(clearCommand.description).toBeTruthy()
			expect(clearCommand.description).toContain("display")
		})

		it("should have usage examples", () => {
			expect(clearCommand.examples).toHaveLength(3)
			expect(clearCommand.examples).toContain("/clear")
			expect(clearCommand.examples).toContain("/c")
			expect(clearCommand.examples).toContain("/cls")
		})
	})

	describe("handler", () => {
		it("should set message cutoff timestamp", async () => {
			const beforeTime = Date.now()
			await clearCommand.handler(mockContext)
			const afterTime = Date.now()

			expect(mockContext.setMessageCutoffTimestamp).toHaveBeenCalledTimes(1)
			const timestamp = (mockContext.setMessageCutoffTimestamp as ReturnType<typeof vi.fn>).mock.calls[0][0]
			expect(timestamp).toBeGreaterThanOrEqual(beforeTime)
			expect(timestamp).toBeLessThanOrEqual(afterTime)
		})

		it("should NOT replace messages", async () => {
			await clearCommand.handler(mockContext)

			expect(mockContext.replaceMessages).not.toHaveBeenCalled()
		})

		it("should NOT call clearTask (unlike /new command)", async () => {
			await clearCommand.handler(mockContext)

			expect(mockContext.clearTask).not.toHaveBeenCalled()
		})

		it("should NOT call clearMessages", async () => {
			await clearCommand.handler(mockContext)

			expect(mockContext.clearMessages).not.toHaveBeenCalled()
		})

		it("should execute without errors", async () => {
			await expect(clearCommand.handler(mockContext)).resolves.not.toThrow()
		})
	})

	describe("comparison with /new command", () => {
		it("should have different behavior than /new", async () => {
			// /clear should:
			// 1. Set cutoff timestamp (hide messages)
			// 2. NOT replace messages
			// 3. NOT clear extension task state
			// 4. NOT write escape sequences to stdout (to avoid Ink conflicts)

			await clearCommand.handler(mockContext)

			// Verify /clear behavior
			expect(mockContext.setMessageCutoffTimestamp).toHaveBeenCalled()
			expect(mockContext.replaceMessages).not.toHaveBeenCalled()
			expect(mockContext.clearTask).not.toHaveBeenCalled()
		})

		it("should not write directly to stdout to avoid Ink conflicts", async () => {
			// Mock stdout.write to verify it's not called
			const stdoutWriteSpy = vi.spyOn(process.stdout, "write")

			await clearCommand.handler(mockContext)

			// Verify stdout.write was NOT called
			// This prevents yoga-layout crashes when Ink is managing the terminal
			expect(stdoutWriteSpy).not.toHaveBeenCalled()

			stdoutWriteSpy.mockRestore()
		})
	})
})
