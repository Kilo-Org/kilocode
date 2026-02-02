import {
	type GlobalCommand,
	type GlobalCommandAction,
	GLOBAL_COMMANDS,
	getGlobalCommand,
	getGlobalCommandsForAutocomplete,
} from "../commands.js"

describe("globalCommands", () => {
	describe("GLOBAL_COMMANDS", () => {
		it("should contain the /new command", () => {
			const newCommand = GLOBAL_COMMANDS.find((cmd) => cmd.name === "new")
			expect(newCommand).toBeDefined()
			expect(newCommand?.action).toBe("clearTask")
			expect(newCommand?.description).toBe("Start a new task")
		})

		it("should have valid structure for all commands", () => {
			for (const cmd of GLOBAL_COMMANDS) {
				expect(cmd.name).toBeTruthy()
				expect(typeof cmd.name).toBe("string")
				expect(cmd.description).toBeTruthy()
				expect(typeof cmd.description).toBe("string")
				expect(cmd.action).toBeTruthy()
				expect(typeof cmd.action).toBe("string")
			}
		})
	})

	describe("getGlobalCommand", () => {
		it("should return the command when found", () => {
			const cmd = getGlobalCommand("new")
			expect(cmd).toBeDefined()
			expect(cmd?.name).toBe("new")
			expect(cmd?.action).toBe("clearTask")
		})

		it("should return undefined for unknown commands", () => {
			const cmd = getGlobalCommand("unknown-command")
			expect(cmd).toBeUndefined()
		})

		it("should be case-sensitive", () => {
			const cmd = getGlobalCommand("NEW")
			expect(cmd).toBeUndefined()
		})
	})

	describe("getGlobalCommandsForAutocomplete", () => {
		it("should return commands in autocomplete format", () => {
			const commands = getGlobalCommandsForAutocomplete()
			expect(commands.length).toBe(GLOBAL_COMMANDS.length)

			for (const cmd of commands) {
				expect(cmd.name).toBeTruthy()
				expect(cmd.source).toBe("global")
				expect(cmd.action).toBeTruthy()
			}
		})

		it("should include the /new command with correct format", () => {
			const commands = getGlobalCommandsForAutocomplete()
			const newCommand = commands.find((cmd) => cmd.name === "new")

			expect(newCommand).toBeDefined()
			expect(newCommand?.description).toBe("Start a new task")
			expect(newCommand?.source).toBe("global")
			expect(newCommand?.action).toBe("clearTask")
		})

		it("should not include argumentHint for action commands", () => {
			const commands = getGlobalCommandsForAutocomplete()
			// Action commands don't have argument hints
			for (const cmd of commands) {
				expect(cmd).not.toHaveProperty("argumentHint")
			}
		})
	})

	describe("type safety", () => {
		it("should have valid GlobalCommandAction types", () => {
			// This test ensures the type is properly constrained
			const validActions: GlobalCommandAction[] = ["clearTask"]

			for (const cmd of GLOBAL_COMMANDS) {
				expect(validActions).toContain(cmd.action)
			}
		})

		it("should match GlobalCommand interface", () => {
			const testCommand: GlobalCommand = {
				name: "test",
				description: "Test command",
				action: "clearTask",
			}

			expect(testCommand.name).toBe("test")
			expect(testCommand.description).toBe("Test command")
			expect(testCommand.action).toBe("clearTask")
		})
	})
})
