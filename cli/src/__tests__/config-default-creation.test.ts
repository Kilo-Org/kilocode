import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import { homedir } from "os"
import { saveConfig, setConfigPaths, resetConfigPaths, ensureConfigDir } from "../config/persistence.js"
import { DEFAULT_CONFIG } from "../config/defaults.js"

// Mock the logs service
vi.mock("../services/logs.js", () => ({
	logs: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	},
}))

// Mock fs/promises to handle schema.json reads
vi.mock("fs/promises", async () => {
	const actual = await vi.importActual<typeof import("fs/promises")>("fs/promises")
	return {
		...actual,
		readFile: vi.fn(async (filePath: string | Buffer | URL, encoding?: BufferEncoding | null) => {
			// If reading schema.json, return a minimal valid schema
			if (typeof filePath === "string" && filePath.includes("schema.json")) {
				return JSON.stringify({
					type: "object",
					properties: {},
					additionalProperties: true,
				})
			}
			// Otherwise use the actual implementation
			return actual.readFile(filePath, encoding as BufferEncoding)
		}),
	}
})

// Define test paths
const TEST_CONFIG_DIR = path.join(homedir(), ".kilocode", "cli-test-default")
const TEST_CONFIG_FILE = path.join(TEST_CONFIG_DIR, "config.json")

describe("Default Config Creation", () => {
	beforeEach(async () => {
		// Set test config paths
		setConfigPaths(TEST_CONFIG_DIR, TEST_CONFIG_FILE)

		// Clean up test directory before each test
		try {
			await fs.rm(TEST_CONFIG_DIR, { recursive: true, force: true })
		} catch {
			// Ignore if doesn't exist
		}
	})

	afterEach(async () => {
		// Reset config paths
		resetConfigPaths()

		// Clean up test directory after each test
		try {
			await fs.rm(TEST_CONFIG_DIR, { recursive: true, force: true })
		} catch {
			// Ignore if doesn't exist
		}
	})

	it("should create default config without validation when skipValidation is true", async () => {
		// Ensure directory exists
		await ensureConfigDir()

		// Save default config with skipValidation=true (simulating 'kilocode config' command)
		// This should succeed even though DEFAULT_CONFIG has empty tokens
		await expect(saveConfig(DEFAULT_CONFIG, true)).resolves.not.toThrow()

		// Verify file was created
		const content = await fs.readFile(TEST_CONFIG_FILE, "utf-8")
		const parsed = JSON.parse(content)
		expect(parsed).toEqual(DEFAULT_CONFIG)
	})

	it("should fail to save default config when validation is enabled", async () => {
		// Ensure directory exists
		await ensureConfigDir()

		// Save default config with skipValidation=false (default)
		// This should fail because DEFAULT_CONFIG has empty tokens
		await expect(saveConfig(DEFAULT_CONFIG, false)).rejects.toThrow(/Invalid config/)
	})

	it("should fail to save default config when skipValidation is not provided", async () => {
		// Ensure directory exists
		await ensureConfigDir()

		// Save default config without skipValidation parameter (defaults to false)
		// This should fail because DEFAULT_CONFIG has empty tokens
		await expect(saveConfig(DEFAULT_CONFIG)).rejects.toThrow(/Invalid config/)
	})
})
