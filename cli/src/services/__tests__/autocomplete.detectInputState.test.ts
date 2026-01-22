/**
 * Tests for detectInputState function in autocomplete
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { detectInputState } from "../autocomplete.js"
import { commandRegistry } from "../../commands/core/registry.js"
import type { Command } from "../../commands/core/types.js"

describe("detectInputState", () => {
	// Store original commands to restore after tests
	let originalCommands: Command[]

	beforeEach(() => {
		// Save original commands
		originalCommands = [...commandRegistry.getAll()]

		// Clear registry
		for (const cmd of originalCommands) {
			// @ts-expect-error - accessing private method for testing
			commandRegistry.commands?.delete(cmd.name)
		}

		// Register test commands
		const testCommand: Command = {
			name: "test",
			aliases: [],
			description: "Test command",
			usage: "/test",
			examples: [],
			category: "test",
			priority: 1,
			arguments: [
				{
					name: "arg1",
					description: "First argument",
					required: false,
					values: [{ value: "value1" }, { value: "value2" }],
				},
			],
			handler: async () => {},
		}

		const teamsCommand: Command = {
			name: "teams",
			aliases: ["team"],
			description: "Manage teams",
			usage: "/teams [subcommand] [args]",
			examples: [],
			category: "settings",
			priority: 10,
			arguments: [
				{
					name: "subcommand",
					description: "Subcommand: list, select",
					required: false,
					values: [
						{ value: "list", description: "List all teams" },
						{ value: "select", description: "Select a team" },
					],
				},
				{
					name: "team-name",
					description: "Team name",
					required: false,
					conditionalProviders: [
						{
							condition: (context) => context.getArgument("subcommand") === "select",
							provider: async () => [
								{ value: "personal", description: "Personal account", matchScore: 1, highlightedValue: "personal" },
								{ value: "kilo-code", description: "Kilo Code team", matchScore: 1, highlightedValue: "kilo-code" },
							],
						},
					],
				},
			],
			handler: async () => {},
		}

		const modelCommand: Command = {
			name: "model",
			aliases: ["mdl"],
			description: "Manage models",
			usage: "/model [subcommand] [args]",
			examples: [],
			category: "settings",
			priority: 8,
			arguments: [
				{
					name: "subcommand",
					description: "Subcommand: info, select, list",
					required: false,
					values: [
						{ value: "info", description: "Show model info" },
						{ value: "select", description: "Select a model" },
						{ value: "list", description: "List models" },
					],
				},
				{
					name: "model-name",
					description: "Model name",
					required: false,
					conditionalProviders: [
						{
							condition: (context) => {
								const sub = context.getArgument("subcommand")
								return sub === "info" || sub === "select"
							},
							provider: async () => [
								{ value: "gpt-4", description: "GPT-4", matchScore: 1, highlightedValue: "gpt-4" },
								{ value: "claude-sonnet", description: "Claude Sonnet", matchScore: 1, highlightedValue: "claude-sonnet" },
							],
						},
					],
				},
			],
			handler: async () => {},
		}

		const modeCommand: Command = {
			name: "mode",
			aliases: ["m"],
			description: "Switch mode",
			usage: "/mode <mode-name>",
			examples: [],
			category: "settings",
			priority: 9,
			arguments: [
				{
					name: "mode-name",
					description: "Mode to switch to",
					required: true,
					provider: async () => [
						{ value: "code", description: "Code mode", matchScore: 1, highlightedValue: "code" },
						{ value: "architect", description: "Architect mode", matchScore: 1, highlightedValue: "architect" },
					],
				},
			],
			handler: async () => {},
		}

		commandRegistry.register(testCommand)
		commandRegistry.register(teamsCommand)
		commandRegistry.register(modelCommand)
		commandRegistry.register(modeCommand)
	})

	afterEach(() => {
		// Clear test commands
		for (const cmd of commandRegistry.getAll()) {
			// @ts-expect-error - accessing private method for testing
			commandRegistry.commands?.delete(cmd.name)
		}

		// Restore original commands
		for (const cmd of originalCommands) {
			commandRegistry.register(cmd)
		}
	})

	describe("command detection", () => {
		it("should return 'none' for empty input", () => {
			const state = detectInputState("")
			expect(state.type).toBe("none")
		})

		it("should return 'command' for just '/'", () => {
			const state = detectInputState("/")
			expect(state.type).toBe("command")
			expect(state.commandName).toBe("")
		})

		it("should return 'command' for partial command name", () => {
			const state = detectInputState("/tea")
			expect(state.type).toBe("command")
			expect(state.commandName).toBe("tea")
		})

		it("should return 'command' for unknown command", () => {
			const state = detectInputState("/unknown")
			expect(state.type).toBe("command")
			expect(state.commandName).toBe("unknown")
		})
	})

	describe("single-argument commands", () => {
		it("should detect argument state for '/mode ' (space after command)", () => {
			const state = detectInputState("/mode ")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("mode")
			expect(state.currentArgument?.index).toBe(0)
			expect(state.currentArgument?.definition.name).toBe("mode-name")
			expect(state.currentArgument?.partialValue).toBe("")
		})

		it("should detect argument state for '/mode cod' (partial argument)", () => {
			const state = detectInputState("/mode cod")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("mode")
			expect(state.currentArgument?.index).toBe(0)
			expect(state.currentArgument?.definition.name).toBe("mode-name")
			expect(state.currentArgument?.partialValue).toBe("cod")
		})

		it("should detect argument state for '/test ' (space after command)", () => {
			const state = detectInputState("/test ")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("test")
			expect(state.currentArgument?.index).toBe(0)
			expect(state.currentArgument?.definition.name).toBe("arg1")
		})
	})

	describe("multi-argument commands (teams)", () => {
		it("should detect first argument for '/teams ' (space after command)", () => {
			const state = detectInputState("/teams ")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("teams")
			expect(state.currentArgument?.index).toBe(0)
			expect(state.currentArgument?.definition.name).toBe("subcommand")
			expect(state.currentArgument?.partialValue).toBe("")
		})

		it("should detect first argument for '/teams sel' (partial first arg)", () => {
			const state = detectInputState("/teams sel")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("teams")
			expect(state.currentArgument?.index).toBe(0)
			expect(state.currentArgument?.definition.name).toBe("subcommand")
			expect(state.currentArgument?.partialValue).toBe("sel")
		})

		it("should detect second argument for '/teams select ' (space after first arg)", () => {
			const state = detectInputState("/teams select ")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("teams")
			expect(state.currentArgument?.index).toBe(1)
			expect(state.currentArgument?.definition.name).toBe("team-name")
			expect(state.currentArgument?.partialValue).toBe("")
		})

		it("should detect second argument for '/teams select kilo' (partial second arg)", () => {
			const state = detectInputState("/teams select kilo")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("teams")
			expect(state.currentArgument?.index).toBe(1)
			expect(state.currentArgument?.definition.name).toBe("team-name")
			expect(state.currentArgument?.partialValue).toBe("kilo")
		})

		it("should detect first argument for '/teams list' (complete first arg, no space)", () => {
			const state = detectInputState("/teams list")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("teams")
			expect(state.currentArgument?.index).toBe(0)
			expect(state.currentArgument?.definition.name).toBe("subcommand")
			expect(state.currentArgument?.partialValue).toBe("list")
		})
	})

	describe("multi-argument commands (model)", () => {
		it("should detect first argument for '/model ' (space after command)", () => {
			const state = detectInputState("/model ")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("model")
			expect(state.currentArgument?.index).toBe(0)
			expect(state.currentArgument?.definition.name).toBe("subcommand")
		})

		it("should detect second argument for '/model select ' (space after first arg)", () => {
			const state = detectInputState("/model select ")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("model")
			expect(state.currentArgument?.index).toBe(1)
			expect(state.currentArgument?.definition.name).toBe("model-name")
			expect(state.currentArgument?.partialValue).toBe("")
		})

		it("should detect second argument for '/model select gpt' (partial second arg)", () => {
			const state = detectInputState("/model select gpt")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("model")
			expect(state.currentArgument?.index).toBe(1)
			expect(state.currentArgument?.definition.name).toBe("model-name")
			expect(state.currentArgument?.partialValue).toBe("gpt")
		})

		it("should detect second argument for '/model info ' (space after first arg)", () => {
			const state = detectInputState("/model info ")
			expect(state.type).toBe("argument")
			expect(state.commandName).toBe("model")
			expect(state.currentArgument?.index).toBe(1)
			expect(state.currentArgument?.definition.name).toBe("model-name")
		})
	})

	describe("edge cases", () => {
		it("should handle command with no arguments defined", () => {
			// Register a command with no arguments
			const noArgsCommand: Command = {
				name: "noargs",
				aliases: [],
				description: "No args command",
				usage: "/noargs",
				examples: [],
				category: "test",
				priority: 1,
				handler: async () => {},
			}
			commandRegistry.register(noArgsCommand)

			const state = detectInputState("/noargs ")
			expect(state.type).toBe("command")
			expect(state.commandName).toBe("noargs")
		})

		it("should return command type when argument index exceeds defined arguments", () => {
			// /teams select personal extra - 'extra' would be index 2, but only 2 args defined (0, 1)
			const state = detectInputState("/teams select personal extra")
			// With 3 args parsed and not ending with space, index = 3 - 1 = 2
			// But only 2 arguments defined (index 0 and 1), so should return command type
			expect(state.type).toBe("command")
		})

		it("should handle multiple spaces correctly", () => {
			// Multiple spaces should still work - parser handles this
			const state = detectInputState("/teams  select ")
			// Parser normalizes spaces, so this should work
			expect(state.type).toBe("argument")
		})
	})
})
