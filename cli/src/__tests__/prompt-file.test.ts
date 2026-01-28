import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { existsSync, readFileSync } from "fs"
import { resolve } from "path"
import type { CLIOptions } from "../types/cli.js"
import { validatePromptFileConflicts, validatePromptFileRequiresNonInteractive } from "../validation/prompt.js"

vi.mock("fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}))

describe("CLI --prompt-file option", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should accept promptFile in CLIOptions", () => {
		const options: CLIOptions = {
			mode: "code",
			workspace: "/test/workspace",
			promptFile: "./prompt.md",
		}

		expect(options.promptFile).toBe("./prompt.md")
	})

	describe("validatePromptFileRequiresNonInteractive", () => {
		it("should reject promptFile without --auto or --json-io", () => {
			const result = validatePromptFileRequiresNonInteractive({ promptFile: "./prompt.md" })
			expect(result.valid).toBe(false)
			expect(result.error).toBe("Error: --prompt-file option requires --auto or --json-io flag")
		})

		it("should accept promptFile with --auto", () => {
			const result = validatePromptFileRequiresNonInteractive({ promptFile: "./prompt.md", auto: true })
			expect(result.valid).toBe(true)
		})

		it("should accept promptFile with --json-io", () => {
			const result = validatePromptFileRequiresNonInteractive({ promptFile: "./prompt.md", jsonIo: true })
			expect(result.valid).toBe(true)
		})

		it("should allow when promptFile is not provided", () => {
			const result = validatePromptFileRequiresNonInteractive({})
			expect(result.valid).toBe(true)
		})
	})

	describe("validatePromptFileConflicts", () => {
		it("should reject promptFile with prompt argument", () => {
			const result = validatePromptFileConflicts({ promptFile: "./prompt.md", prompt: "Fix bug" })
			expect(result.valid).toBe(false)
			expect(result.error).toBe("Error: --prompt-file cannot be used with a prompt argument")
		})

		it("should reject promptFile with --continue", () => {
			const result = validatePromptFileConflicts({ promptFile: "./prompt.md", continue: true })
			expect(result.valid).toBe(false)
			expect(result.error).toBe("Error: --prompt-file option cannot be used with --continue flag")
		})

		it("should allow promptFile with no conflicts", () => {
			const result = validatePromptFileConflicts({ promptFile: "./prompt.md" })
			expect(result.valid).toBe(true)
		})
	})

	describe("file reading behavior", () => {
		it("should read and trim prompt file content", () => {
			const fileContent = "Fix the failing tests\n"
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(fileContent)

			const filePath = resolve("./prompt.md")
			expect(existsSync(filePath)).toBe(true)
			const content = readFileSync(filePath, "utf-8")
			expect(content.trim()).toBe("Fix the failing tests")
		})

		it("should detect missing prompt file", () => {
			vi.mocked(existsSync).mockReturnValue(false)
			const filePath = resolve("./missing.md")
			expect(existsSync(filePath)).toBe(false)
			const expectedError = `Error: Prompt file not found: ${filePath}`
			expect(expectedError).toContain("Prompt file not found")
		})

		it("should surface read errors", () => {
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockImplementation(() => {
				throw new Error("EACCES: permission denied")
			})

			const filePath = resolve("./protected.md")
			expect(existsSync(filePath)).toBe(true)
			expect(() => readFileSync(filePath, "utf-8")).toThrow("EACCES: permission denied")
		})
	})
})
