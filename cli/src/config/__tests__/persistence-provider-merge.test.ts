import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import type { CLIConfig } from "../types.js"

type PersistenceModule = typeof import("../persistence.js")
let loadConfig: PersistenceModule["loadConfig"]
let setConfigPaths: PersistenceModule["setConfigPaths"]
let resetConfigPaths: PersistenceModule["resetConfigPaths"]

// Mock the validation module
vi.mock("../validation.js", () => ({
	validateConfig: vi.fn().mockResolvedValue({ valid: true }),
}))

describe("Provider Merging", () => {
	const testDir = path.join(process.cwd(), "test-config-provider-merge")
	const testFile = path.join(testDir, "config.json")

	beforeEach(async () => {
		// Some other test files mock `../persistence.js`; ensure we always test the real implementation here.
		const persistence = await vi.importActual<PersistenceModule>("../persistence.js")
		loadConfig = persistence.loadConfig
		setConfigPaths = persistence.setConfigPaths
		resetConfigPaths = persistence.resetConfigPaths

		await fs.mkdir(testDir, { recursive: true })
		setConfigPaths(testDir, testFile)
	})

	afterEach(async () => {
		resetConfigPaths()
		await fs.rm(testDir, { recursive: true, force: true })
	})

	it("should merge provider fields from defaults when provider type matches", async () => {
		// Create a config file with matching provider type but missing some fields
		const configWithMatchingProvider = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [
				{
					id: "default",
					provider: "kilocode",
					// Missing kilocodeToken and kilocodeModel - should be filled from defaults
				},
			],
			theme: "dark",
		}

		await fs.writeFile(testFile, JSON.stringify(configWithMatchingProvider, null, 2))

		// Load the config - it should merge with defaults
		const result = await loadConfig()

		// Check that missing fields were added from defaults
		expect(result.config.providers[0]).toHaveProperty("provider")
		expect(result.config.providers[0].provider).toBe("kilocode")
		expect(result.config.providers[0].id).toBe("default")
		expect(result.config.providers[0]).toHaveProperty("kilocodeToken")
		expect(result.config.providers[0]).toHaveProperty("kilocodeModel")
		expect(result.config.providers[0].kilocodeModel).toBe("x-ai/grok-code-fast-1")
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

	it("should not merge fields when provider types don't match", async () => {
		// Create a config with anthropic provider - should not get kilocode fields
		const configWithDifferentProvider = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "anthropic-custom",
			providers: [
				{
					id: "anthropic-custom",
					provider: "anthropic",
					apiKey: "test-anthropic-key",
					// Should not get kilocodeToken or kilocodeModel
				},
			],
			theme: "dark",
		}

		await fs.writeFile(testFile, JSON.stringify(configWithDifferentProvider, null, 2))

		// Load the config
		const result = await loadConfig()

		// Check that anthropic provider doesn't have kilocode-specific fields
		expect(result.config.providers[0].provider).toBe("anthropic")
		expect(result.config.providers[0].apiKey).toBe("test-anthropic-key")
		expect(result.config.providers[0]).not.toHaveProperty("kilocodeToken")
		expect(result.config.providers[0]).not.toHaveProperty("kilocodeModel")
		expect(result.validation.valid).toBe(true)
	})

	it("should only merge when provider field matches between loaded and default config", async () => {
		// Create a config with kilocode provider that has custom values
		const configWithKilocodeProvider = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "custom-kilo",
			providers: [
				{
					id: "custom-kilo",
					provider: "kilocode",
					kilocodeToken: "custom-token-xyz",
					kilocodeModel: "anthropic/claude-opus-4",
				},
			],
			theme: "dark",
		}

		await fs.writeFile(testFile, JSON.stringify(configWithKilocodeProvider, null, 2))

		// Load the config
		const result = await loadConfig()

		// Check that custom values are preserved (not overwritten by defaults)
		expect(result.config.providers[0].provider).toBe("kilocode")
		expect(result.config.providers[0].id).toBe("custom-kilo")
		expect(result.config.providers[0].kilocodeToken).toBe("custom-token-xyz")
		expect(result.config.providers[0].kilocodeModel).toBe("anthropic/claude-opus-4")
		expect(result.validation.valid).toBe(true)
	})
})
