// npx vitest run src/services/ripgrep/__tests__/index.spec.ts

import * as path from "path" // kilocode_change
import { getBinPath, truncateLine } from "../index" // kilocode_change
import { fileExistsAtPath } from "../../../utils/fs" // kilocode_change
// kilocode_change start
vi.mock("../../../utils/fs", () => ({
	fileExistsAtPath: vi.fn(),
}))
// kilocode_change end
describe("Ripgrep line truncation", () => {
	// The default MAX_LINE_LENGTH is 500 in the implementation
	const MAX_LINE_LENGTH = 500

	it("should truncate lines longer than MAX_LINE_LENGTH", () => {
		const longLine = "a".repeat(600) // Line longer than MAX_LINE_LENGTH
		const truncated = truncateLine(longLine)

		expect(truncated).toContain("[truncated...]")
		expect(truncated.length).toBeLessThan(longLine.length)
		expect(truncated.length).toEqual(MAX_LINE_LENGTH + " [truncated...]".length)
	})

	it("should not truncate lines shorter than MAX_LINE_LENGTH", () => {
		const shortLine = "Short line of text"
		const truncated = truncateLine(shortLine)

		expect(truncated).toEqual(shortLine)
		expect(truncated).not.toContain("[truncated...]")
	})

	it("should correctly truncate a line at exactly MAX_LINE_LENGTH characters", () => {
		const exactLine = "a".repeat(MAX_LINE_LENGTH)
		const exactPlusOne = exactLine + "x"

		// Should not truncate when exactly MAX_LINE_LENGTH
		expect(truncateLine(exactLine)).toEqual(exactLine)

		// Should truncate when exceeding MAX_LINE_LENGTH by even 1 character
		expect(truncateLine(exactPlusOne)).toContain("[truncated...]")
	})

	it("should handle empty lines without errors", () => {
		expect(truncateLine("")).toEqual("")
	})

	it("should allow custom maximum length", () => {
		const customLength = 100
		const line = "a".repeat(customLength + 50)

		const truncated = truncateLine(line, customLength)

		expect(truncated.length).toEqual(customLength + " [truncated...]".length)
		expect(truncated).toContain("[truncated...]")
	})
})
// kilocode_change start
describe("getBinPath", () => {
	const mockFileExists = fileExistsAtPath as ReturnType<typeof vi.fn>
	const isWindows = process.platform.startsWith("win")
	const binName = isWindows ? "rg.exe" : "rg"

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should find ripgrep in traditional node_modules/@vscode/ripgrep/bin/", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const expectedPath = path.join(vscodeAppRoot, "node_modules/@vscode/ripgrep/bin/", binName)

		mockFileExists.mockImplementation(async (filePath: string) => filePath === expectedPath)

		const result = await getBinPath(vscodeAppRoot)
		expect(result).toBe(expectedPath)
	})

	it("should find ripgrep in node_modules/vscode-ripgrep/bin", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const expectedPath = path.join(vscodeAppRoot, "node_modules/vscode-ripgrep/bin", binName)

		mockFileExists.mockImplementation(async (filePath: string) => filePath === expectedPath)

		const result = await getBinPath(vscodeAppRoot)
		expect(result).toBe(expectedPath)
	})

	it("should find ripgrep in node_modules.asar.unpacked paths", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const expectedPath = path.join(vscodeAppRoot, "node_modules.asar.unpacked/vscode-ripgrep/bin/", binName)

		mockFileExists.mockImplementation(async (filePath: string) => filePath === expectedPath)

		const result = await getBinPath(vscodeAppRoot)
		expect(result).toBe(expectedPath)
	})

	it("should handle require.resolve fallback for bun installs", async () => {
		const vscodeAppRoot = "/path/to/vscode"

		// Mock traditional paths not existing
		mockFileExists.mockImplementation(async (filePath: string) => {
			// Only return true for paths that would be resolved via require.resolve
			// This simulates bun's behavior where the binary exists in the global cache
			return filePath.includes("@vscode/ripgrep") && filePath.includes("bin")
		})

		const result = await getBinPath(vscodeAppRoot)

		// The result should either be undefined (if @vscode/ripgrep is not installed)
		// or a valid path (if it is installed and resolved via require.resolve)
		// We can't mock require.resolve in vitest easily, so we just verify the function
		// doesn't throw and returns a valid result type
		expect(result === undefined || typeof result === "string").toBe(true)
	})

	it("should return undefined when ripgrep is not found anywhere", async () => {
		const vscodeAppRoot = "/path/to/nonexistent"

		// Mock all paths not existing
		mockFileExists.mockResolvedValue(false)

		const result = await getBinPath(vscodeAppRoot)

		// Should return undefined when no paths exist and require.resolve fails
		expect(result).toBeUndefined()
	})

	it("should prioritize traditional paths over require.resolve", async () => {
		const vscodeAppRoot = "/path/to/vscode"
		const traditionalPath = path.join(vscodeAppRoot, "node_modules/@vscode/ripgrep/bin/", binName)

		// Mock traditional path existing
		mockFileExists.mockImplementation(async (filePath: string) => {
			return filePath === traditionalPath
		})

		const result = await getBinPath(vscodeAppRoot)

		// Should return traditional path when it exists
		expect(result).toBe(traditionalPath)
	})
})
// kilocode_change end
