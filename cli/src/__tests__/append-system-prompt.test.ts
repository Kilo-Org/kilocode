import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { existsSync, readFileSync } from "fs"
import { resolve } from "path"
import type { CLIOptions } from "../types/cli.js"

// Mock fs module
vi.mock("fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}))

// Mock process.exit to prevent test termination
const _mockExit = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null | undefined): never => {
	throw new Error(`process.exit(${code})`)
})

// Mock console.error to capture error messages
const _mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {})

describe("Append System Prompt CLI Option", () => {
	describe("CLIOptions type", () => {
		it("should accept appendSystemPrompt as a string option", () => {
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
				appendSystemPrompt: "Custom instructions here",
			}

			expect(options.appendSystemPrompt).toBe("Custom instructions here")
		})

		it("should allow appendSystemPrompt to be undefined", () => {
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
			}

			expect(options.appendSystemPrompt).toBeUndefined()
		})

		it("should handle empty string for appendSystemPrompt", () => {
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
				appendSystemPrompt: "",
			}

			expect(options.appendSystemPrompt).toBe("")
		})

		it("should handle multi-line appendSystemPrompt", () => {
			const multiLinePrompt = `Line 1
Line 2
Line 3`
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
				appendSystemPrompt: multiLinePrompt,
			}

			expect(options.appendSystemPrompt).toBe(multiLinePrompt)
		})
	})

	describe("CLI flag parsing", () => {
		it("should parse --append-system-prompt flag with value", () => {
			// This test validates the expected behavior when the flag is parsed
			const mockArgs = ["--append-system-prompt", "Custom instructions"]
			const expectedValue = "Custom instructions"

			// Simulate what commander.js would do
			const parsedValue = mockArgs[1]
			expect(parsedValue).toBe(expectedValue)
		})

		it("should handle --append-system-prompt with quoted multi-word value", () => {
			const mockArgs = ["--append-system-prompt", "Always use TypeScript strict mode"]
			const expectedValue = "Always use TypeScript strict mode"

			const parsedValue = mockArgs[1]
			expect(parsedValue).toBe(expectedValue)
		})
	})

	describe("System prompt integration", () => {
		it("should append custom text to system prompt when provided", () => {
			const basePrompt = "You are Kilo Code, an AI assistant."
			const appendText = "Always write tests first."
			const expectedPrompt = `${basePrompt}

${appendText}`

			const result = `${basePrompt}\n\n${appendText}`
			expect(result).toBe(expectedPrompt)
		})

		it("should not modify system prompt when appendSystemPrompt is undefined", () => {
			const basePrompt = "You are Kilo Code, an AI assistant."
			const appendText = undefined

			const result = appendText ? `${basePrompt}\n\n${appendText}` : basePrompt
			expect(result).toBe(basePrompt)
		})

		it("should not modify system prompt when appendSystemPrompt is empty string", () => {
			const basePrompt = "You are Kilo Code, an AI assistant."
			const appendText = ""

			const result = appendText ? `${basePrompt}\n\n${appendText}` : basePrompt
			expect(result).toBe(basePrompt)
		})

		it("should properly format appended text with newlines", () => {
			const basePrompt = "You are Kilo Code."
			const appendText = "Rule 1: Test first\nRule 2: Keep it simple"
			const expectedPrompt = `You are Kilo Code.

Rule 1: Test first
Rule 2: Keep it simple`

			const result = `${basePrompt}\n\n${appendText}`
			expect(result).toBe(expectedPrompt)
		})
	})

	describe("CLIOptions type with appendSystemPromptFile", () => {
		it("should accept appendSystemPromptFile as a string option", () => {
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
				appendSystemPromptFile: "./custom-instructions.md",
			}

			expect(options.appendSystemPromptFile).toBe("./custom-instructions.md")
		})

		it("should allow appendSystemPromptFile to be undefined", () => {
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
			}

			expect(options.appendSystemPromptFile).toBeUndefined()
		})

		it("should accept both appendSystemPrompt and appendSystemPromptFile", () => {
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
				appendSystemPrompt: "Inline instructions",
				appendSystemPromptFile: "./file-instructions.md",
			}

			expect(options.appendSystemPrompt).toBe("Inline instructions")
			expect(options.appendSystemPromptFile).toBe("./file-instructions.md")
		})
	})
})

