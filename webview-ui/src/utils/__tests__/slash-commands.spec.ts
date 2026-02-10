// kilocode-change - new file
import { describe, it, expect } from "vitest"
import {
	getMatchingSlashCommands,
	validateSlashCommand,
	shouldShowSlashCommandsMenu,
	insertSlashCommand,
} from "../slash-commands"

describe("Slash Command Matching", () => {
	describe("getMatchingSlashCommands - case insensitivity", () => {
		it("should match commands regardless of case", () => {
			const results = getMatchingSlashCommands("newtask")
			expect(results.some((r) => r.name === "newtask")).toBe(true)

			const resultsUpper = getMatchingSlashCommands("NEWTASK")
			expect(resultsUpper.some((r) => r.name === "newtask")).toBe(true)

			const resultsMixed = getMatchingSlashCommands("NewTask")
			expect(resultsMixed.some((r) => r.name === "newtask")).toBe(true)
		})

		it("should match commands with partial queries", () => {
			const results = getMatchingSlashCommands("new")
			expect(results.some((r) => r.name === "newtask")).toBe(true)
			expect(results.some((r) => r.name === "newrule")).toBe(true)
		})

		it("should return all commands for empty query", () => {
			const results = getMatchingSlashCommands("")
			expect(results.length).toBeGreaterThan(0)
		})

		it("should include condense aliases in results", () => {
			const results = getMatchingSlashCommands("cond")
			expect(results.some((r) => r.name === "condense")).toBe(true)
		})

		it("should include init in results", () => {
			const results = getMatchingSlashCommands("init")
			expect(results.some((r) => r.name === "init")).toBe(true)
		})
	})

	describe("validateSlashCommand - case insensitivity", () => {
		it("should validate exact matches regardless of case", () => {
			expect(validateSlashCommand("newtask")).toBe("full")
			expect(validateSlashCommand("NEWTASK")).toBe("full")
			expect(validateSlashCommand("NewTask")).toBe("full")
		})

		it("should validate condense aliases", () => {
			expect(validateSlashCommand("smol")).toBe("full")
			expect(validateSlashCommand("condense")).toBe("full")
			expect(validateSlashCommand("compact")).toBe("full")
		})

		it("should validate init", () => {
			expect(validateSlashCommand("init")).toBe("full")
			expect(validateSlashCommand("INIT")).toBe("full")
		})

		it("should validate partial matches regardless of case", () => {
			expect(validateSlashCommand("new")).toBe("partial")
			expect(validateSlashCommand("NEW")).toBe("partial")
		})

		it("should return null for non-matching commands", () => {
			expect(validateSlashCommand("nonexistent")).toBe(null)
		})
	})

	describe("shouldShowSlashCommandsMenu", () => {
		it("should show menu when typing after slash", () => {
			expect(shouldShowSlashCommandsMenu("/new", 4)).toBe(true)
		})

		it("should hide menu when there are no matching commands", () => {
			expect(shouldShowSlashCommandsMenu("/doesnotexist", "/doesnotexist".length)).toBe(false)
		})

		it("should show menu when query matches a known command", () => {
			expect(shouldShowSlashCommandsMenu("/newt", "/newt".length)).toBe(true)
		})

		it("should show menu for /init", () => {
			expect(shouldShowSlashCommandsMenu("/init", "/init".length)).toBe(true)
		})

		it("should hide menu when there's whitespace after slash", () => {
			expect(shouldShowSlashCommandsMenu("/ new", 5)).toBe(false)
		})

		it("should hide menu when no slash present", () => {
			expect(shouldShowSlashCommandsMenu("newtask", 8)).toBe(false)
		})
	})

	describe("insertSlashCommand", () => {
		it("should insert command and add trailing space", () => {
			const result = insertSlashCommand("/new", "newtask")
			expect(result.newValue).toBe("/newtask ")
			expect(result.commandIndex).toBe(0)
		})
	})

	describe("getMatchingSlashCommands - underscore and camelCase", () => {
		it("should match underscore delimited commands with acronym query", () => {
			const results = getMatchingSlashCommands("nf", [], { new_file_creation: true }, {})
			expect(results.some((r) => r.name === "new_file_creation")).toBe(true)
		})

		it("should match camelCase commands with acronym query", () => {
			const results = getMatchingSlashCommands("gr", [], { gitRebase: true }, {})
			expect(results.some((r) => r.name === "gitRebase")).toBe(true)
		})

		it("should match camelCase commands with mixed case query", () => {
			const results = getMatchingSlashCommands("GitR", [], { gitRebase: true }, {})
			expect(results.some((r) => r.name === "gitRebase")).toBe(true)
		})

		it("should match PascalCase commands with acronym query", () => {
			const results = getMatchingSlashCommands("NFC", [], { NewFileCreation: true }, {})
			expect(results.some((r) => r.name === "NewFileCreation")).toBe(true)
		})
	})
})
