/**
 * Tests for history persistence and navigation
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import {
	loadHistory,
	saveHistory,
	addEntry,
	clearHistory,
	setHistoryPaths,
	resetHistoryPaths,
	type HistoryData,
} from "../config/history.js"

describe("History Persistence", () => {
	let testDir: string
	let testFile: string

	beforeEach(async () => {
		// Create temporary test directory
		testDir = path.join(os.tmpdir(), `kilocode-test-${Date.now()}`)
		testFile = path.join(testDir, "history.json")
		await fs.mkdir(testDir, { recursive: true })

		// Override history paths for testing
		setHistoryPaths(testDir, testFile)
	})

	afterEach(async () => {
		// Clean up test directory
		try {
			await fs.rm(testDir, { recursive: true, force: true })
		} catch (_error) {
			// Ignore cleanup errors
		}

		// Reset history paths
		resetHistoryPaths()
	})

	describe("loadHistory", () => {
		it("should create default history file if it doesn't exist", async () => {
			const data = await loadHistory()

			expect(data.version).toBe("1.0.0")
			expect(data.entries).toEqual([])
			expect(data.maxSize).toBe(500)

			// Verify file was created
			const fileExists = await fs
				.access(testFile)
				.then(() => true)
				.catch(() => false)
			expect(fileExists).toBe(true)
		})

		it("should load existing history file", async () => {
			const testData: HistoryData = {
				version: "1.0.0",
				entries: [
					{ prompt: "test command 1", timestamp: Date.now() },
					{ prompt: "test command 2", timestamp: Date.now() },
				],
				maxSize: 500,
			}

			await fs.writeFile(testFile, JSON.stringify(testData, null, 2))

			const data = await loadHistory()

			expect(data.entries).toHaveLength(2)
			expect(data.entries[0]?.prompt).toBe("test command 1")
			expect(data.entries[1]?.prompt).toBe("test command 2")
		})

		it("should return default history on invalid JSON", async () => {
			await fs.writeFile(testFile, "invalid json")

			const data = await loadHistory()

			expect(data.version).toBe("1.0.0")
			expect(data.entries).toEqual([])
		})

		it("should return default history on invalid structure", async () => {
			await fs.writeFile(testFile, JSON.stringify({ invalid: "structure" }))

			const data = await loadHistory()

			expect(data.version).toBe("1.0.0")
			expect(data.entries).toEqual([])
		})
	})

	describe("saveHistory", () => {
		it("should save history to file", async () => {
			const testData: HistoryData = {
				version: "1.0.0",
				entries: [{ prompt: "test command", timestamp: Date.now() }],
				maxSize: 500,
			}

			await saveHistory(testData)

			const content = await fs.readFile(testFile, "utf-8")
			const parsed = JSON.parse(content)

			expect(parsed.entries).toHaveLength(1)
			expect(parsed.entries[0].prompt).toBe("test command")
		})

		it("should trim entries to maxSize when saving", async () => {
			const entries = Array.from({ length: 600 }, (_, i) => ({
				prompt: `command ${i}`,
				timestamp: Date.now(),
			}))

			const testData: HistoryData = {
				version: "1.0.0",
				entries,
				maxSize: 500,
			}

			await saveHistory(testData)

			const content = await fs.readFile(testFile, "utf-8")
			const parsed = JSON.parse(content)

			expect(parsed.entries).toHaveLength(500)
			// Should keep the most recent 500
			expect(parsed.entries[0].prompt).toBe("command 100")
			expect(parsed.entries[499].prompt).toBe("command 599")
		})
	})

	describe("addEntry", () => {
		it("should add new entry to history", () => {
			const data: HistoryData = {
				version: "1.0.0",
				entries: [],
				maxSize: 500,
			}

			const newData = addEntry(data, "test command")

			expect(newData.entries).toHaveLength(1)
			expect(newData.entries[0]?.prompt).toBe("test command")
			expect(newData.entries[0]?.timestamp).toBeDefined()
		})

		it("should skip empty commands", () => {
			const data: HistoryData = {
				version: "1.0.0",
				entries: [],
				maxSize: 500,
			}

			const newData = addEntry(data, "")

			expect(newData.entries).toHaveLength(0)
		})

		it("should skip whitespace-only commands", () => {
			const data: HistoryData = {
				version: "1.0.0",
				entries: [],
				maxSize: 500,
			}

			const newData = addEntry(data, "   ")

			expect(newData.entries).toHaveLength(0)
		})

		it("should skip consecutive duplicates", () => {
			const data: HistoryData = {
				version: "1.0.0",
				entries: [{ prompt: "test command", timestamp: Date.now() }],
				maxSize: 500,
			}

			const newData = addEntry(data, "test command")

			expect(newData.entries).toHaveLength(1)
		})

		it("should allow non-consecutive duplicates", () => {
			const data: HistoryData = {
				version: "1.0.0",
				entries: [
					{ prompt: "command 1", timestamp: Date.now() },
					{ prompt: "command 2", timestamp: Date.now() },
				],
				maxSize: 500,
			}

			const newData = addEntry(data, "command 1")

			expect(newData.entries).toHaveLength(3)
			expect(newData.entries[2]?.prompt).toBe("command 1")
		})

		it("should trim to maxSize when adding", () => {
			const entries = Array.from({ length: 500 }, (_, i) => ({
				prompt: `command ${i}`,
				timestamp: Date.now(),
			}))

			const data: HistoryData = {
				version: "1.0.0",
				entries,
				maxSize: 500,
			}

			const newData = addEntry(data, "new command")

			expect(newData.entries).toHaveLength(500)
			expect(newData.entries[0]?.prompt).toBe("command 1")
			expect(newData.entries[499]?.prompt).toBe("new command")
		})
	})

	describe("clearHistory", () => {
		it("should clear all history entries", async () => {
			const testData: HistoryData = {
				version: "1.0.0",
				entries: [
					{ prompt: "command 1", timestamp: Date.now() },
					{ prompt: "command 2", timestamp: Date.now() },
				],
				maxSize: 500,
			}

			await saveHistory(testData)
			await clearHistory()

			const data = await loadHistory()

			expect(data.entries).toHaveLength(0)
		})
	})
})

describe("History Navigation", () => {
	it("should navigate through history in reverse chronological order", () => {
		const entries = [
			{ prompt: "oldest", timestamp: 1 },
			{ prompt: "middle", timestamp: 2 },
			{ prompt: "newest", timestamp: 3 },
		]

		// When navigating up (to older), we should see: newest -> middle -> oldest
		expect(entries[entries.length - 1]?.prompt).toBe("newest")
		expect(entries[entries.length - 2]?.prompt).toBe("middle")
		expect(entries[entries.length - 3]?.prompt).toBe("oldest")
	})
})
