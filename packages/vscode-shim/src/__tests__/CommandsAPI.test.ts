import { CommandsAPI } from "../api/CommandsAPI.js"

describe("CommandsAPI", () => {
	let commands: CommandsAPI

	beforeEach(() => {
		commands = new CommandsAPI()
	})

	describe("registerCommand()", () => {
		it("should register a command", () => {
			const callback = vi.fn()

			commands.registerCommand("test.command", callback)
			commands.executeCommand("test.command")

			expect(callback).toHaveBeenCalled()
		})

		it("should return a disposable", () => {
			const callback = vi.fn()

			const disposable = commands.registerCommand("test.command", callback)

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})

		it("should unregister command on dispose", async () => {
			const callback = vi.fn()

			const disposable = commands.registerCommand("test.command", callback)
			disposable.dispose()
			await commands.executeCommand("test.command")

			expect(callback).not.toHaveBeenCalled()
		})

		it("should allow registering multiple commands", () => {
			const callback1 = vi.fn()
			const callback2 = vi.fn()

			commands.registerCommand("test.command1", callback1)
			commands.registerCommand("test.command2", callback2)

			commands.executeCommand("test.command1")
			commands.executeCommand("test.command2")

			expect(callback1).toHaveBeenCalled()
			expect(callback2).toHaveBeenCalled()
		})
	})

	describe("executeCommand()", () => {
		it("should execute registered command", async () => {
			const callback = vi.fn().mockReturnValue("result")

			commands.registerCommand("test.command", callback)
			const result = await commands.executeCommand("test.command")

			expect(result).toBe("result")
		})

		it("should pass arguments to command handler", async () => {
			const callback = vi.fn()

			commands.registerCommand("test.command", callback)
			await commands.executeCommand("test.command", "arg1", "arg2", 123)

			expect(callback).toHaveBeenCalledWith("arg1", "arg2", 123)
		})

		it("should return promise for unknown command", () => {
			const result = commands.executeCommand("unknown.command")

			expect(result).toBeInstanceOf(Promise)
		})

		it("should resolve to undefined for unknown command", async () => {
			const result = await commands.executeCommand("unknown.command")

			expect(result).toBeUndefined()
		})

		it("should reject if handler throws", async () => {
			commands.registerCommand("test.error", () => {
				throw new Error("Test error")
			})

			await expect(commands.executeCommand("test.error")).rejects.toThrow("Test error")
		})

		it("should handle async command handlers", async () => {
			commands.registerCommand("test.async", async () => {
				return "async result"
			})

			const result = await commands.executeCommand("test.async")

			expect(result).toBe("async result")
		})
	})

	describe("built-in commands", () => {
		it("should handle workbench.action.files.saveFiles", async () => {
			const result = await commands.executeCommand("workbench.action.files.saveFiles")

			expect(result).toBeUndefined()
		})

		it("should handle workbench.action.closeWindow", async () => {
			const result = await commands.executeCommand("workbench.action.closeWindow")

			expect(result).toBeUndefined()
		})

		it("should handle workbench.action.reloadWindow", async () => {
			const result = await commands.executeCommand("workbench.action.reloadWindow")

			expect(result).toBeUndefined()
		})
	})

	describe("generic type support", () => {
		it("should support typed return values", async () => {
			commands.registerCommand("test.typed", () => 42)

			const result = await commands.executeCommand<number>("test.typed")

			expect(result).toBe(42)
		})

		it("should support complex return types", async () => {
			const expected = { name: "test", value: 123 }
			commands.registerCommand("test.object", () => expected)

			const result = await commands.executeCommand<{ name: string; value: number }>("test.object")

			expect(result).toEqual(expected)
		})
	})

	describe("command overwriting", () => {
		it("should allow registering same command multiple times", () => {
			const callback1 = vi.fn().mockReturnValue(1)
			const callback2 = vi.fn().mockReturnValue(2)

			commands.registerCommand("test.command", callback1)
			commands.registerCommand("test.command", callback2)

			// Last registration wins
			const result = commands.executeCommand("test.command")

			expect(result).resolves.toBe(2)
		})
	})
})
