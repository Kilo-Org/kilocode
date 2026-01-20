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
	getKiloToken,
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

// Mock env-config to control ephemeral mode behavior
vi.mock("../env-config.js", async () => {
	const actual = await vi.importActual<typeof import("../env-config.js")>("../env-config.js")
	return {
		...actual,
		isEphemeralMode: vi.fn(() => false), // Default to false, tests can override
	}
})

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
		it("should return default config in memory without creating file if file doesn't exist", async () => {
			const result = await loadConfig()
			expect(result.config).toEqual(DEFAULT_CONFIG)
			// Default config has empty credentials, so validation should fail
			expect(result.validation.valid).toBe(false)
			expect(result.validation.errors).toBeDefined()

			// Verify that the config file was NOT created
			const exists = await configExists()
			expect(exists).toBe(false)
		})

		it("should create config file when saveConfig is called after loadConfig", async () => {
			// Load config (should not create file)
			const result = await loadConfig()
			expect(result.config).toEqual(DEFAULT_CONFIG)

			// Verify file doesn't exist yet
			let exists = await configExists()
			expect(exists).toBe(false)

			// Now save a valid config
			const validConfig: CLIConfig = {
				...DEFAULT_CONFIG,
				provider: "test-provider",
				providers: [
					{
						id: "test-provider",
						provider: "kilocode",
						kilocodeToken: "test-token-1234567890",
						kilocodeModel: "anthropic/claude-sonnet-4.5",
					},
				],
			}
			await saveConfig(validConfig)

			// Now file should exist
			exists = await configExists()
			expect(exists).toBe(true)

			// And we should be able to load it
			const loadedResult = await loadConfig()
			expect(loadedResult.config).toEqual(validConfig)
			expect(loadedResult.validation.valid).toBe(true)
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

		it("should return default config when config file is empty", async () => {
			// Create an empty config file
			await ensureConfigDir()
			await fs.writeFile(TEST_CONFIG_FILE, "")

			// Verify file exists
			const exists = await configExists()
			expect(exists).toBe(true)

			// Load config - should return default config instead of throwing
			const result = await loadConfig()
			expect(result.config).toEqual(DEFAULT_CONFIG)
			// Default config has empty credentials, so validation should fail
			expect(result.validation.valid).toBe(false)
		})

		it("should return default config when config file contains only whitespace", async () => {
			// Create a config file with only whitespace
			await ensureConfigDir()
			await fs.writeFile(TEST_CONFIG_FILE, "   \n\t  \n  ")

			// Verify file exists
			const exists = await configExists()
			expect(exists).toBe(true)

			// Load config - should return default config instead of throwing
			const result = await loadConfig()
			expect(result.config).toEqual(DEFAULT_CONFIG)
		})

		it("should return default config when config file contains invalid JSON", async () => {
			// Create a config file with invalid JSON
			await ensureConfigDir()
			await fs.writeFile(TEST_CONFIG_FILE, '{ "version": "1.0.0", invalid json }')

			// Verify file exists
			const exists = await configExists()
			expect(exists).toBe(true)

			// Load config - should return default config instead of throwing
			const result = await loadConfig()
			expect(result.config).toEqual(DEFAULT_CONFIG)
		})

		it("should return default config when config file is truncated JSON", async () => {
			// Create a config file with truncated JSON (simulating interrupted write)
			await ensureConfigDir()
			await fs.writeFile(TEST_CONFIG_FILE, '{ "version": "1.0.0", "mode": "code"')

			// Verify file exists
			const exists = await configExists()
			expect(exists).toBe(true)

			// Load config - should return default config instead of throwing
			const result = await loadConfig()
			expect(result.config).toEqual(DEFAULT_CONFIG)
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

	describe("getKiloToken", () => {
		it("should extract kilocodeToken from kilocode provider", async () => {
			const config = {
				version: "1.0.0",
				mode: "code",
				telemetry: true,
				provider: "default",
				providers: [
					{
						id: "default",
						provider: "kilocode",
						kilocodeToken: "provider-token-1234567890",
						kilocodeModel: "anthropic/claude-sonnet-4.5",
					},
				],
				autoApproval: DEFAULT_CONFIG.autoApproval,
				theme: "dark",
			} as CLIConfig

			const token = getKiloToken(config)
			expect(token).toBe("provider-token-1234567890")
		})

		it("should return null when provider is not kilocode", async () => {
			const config = {
				version: "1.0.0",
				mode: "code",
				telemetry: true,
				provider: "anthropic-provider",
				providers: [
					{
						id: "anthropic-provider",
						provider: "anthropic",
						apiKey: "anthropic-key-1234567890",
						apiModelId: "claude-3-5-sonnet-20241022",
					},
				],
				autoApproval: DEFAULT_CONFIG.autoApproval,
				theme: "dark",
			} as CLIConfig

			const token = getKiloToken(config)
			expect(token).toBeNull()
		})

		it("should return null when provider is kilocode but kilocodeToken doesn't exist", async () => {
			const config = {
				version: "1.0.0",
				mode: "code",
				telemetry: true,
				provider: "default",
				providers: [
					{
						id: "default",
						provider: "kilocode",
						kilocodeModel: "anthropic/claude-sonnet-4.5",
					},
				],
				autoApproval: DEFAULT_CONFIG.autoApproval,
				theme: "dark",
			} as CLIConfig

			const token = getKiloToken(config)
			expect(token).toBeNull()
		})

		it("should return empty string when provider has empty kilocodeToken", async () => {
			const config = {
				version: "1.0.0",
				mode: "code",
				telemetry: true,
				provider: "default",
				providers: [
					{
						id: "default",
						provider: "kilocode",
						kilocodeToken: "",
						kilocodeModel: "anthropic/claude-sonnet-4.5",
					},
				],
				autoApproval: DEFAULT_CONFIG.autoApproval,
				theme: "dark",
			} as CLIConfig

			const token = getKiloToken(config)
			expect(token).toBe("")
		})

		it("should return null when no kilocode provider exists", async () => {
			const config = {
				version: "1.0.0",
				mode: "code",
				telemetry: true,
				provider: "openai-provider",
				providers: [
					{
						id: "openai-provider",
						provider: "openai",
						apiKey: "openai-key-1234567890",
					},
				],
				autoApproval: DEFAULT_CONFIG.autoApproval,
				theme: "dark",
			} as CLIConfig

			const token = getKiloToken(config)
			expect(token).toBeNull()
		})
	})

	describe("ephemeral mode", () => {
		it("should not write config file when in ephemeral mode", async () => {
			// Import the mocked module to control ephemeral mode
			const envConfig = await import("../env-config.js")
			vi.mocked(envConfig.isEphemeralMode).mockReturnValue(true)

			const testConfig: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "test",
				providers: [
					{
						id: "test",
						provider: "kilocode",
						kilocodeToken: "env-token-should-not-be-saved",
						kilocodeModel: "test-model",
					},
				],
			}

			// This should NOT create a file because we're in ephemeral mode
			await saveConfig(testConfig)

			// Verify file was NOT created
			const exists = await configExists()
			expect(exists).toBe(false)

			// Reset mock
			vi.mocked(envConfig.isEphemeralMode).mockReturnValue(false)
		})

		it("should write config file when not in ephemeral mode", async () => {
			// Import the mocked module to control ephemeral mode
			const envConfig = await import("../env-config.js")
			vi.mocked(envConfig.isEphemeralMode).mockReturnValue(false)

			const testConfig: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: false,
				provider: "test",
				providers: [
					{
						id: "test",
						provider: "kilocode",
						kilocodeToken: "real-token-should-be-saved",
						kilocodeModel: "test-model",
					},
				],
			}

			// This should create a file because we're NOT in ephemeral mode
			await saveConfig(testConfig)

			// Verify file WAS created
			const exists = await configExists()
			expect(exists).toBe(true)

			// Verify content was written correctly
			const content = await fs.readFile(TEST_CONFIG_FILE, "utf-8")
			const parsed = JSON.parse(content)
			expect(parsed.providers[0].kilocodeToken).toBe("real-token-should-be-saved")
		})

		it("should not persist merged config during loadConfig when in ephemeral mode", async () => {
			// Import the mocked module to control ephemeral mode
			const envConfig = await import("../env-config.js")

			// First, create a config file while NOT in ephemeral mode
			vi.mocked(envConfig.isEphemeralMode).mockReturnValue(false)

			const initialConfig: CLIConfig = {
				version: "1.0.0",
				mode: "code",
				telemetry: true,
				provider: "test",
				providers: [
					{
						id: "test",
						provider: "kilocode",
						kilocodeToken: "original-token-1234567890",
						kilocodeModel: "test-model",
					},
				],
				autoApproval: DEFAULT_CONFIG.autoApproval,
				theme: "dark",
				customThemes: {},
			}
			await saveConfig(initialConfig)

			// Now switch to ephemeral mode
			vi.mocked(envConfig.isEphemeralMode).mockReturnValue(true)

			// Load the config - this would normally trigger a save after merging
			const result = await loadConfig()
			expect(result.config.providers[0]).toHaveProperty("kilocodeToken", "original-token-1234567890")

			// Verify the file still has the original content (not re-saved in ephemeral mode)
			const content = await fs.readFile(TEST_CONFIG_FILE, "utf-8")
			const parsed = JSON.parse(content)
			expect(parsed.providers[0].kilocodeToken).toBe("original-token-1234567890")

			// Reset mock
			vi.mocked(envConfig.isEphemeralMode).mockReturnValue(false)
		})
	})
})
