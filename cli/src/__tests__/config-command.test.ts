import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { setConfigPaths, resetConfigPaths, saveConfig, configExists, getConfigPath } from "../config/persistence.js"
import { DEFAULT_CONFIG } from "../config/defaults.js"
import type { CLIConfig } from "../config/types.js"

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

// Mock environment variables to avoid ephemeral mode
vi.stubEnv("KILOCODE_EPHEMERAL", "false")

describe("Config Command", () => {
	let testDir: string
	let testConfigFile: string
	let validConfig: CLIConfig

	beforeEach(() => {
		// Create a temporary directory for testing
		testDir = join(tmpdir(), `kilocode-test-${Date.now()}`)
		testConfigFile = join(testDir, "config.json")
		mkdirSync(testDir, { recursive: true })
		setConfigPaths(testDir, testConfigFile)

		// Create a valid config with non-empty credentials
		validConfig = {
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
	})

	afterEach(() => {
		// Clean up
		resetConfigPaths()
		if (existsSync(testDir)) {
			rmSync(testDir, { recursive: true, force: true })
		}
	})

	it("should create config file if it doesn't exist", async () => {
		// Verify config doesn't exist
		expect(await configExists()).toBe(false)

		// Save valid config (simulating what the command does)
		await saveConfig(validConfig)

		// Verify config was created
		expect(await configExists()).toBe(true)
		expect(existsSync(testConfigFile)).toBe(true)
	})

	it("should create config with correct default values", async () => {
		// Save valid config
		await saveConfig(validConfig)

		// Read and verify the config
		const configContent = readFileSync(testConfigFile, "utf-8")
		const config = JSON.parse(configContent)

		expect(config.version).toBe("1.0.0")
		expect(config.mode).toBe("code")
		expect(config.telemetry).toBe(true)
		expect(config.provider).toBe("default")
		expect(config.providers).toHaveLength(1)
		expect(config.providers[0].id).toBe("default")
		expect(config.providers[0].provider).toBe("kilocode")
	})

	it("should return correct config path", async () => {
		const path = await getConfigPath()
		expect(path).toBe(testConfigFile)
	})

	it("should detect existing config file", async () => {
		// Create config
		await saveConfig(validConfig)

		// Verify it's detected
		expect(await configExists()).toBe(true)
	})

	it("should format config file with proper indentation", async () => {
		await saveConfig(validConfig)

		const configContent = readFileSync(testConfigFile, "utf-8")

		// Check that it's properly formatted (has newlines and indentation)
		expect(configContent).toContain("\n")
		expect(configContent).toContain("  ") // 2-space indentation
	})
})
