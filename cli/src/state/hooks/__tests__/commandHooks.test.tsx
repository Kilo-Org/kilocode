/**
 * Tests for command-related hooks
 *
 * Note: These are basic unit tests for the hook logic.
 * Full integration testing would require @testing-library/react.
 */

import React from "react"
import { describe, it, expect, vi } from "vitest"
import { createStore } from "jotai"
import { render } from "ink-testing-library"
import { Provider } from "jotai"

describe("Command Hook Exports", () => {
	describe("Hook Exports", () => {
		it("should export useCommandContext", async () => {
			const { useCommandContext } = await import("../useCommandContext.js")
			expect(useCommandContext).toBeDefined()
			expect(typeof useCommandContext).toBe("function")
		})

		it("should export useCommandHandler", async () => {
			const { useCommandHandler } = await import("../useCommandHandler.js")
			expect(useCommandHandler).toBeDefined()
			expect(typeof useCommandHandler).toBe("function")
		})

		it("should export useMessageHandler", async () => {
			const { useMessageHandler } = await import("../useMessageHandler.js")
			expect(useMessageHandler).toBeDefined()
			expect(typeof useMessageHandler).toBe("function")
		})
	})

	describe("Hook Integration in index.ts", () => {
		it("should export all new command hooks from index", async () => {
			const hooks = await import("../index.js")

			// Check new hooks are exported
			expect(hooks.useCommandContext).toBeDefined()
			expect(hooks.useCommandHandler).toBeDefined()
			expect(hooks.useMessageHandler).toBeDefined()

			// Check existing hooks are still exported
			expect(hooks.useExtensionService).toBeDefined()
			expect(hooks.useWebviewMessage).toBeDefined()
			expect(hooks.useExtensionMessage).toBeDefined()
			expect(hooks.useTaskManagement).toBeDefined()
			expect(hooks.useModelSelection).toBeDefined()
			expect(hooks.useCommandInput).toBeDefined()
		})

		it("should export hook types", async () => {
			const hooks = await import("../index.js")

			// Verify functions are exported
			expect(typeof hooks.useCommandContext).toBe("function")
			expect(typeof hooks.useCommandHandler).toBe("function")
			expect(typeof hooks.useMessageHandler).toBe("function")
		})
	})
})

describe("Command Executor Service", () => {
	it("should export command executor functions", async () => {
		const executor = await import("../../../services/commandExecutor.js")

		expect(executor.validateCommand).toBeDefined()
		expect(executor.executeCommandWithContext).toBeDefined()
		expect(executor.parseCommandInput).toBeDefined()
		expect(executor.hasRequiredArguments).toBeDefined()
		expect(executor.validateArguments).toBeDefined()
		expect(executor.formatCommandError).toBeDefined()
		expect(executor.getCommandUsage).toBeDefined()
		expect(executor.isCompleteCommand).toBeDefined()
	})

	it("should validate command functions are callable", async () => {
		const executor = await import("../../../services/commandExecutor.js")

		expect(typeof executor.validateCommand).toBe("function")
		expect(typeof executor.executeCommandWithContext).toBe("function")
		expect(typeof executor.parseCommandInput).toBe("function")
		expect(typeof executor.hasRequiredArguments).toBe("function")
		expect(typeof executor.validateArguments).toBe("function")
		expect(typeof executor.formatCommandError).toBe("function")
		expect(typeof executor.getCommandUsage).toBe("function")
		expect(typeof executor.isCompleteCommand).toBe("function")
	})
})

describe("useCommandHandler", () => {
	it("should reset isExecuting to false after command execution", async () => {
		const store = createStore()
		const { useCommandHandler } = await import("../useCommandHandler.js")

		let hookResult: ReturnType<typeof useCommandHandler> | undefined

		const TestComponent = () => {
			hookResult = useCommandHandler()
			return null
		}

		render(
			<Provider store={store}>
				<TestComponent />
			</Provider>,
		)

		// Initially, isExecuting should be false
		expect(hookResult?.isExecuting).toBe(false)

		// Mock onExit function
		const onExit = vi.fn()

		// Execute a command (using /help as it's a simple command)
		if (hookResult) {
			await hookResult.executeCommand("/help", onExit)
		}

		// After execution, isExecuting should be reset to false
		expect(hookResult?.isExecuting).toBe(false)
	})

	it("should reset isExecuting to false even when command fails", async () => {
		const store = createStore()
		const { useCommandHandler } = await import("../useCommandHandler.js")

		let hookResult: ReturnType<typeof useCommandHandler> | undefined

		const TestComponent = () => {
			hookResult = useCommandHandler()
			return null
		}

		render(
			<Provider store={store}>
				<TestComponent />
			</Provider>,
		)

		// Initially, isExecuting should be false
		expect(hookResult?.isExecuting).toBe(false)

		// Mock onExit function
		const onExit = vi.fn()

		// Execute an invalid command
		if (hookResult) {
			await hookResult.executeCommand("/invalid-command", onExit)
		}

		// After execution (even failed), isExecuting should be reset to false
		expect(hookResult?.isExecuting).toBe(false)
	})
})
