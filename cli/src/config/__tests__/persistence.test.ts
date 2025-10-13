import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import { homedir } from "os"
import type { CLIConfig } from "../types.js"
import {
	loadConfig,
	saveConfig,
	ensureConfigDir,
	configExists,
	setConfigPaths,
	resetConfigPaths,
} from "../persistence.js"
import { DEFAULT_CONFIG } from "../defaults.js"

// Mock the logs service
vi.mock("../../services/logs.js", () => ({
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
		readFile: vi.fn(async (filePath: any, encoding?: any) => {
			// If reading schema.json, return a minimal valid schema
			if (typeof filePath === "string" && filePath.includes("schema.json")) {
				return JSON.stringify({
					type: "object",
					properties: {},
					additionalProperties: true,
				})
			}
			// Otherwise use the actual implementation
			return actual.readFile(filePath, encoding)
		}),
	}
})

// Define test paths
const TEST_CONFIG_DIR = path.join(homedir(), ".kilocode", "cli-test")
const TEST_CONFIG_FILE = path.join(TEST_CONFIG_DIR, "config.json")

describe("Config Persistence", () => {
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

	describe("ensureConfigDir", () => {
		it("should create config directory if it doesn't exist", async () => {
			await ensureConfigDir()
			const stats = await fs.stat(TEST_CONFIG_DIR)
			expect(stats.isDirectory()).toBe(true)
		})

		it("should not fail if directory already exists", async () => {
			await ensureConfigDir()
			await expect(ensureConfigDir()).resolves.not.toThrow()
		})
	})

	describe("loadConfig", () => {
		it("should create default config if file doesn't exist", async () => {
			const config = await loadConfig()
			expect(config).toEqual(DEFAULT_CONFIG)
		})

		it("should load existing config from file", async () => {
			const testConfig: CLIConfig = {
				version: "1.0.0",
				mode: "architect",
				telemetry: true,
				theme: "dark",
				provider: "test-provider",
				providers: [
					{
						id: "test-provider",
						provider: "anthropic",
						apiKey: "test-key",
						apiModelId: "claude-3-5-sonnet-20241022",
					},
				],
				autoApproval: DEFAULT_CONFIG.autoApproval,
			}

			await saveConfig(testConfig)
			const loaded = await loadConfig()
			expect(loaded).toEqual(testConfig)
		})
	})

	describe("saveConfig", () => {
		it("should save config to file", async () => {
			const testConfig: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "test",
				providers: [
					{
						id: "test",
						provider: "kilocode",
						kilocodeToken: "test-token",
						kilocodeModel: "test-model",
					},
				],
			}

			await saveConfig(testConfig)
			const content = await fs.readFile(TEST_CONFIG_FILE, "utf-8")
			const parsed = JSON.parse(content)
			expect(parsed).toEqual(testConfig)
		})

		it("should format JSON with proper indentation", async () => {
			await saveConfig(DEFAULT_CONFIG)
			const content = await fs.readFile(TEST_CONFIG_FILE, "utf-8")
			expect(content).toContain("\n")
			expect(content).toContain("  ")
		})
	})

	describe("configExists", () => {
		it("should return false if config doesn't exist", async () => {
			const exists = await configExists()
			expect(exists).toBe(false)
		})

		it("should return true if config exists", async () => {
			await saveConfig(DEFAULT_CONFIG)
			const exists = await configExists()
			expect(exists).toBe(true)
		})
	})
})
