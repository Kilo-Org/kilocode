import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import { loadConfig, setConfigPaths, resetConfigPaths } from "../persistence.js"
import type { CLIConfig } from "../types.js"

// Mock the validation module
vi.mock("../validation.js", () => ({
	validateConfig: vi.fn().mockResolvedValue({ valid: true }),
}))

describe("Provider Merging", () => {
	const testDir = path.join(process.cwd(), "test-config-provider-merge")
	const testFile = path.join(testDir, "config.json")

	beforeEach(async () => {
		await fs.mkdir(testDir, { recursive: true })
		setConfigPaths(testDir, testFile)
	})

	afterEach(async () => {
		resetConfigPaths()
		await fs.rm(testDir, { recursive: true, force: true })
	})

	it("should merge provider field from defaults when missing in loaded config", async () => {
		// Create a config file without the provider field in the provider object
		const configWithoutProviderField = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [
				{
					id: "default",
					// Missing 'provider' field
					kilocodeToken: "test-token-1234567890",
					kilocodeModel: "anthropic/claude-sonnet-4.5",
				},
			],
			theme: "dark",
		}

		await fs.writeFile(testFile, JSON.stringify(configWithoutProviderField, null, 2))

		// Load the config - it should merge with defaults
		const result = await loadConfig()

		// Check that the provider field was added from defaults
		expect(result.config.providers[0]).toHaveProperty("provider")
		expect(result.config.providers[0].provider).toBe("kilocode")
		expect(result.config.providers[0].id).toBe("default")
		expect(result.config.providers[0].kilocodeToken).toBe("test-token-1234567890")
		expect(result.config.providers[0].kilocodeModel).toBe("anthropic/claude-sonnet-4.5")
		expect(result.validation.valid).toBe(true)
	})

	it("should preserve provider field when present in loaded config", async () => {
		// Create a config file with the provider field
		const configWithProviderField: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [
				{
					id: "default",
					provider: "kilocode",
					kilocodeToken: "test-token-1234567890",
					kilocodeModel: "anthropic/claude-sonnet-4.5",
				},
			],
			theme: "dark",
		}

		await fs.writeFile(testFile, JSON.stringify(configWithProviderField, null, 2))

		// Load the config
		const result = await loadConfig()

		// Check that the provider field is preserved
		expect(result.config.providers[0].provider).toBe("kilocode")
		expect(result.config.providers[0].id).toBe("default")
		expect(result.config.providers[0].kilocodeToken).toBe("test-token-1234567890")
		expect(result.validation.valid).toBe(true)
	})

	it("should handle providers with different ids", async () => {
		// Create a config with a provider that doesn't match default id
		const configWithDifferentId = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "custom",
			providers: [
				{
					id: "custom",
					// Missing 'provider' field
					kilocodeToken: "test-token-1234567890",
					kilocodeModel: "anthropic/claude-sonnet-4.5",
				},
			],
			theme: "dark",
		}

		await fs.writeFile(testFile, JSON.stringify(configWithDifferentId, null, 2))

		// Load the config
		const result = await loadConfig()

		// Since there's no matching default provider with id "custom",
		// the provider field won't be added automatically
		// This will be caught by validation
		expect(result.config.providers[0].id).toBe("custom")
	})
})
