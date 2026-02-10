import * as fs from "fs/promises"
import * as path from "path"

import { getHistoryFilePath, loadHistory, saveHistory, addToHistory, MAX_HISTORY_ENTRIES } from "../history.js"

vi.mock("fs/promises")

vi.mock("os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("os")>()
	return {
		...actual,
		default: {
			...actual,
			homedir: vi.fn(() => "/home/testuser"),
		},
		homedir: vi.fn(() => "/home/testuser"),
	}
})

describe("historyStorage", () => {
	beforeEach(() => {
		vi.resetAllMocks()
	})

	describe("getHistoryFilePath", () => {
		it("should return the correct path to cli-history.json", () => {
			const result = getHistoryFilePath()
			expect(result).toBe(path.join("/home/testuser", ".roo", "cli-history.json"))
		})
	})

	describe("loadHistory", () => {
		it("should return empty array when file does not exist", async () => {
			const error = new Error("ENOENT") as NodeJS.ErrnoException
			error.code = "ENOENT"
			vi.mocked(fs.readFile).mockRejectedValue(error)

			const result = await loadHistory()

			expect(result).toEqual([])
		})

		it("should return entries from valid JSON file", async () => {
			const mockData = {
				version: 1,
				entries: ["first command", "second command", "third command"],
			}
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData))

			const result = await loadHistory()

			expect(result).toEqual(["first command", "second command", "third command"])
		})

		it("should return empty array for invalid JSON", async () => {
			vi.mocked(fs.readFile).mockResolvedValue("not valid json")

			// Suppress console.error for this test
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			const result = await loadHistory()

			expect(result).toEqual([])
			consoleSpy.mockRestore()
		})

		it("should filter out non-string entries", async () => {
			const mockData = {
				version: 1,
				entries: ["valid", 123, "also valid", null, ""],
			}
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData))

			const result = await loadHistory()

			expect(result).toEqual(["valid", "also valid"])
		})

		it("should return empty array when entries is not an array", async () => {
			const mockData = {
				version: 1,
				entries: "not an array",
			}
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData))

			const result = await loadHistory()

			expect(result).toEqual([])
		})
	})

	describe("saveHistory", () => {
		it("should create directory and save history", async () => {
			vi.mocked(fs.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.writeFile).mockResolvedValue(undefined)

			await saveHistory(["command1", "command2"])

			expect(fs.mkdir).toHaveBeenCalledWith(path.join("/home/testuser", ".roo"), { recursive: true })
			expect(fs.writeFile).toHaveBeenCalled()

			// Verify the content written
			const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
			const writtenContent = JSON.parse(writeCall?.[1] as string)
			expect(writtenContent.version).toBe(1)
			expect(writtenContent.entries).toEqual(["command1", "command2"])
		})

		it("should trim entries to MAX_HISTORY_ENTRIES", async () => {
			vi.mocked(fs.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.writeFile).mockResolvedValue(undefined)

			// Create array larger than MAX_HISTORY_ENTRIES
			const manyEntries = Array.from({ length: MAX_HISTORY_ENTRIES + 100 }, (_, i) => `command${i}`)

			await saveHistory(manyEntries)

			const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
			const writtenContent = JSON.parse(writeCall?.[1] as string)
			expect(writtenContent.entries.length).toBe(MAX_HISTORY_ENTRIES)
			// Should keep the most recent entries (last 500)
			expect(writtenContent.entries[0]).toBe(`command100`)
			expect(writtenContent.entries[MAX_HISTORY_ENTRIES - 1]).toBe(`command${MAX_HISTORY_ENTRIES + 99}`)
		})

		it("should handle directory already exists error", async () => {
			const error = new Error("EEXIST") as NodeJS.ErrnoException
			error.code = "EEXIST"
			vi.mocked(fs.mkdir).mockRejectedValue(error)
			vi.mocked(fs.writeFile).mockResolvedValue(undefined)

			// Should not throw
			await expect(saveHistory(["command"])).resolves.not.toThrow()
		})

		it("should log warning on write error but not throw", async () => {
			vi.mocked(fs.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.writeFile).mockRejectedValue(new Error("Permission denied"))

			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			await expect(saveHistory(["command"])).resolves.not.toThrow()
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Could not save CLI history"),
				expect.any(String),
			)

			consoleSpy.mockRestore()
		})
	})

	describe("addToHistory", () => {
		it("should add new entry to history", async () => {
			const mockData = {
				version: 1,
				entries: ["existing command"],
			}
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData))
			vi.mocked(fs.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.writeFile).mockResolvedValue(undefined)

			const result = await addToHistory("new command")

			expect(result).toEqual(["existing command", "new command"])
		})

		it("should not add empty strings", async () => {
			const mockData = {
				version: 1,
				entries: ["existing command"],
			}
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData))

			const result = await addToHistory("")

			expect(result).toEqual(["existing command"])
			expect(fs.writeFile).not.toHaveBeenCalled()
		})

		it("should not add whitespace-only strings", async () => {
			const mockData = {
				version: 1,
				entries: ["existing command"],
			}
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData))

			const result = await addToHistory("   ")

			expect(result).toEqual(["existing command"])
			expect(fs.writeFile).not.toHaveBeenCalled()
		})

		it("should not add consecutive duplicates", async () => {
			const mockData = {
				version: 1,
				entries: ["first", "second"],
			}
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData))

			const result = await addToHistory("second")

			expect(result).toEqual(["first", "second"])
			expect(fs.writeFile).not.toHaveBeenCalled()
		})

		it("should add non-consecutive duplicates", async () => {
			const mockData = {
				version: 1,
				entries: ["first", "second"],
			}
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData))
			vi.mocked(fs.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.writeFile).mockResolvedValue(undefined)

			const result = await addToHistory("first")

			expect(result).toEqual(["first", "second", "first"])
		})

		it("should trim whitespace from entry before adding", async () => {
			const mockData = {
				version: 1,
				entries: ["existing"],
			}
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData))
			vi.mocked(fs.mkdir).mockResolvedValue(undefined)
			vi.mocked(fs.writeFile).mockResolvedValue(undefined)

			const result = await addToHistory("  new command  ")

			expect(result).toEqual(["existing", "new command"])
		})
	})

	describe("MAX_HISTORY_ENTRIES", () => {
		it("should be 500", () => {
			expect(MAX_HISTORY_ENTRIES).toBe(500)
		})
	})
})