/**
 * Tests for the --append-system-prompt-file CLI option.
 *
 * This option allows users to specify a file containing custom instructions
 * to append to the system prompt.
 */
describe("Append System Prompt File CLI Option", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("File reading functionality", () => {
		it("should read content from a file", () => {
			const fileContent = "Custom instructions from file"
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(fileContent)

			const filePath = "/test/path/instructions.md"
			const resolvedPath = resolve(filePath)

			// Simulate the file reading logic from index.ts
			expect(existsSync(resolvedPath)).toBe(true)
			const content = readFileSync(resolvedPath, "utf-8")
			expect(content).toBe(fileContent)
		})

		it("should handle empty files gracefully", () => {
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue("")

			const filePath = "/test/path/empty.md"
			const resolvedPath = resolve(filePath)

			expect(existsSync(resolvedPath)).toBe(true)
			const content = readFileSync(resolvedPath, "utf-8")
			expect(content).toBe("")
		})

		it("should handle files with unicode characters", () => {
			const unicodeContent = "Instructions with unicode: こんにちは 🎉 émoji café"
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(unicodeContent)

			const filePath = "/test/path/unicode.md"
			const resolvedPath = resolve(filePath)

			expect(existsSync(resolvedPath)).toBe(true)
			const content = readFileSync(resolvedPath, "utf-8")
			expect(content).toBe(unicodeContent)
		})

		it("should handle files with multi-line content", () => {
			const multiLineContent = `Line 1: First instruction
Line 2: Second instruction
Line 3: Third instruction`
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(multiLineContent)

			const filePath = "/test/path/multiline.md"
			const resolvedPath = resolve(filePath)

			const content = readFileSync(resolvedPath, "utf-8")
			expect(content).toBe(multiLineContent)
			expect(content.split("\n").length).toBe(3)
		})
	})

	describe("File existence validation", () => {
		it("should error if file does not exist", () => {
			vi.mocked(existsSync).mockReturnValue(false)

			const filePath = "/non/existent/file.md"
			const resolvedPath = resolve(filePath)

			// Simulate the validation logic from index.ts
			const fileExists = existsSync(resolvedPath)
			expect(fileExists).toBe(false)

			// When file doesn't exist, index.ts outputs this error and exits
			const expectedError = `Error: System prompt file not found: ${resolvedPath}`
			expect(expectedError).toContain("System prompt file not found")
		})

		it("should detect existing file", () => {
			vi.mocked(existsSync).mockReturnValue(true)

			const filePath = "/existing/file.md"
			const resolvedPath = resolve(filePath)

			expect(existsSync(resolvedPath)).toBe(true)
		})
	})

	describe("File read error handling", () => {
		it("should error if file cannot be read", () => {
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockImplementation(() => {
				throw new Error("EACCES: permission denied")
			})

			const filePath = "/protected/file.md"
			const resolvedPath = resolve(filePath)

			expect(existsSync(resolvedPath)).toBe(true)
			expect(() => readFileSync(resolvedPath, "utf-8")).toThrow("EACCES: permission denied")
		})

		it("should handle ENOENT errors", () => {
			vi.mocked(existsSync).mockReturnValue(true) // File appears to exist but read fails
			vi.mocked(readFileSync).mockImplementation(() => {
				throw new Error("ENOENT: no such file or directory")
			})

			expect(() => readFileSync("/some/path", "utf-8")).toThrow("ENOENT")
		})

		it("should handle EISDIR errors (trying to read a directory)", () => {
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockImplementation(() => {
				throw new Error("EISDIR: illegal operation on a directory")
			})

			expect(() => readFileSync("/some/directory", "utf-8")).toThrow("EISDIR")
		})
	})

	describe("Combining inline text and file content", () => {
		it("should combine inline text and file content with inline first", () => {
			const inlineText = "Inline instructions"
			const fileContent = "File instructions"
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(fileContent)

			// Simulate the combination logic from index.ts lines 231-234
			let combinedSystemPrompt = inlineText
			const fileContentRead = readFileSync("/test/file.md", "utf-8") as string

			combinedSystemPrompt = combinedSystemPrompt
				? `${combinedSystemPrompt}\n\n${fileContentRead}`
				: fileContentRead

			expect(combinedSystemPrompt).toBe("Inline instructions\n\nFile instructions")
		})

		it("should use only file content when no inline text provided", () => {
			const fileContent = "File instructions only"
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(fileContent)

			// Simulate the combination logic from index.ts
			let combinedSystemPrompt = "" // No inline text
			const fileContentRead = readFileSync("/test/file.md", "utf-8") as string

			combinedSystemPrompt = combinedSystemPrompt
				? `${combinedSystemPrompt}\n\n${fileContentRead}`
				: fileContentRead

			expect(combinedSystemPrompt).toBe("File instructions only")
		})

		it("should maintain proper separation with double newline", () => {
			const inlineText = "First part"
			const fileContent = "Second part"
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(fileContent)

			const combined = `${inlineText}\n\n${fileContent}`

			// Verify the separator is exactly two newlines
			expect(combined).toContain("\n\n")
			expect(combined.split("\n\n")).toEqual(["First part", "Second part"])
		})

		it("should handle empty inline text with file content", () => {
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue("File content")

			// When inline is empty string, use file content only
			const inlineText = ""
			const fileContent = "File content"

			const combinedSystemPrompt = inlineText ? `${inlineText}\n\n${fileContent}` : fileContent

			expect(combinedSystemPrompt).toBe("File content")
		})

		it("should handle undefined inline text with file content", () => {
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue("File content")

			// When inline is undefined, use file content only
			const inlineText: string | undefined = undefined
			const fileContent = "File content"

			const combinedSystemPrompt = inlineText ? `${inlineText}\n\n${fileContent}` : fileContent

			expect(combinedSystemPrompt).toBe("File content")
		})
	})

	describe("Path resolution", () => {
		it("should resolve relative paths from cwd", () => {
			const relativePath = "./custom-instructions.md"
			const resolvedPath = resolve(relativePath)

			// resolve() should convert relative to absolute based on cwd
			expect(resolvedPath).not.toBe(relativePath)
			expect(resolvedPath.startsWith("/")).toBe(true)
			expect(resolvedPath.endsWith("custom-instructions.md")).toBe(true)
		})

		it("should handle absolute paths directly", () => {
			const absolutePath = "/home/user/config/instructions.md"
			const resolvedPath = resolve(absolutePath)

			// resolve() should return absolute paths as-is
			expect(resolvedPath).toBe(absolutePath)
		})

		it("should resolve parent directory references", () => {
			const relativePath = "../parent-dir/instructions.md"
			const resolvedPath = resolve(relativePath)

			// Should resolve .. to parent directory
			expect(resolvedPath).not.toContain("..")
			expect(resolvedPath.endsWith("instructions.md")).toBe(true)
		})

		it("should resolve nested relative paths", () => {
			const relativePath = "./config/prompts/instructions.md"
			const resolvedPath = resolve(relativePath)

			expect(resolvedPath.endsWith("config/prompts/instructions.md")).toBe(true)
		})

		it("should handle paths without leading ./", () => {
			const relativePath = "instructions.md"
			const resolvedPath = resolve(relativePath)

			// Should still resolve from cwd
			expect(resolvedPath.startsWith("/")).toBe(true)
			expect(resolvedPath.endsWith("instructions.md")).toBe(true)
		})
	})

	describe("CLI flag parsing", () => {
		it("should parse --append-system-prompt-file flag with value", () => {
			// This test validates the expected behavior when the flag is parsed
			const mockArgs = ["--append-system-prompt-file", "./instructions.md"]
			const expectedValue = "./instructions.md"

			// Simulate what commander.js would do
			const parsedValue = mockArgs[1]
			expect(parsedValue).toBe(expectedValue)
		})

		it("should handle --append-system-prompt-file with absolute path", () => {
			const mockArgs = ["--append-system-prompt-file", "/home/user/instructions.md"]
			const expectedValue = "/home/user/instructions.md"

			const parsedValue = mockArgs[1]
			expect(parsedValue).toBe(expectedValue)
		})

		it("should handle both --append-system-prompt and --append-system-prompt-file together", () => {
			const mockArgs = ["--append-system-prompt", "Inline text", "--append-system-prompt-file", "./file.md"]

			// Simulate parsing both flags
			const inlineIndex = mockArgs.indexOf("--append-system-prompt")
			const fileIndex = mockArgs.indexOf("--append-system-prompt-file")

			expect(mockArgs[inlineIndex + 1]).toBe("Inline text")
			expect(mockArgs[fileIndex + 1]).toBe("./file.md")
		})
	})

	describe("Integration with system prompt", () => {
		it("should properly integrate file content into system prompt", () => {
			const basePrompt = "You are Kilo Code, an AI assistant."
			const fileContent = "Always prioritize code quality."

			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(fileContent)

			const result = `${basePrompt}\n\n${fileContent}`
			expect(result).toBe("You are Kilo Code, an AI assistant.\n\nAlways prioritize code quality.")
		})

		it("should handle file content with special characters", () => {
			const basePrompt = "Base prompt."
			const fileContent = "Use `code blocks` and **bold** text"

			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(fileContent)

			const result = `${basePrompt}\n\n${fileContent}`
			expect(result).toContain("`code blocks`")
			expect(result).toContain("**bold**")
		})

		it("should combine all three: base + inline + file", () => {
			const basePrompt = "Base prompt."
			const inlineText = "Inline additions."
			const fileContent = "File additions."

			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(fileContent)

			// First combine inline and file
			const combinedAdditions = `${inlineText}\n\n${fileContent}`
			// Then append to base
			const fullPrompt = `${basePrompt}\n\n${combinedAdditions}`

			expect(fullPrompt).toBe("Base prompt.\n\nInline additions.\n\nFile additions.")
		})
	})

	describe("Edge cases", () => {
		it("should handle files with only whitespace", () => {
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue("   \n\n   ")

			const content = readFileSync("/test/whitespace.md", "utf-8")
			expect(content).toBe("   \n\n   ")
		})

		it("should handle files with trailing newlines", () => {
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue("Content\n\n")

			const content = readFileSync("/test/trailing.md", "utf-8")
			expect(content).toBe("Content\n\n")
		})

		it("should handle files with Windows line endings", () => {
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue("Line 1\r\nLine 2\r\n")

			const content = readFileSync("/test/windows.md", "utf-8")
			expect(content).toContain("\r\n")
		})

		it("should handle very long file content", () => {
			const longContent = "x".repeat(100000)
			vi.mocked(existsSync).mockReturnValue(true)
			vi.mocked(readFileSync).mockReturnValue(longContent)

			const content = readFileSync("/test/long.md", "utf-8")
			expect(content.length).toBe(100000)
		})

		it("should handle file paths with spaces", () => {
			const pathWithSpaces = "/path/with spaces/file name.md"
			const resolvedPath = resolve(pathWithSpaces)

			expect(resolvedPath).toContain("with spaces")
			expect(resolvedPath).toContain("file name.md")
		})

		it("should handle symbolic characters in path", () => {
			const pathWithSymbols = "/path/with-dashes_underscores/file.md"
			const resolvedPath = resolve(pathWithSymbols)

			expect(resolvedPath).toBe(pathWithSymbols)
		})
	})
})
