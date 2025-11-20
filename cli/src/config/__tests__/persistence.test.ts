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
			const result = await loadConfig()
			expect(result.config).toEqual(DEFAULT_CONFIG)
			// Default config has empty credentials, so validation should fail
			expect(result.validation.valid).toBe(false)
			expect(result.validation.errors).toBeDefined()
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
						apiKey: "test-key-1234567890",
						apiModelId: "claude-3-5-sonnet-20241022",
					},
				],
				autoApproval: DEFAULT_CONFIG.autoApproval,
				customThemes: {},
			}

			await saveConfig(testConfig)
			const result = await loadConfig()
			expect(result.config).toEqual(testConfig)
			expect(result.validation.valid).toBe(true)
		})

		it("should return validation errors for invalid config", async () => {
			const invalidConfig = {
				...DEFAULT_CONFIG,
				provider: "test-provider",
				providers: [
					{
						id: "test-provider",
						provider: "anthropic",
						apiKey: "", // Empty API key should fail validation
						apiModelId: "claude-3-5-sonnet-20241022",
					},
				],
			}

			// Write invalid config directly to file (bypassing saveConfig validation)
			await ensureConfigDir()
			await fs.writeFile(TEST_CONFIG_FILE, JSON.stringify(invalidConfig, null, 2))

			const result = await loadConfig()
			expect(result.validation.valid).toBe(false)
			expect(result.validation.errors).toBeDefined()
			expect(result.validation.errors!.length).toBeGreaterThan(0)
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
						kilocodeToken: "test-token-1234567890",
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
			const validConfig: CLIConfig = {
				...DEFAULT_CONFIG,
				providers: [
					{
						id: "default",
						provider: "kilocode",
						kilocodeToken: "valid-token-1234567890",
						kilocodeModel: "anthropic/claude-sonnet-4.5",
					},
				],
			}
			await saveConfig(validConfig)
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
			const validConfig: CLIConfig = {
				...DEFAULT_CONFIG,
				providers: [
					{
						id: "default",
						provider: "kilocode",
						kilocodeToken: "valid-token-1234567890",
						kilocodeModel: "anthropic/claude-sonnet-4.5",
					},
				],
			}
			await saveConfig(validConfig)
			const exists = await configExists()
			expect(exists).toBe(true)
		})
	})
})
