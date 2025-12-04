import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import { loadConfig, setConfigPaths, resetConfigPaths } from "../persistence.js"
import { DEFAULT_AUTO_APPROVAL } from "../defaults.js"
import type { CLIConfig } from "../types.js"

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

describe("Config Persistence - Merge with Defaults", () => {
	const testDir = path.join(process.cwd(), "test-config-merge")
	const testFile = path.join(testDir, "config.json")

	beforeEach(async () => {
		// Setup test directory
		await fs.mkdir(testDir, { recursive: true })
		setConfigPaths(testDir, testFile)
	})

	afterEach(async () => {
		// Cleanup
		resetConfigPaths()
		try {
			await fs.rm(testDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	it("should fill missing autoApproval section with defaults", async () => {
		// Create config without autoApproval
		const partialConfig: Partial<CLIConfig> = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [
				{
					id: "default",
					provider: "kilocode",
					kilocodeToken: "valid-token-1234567890",
					kilocodeModel: "anthropic/claude-sonnet-4",
				},
			],
		}

		await fs.writeFile(testFile, JSON.stringify(partialConfig, null, 2))

		const result = await loadConfig()

		expect(result.config.autoApproval).toBeDefined()
		expect(result.config.autoApproval).toEqual(DEFAULT_AUTO_APPROVAL)
		expect(result.validation.valid).toBe(true)
	})

	it("should fill missing autoApproval nested keys with defaults", async () => {
		// Create config with partial autoApproval
		const partialConfig: Partial<CLIConfig> = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [
				{
					id: "default",
					provider: "kilocode",
					kilocodeToken: "valid-token-1234567890",
					kilocodeModel: "anthropic/claude-sonnet-4",
				},
			],
			autoApproval: {
				enabled: true,
				read: {
					enabled: false,
				},
				// Missing: write, browser, retry, etc.
			},
		}

		await fs.writeFile(testFile, JSON.stringify(partialConfig, null, 2))

		const result = await loadConfig()

		expect(result.config.autoApproval?.enabled).toBe(true)
		expect(result.config.autoApproval?.read?.enabled).toBe(false)
		expect(result.config.autoApproval?.read?.outside).toBe(DEFAULT_AUTO_APPROVAL.read?.outside)
		expect(result.config.autoApproval?.write).toEqual(DEFAULT_AUTO_APPROVAL.write)
		expect(result.config.autoApproval?.browser).toEqual(DEFAULT_AUTO_APPROVAL.browser)
		expect(result.config.autoApproval?.retry).toEqual(DEFAULT_AUTO_APPROVAL.retry)
		expect(result.config.autoApproval?.execute).toEqual(DEFAULT_AUTO_APPROVAL.execute)
		expect(result.config.autoApproval?.question).toEqual(DEFAULT_AUTO_APPROVAL.question)
		expect(result.validation.valid).toBe(true)
	})

	it("should preserve existing values while filling missing ones", async () => {
		// Create config with some custom values
		const partialConfig: Partial<CLIConfig> = {
			version: "1.0.0",
			mode: "architect",
			telemetry: false,
			provider: "default",
			providers: [
				{
					id: "default",
					provider: "kilocode",
					kilocodeToken: "test-token-1234567890",
					kilocodeModel: "anthropic/claude-sonnet-4",
				},
			],
			autoApproval: {
				enabled: true,
				execute: {
					enabled: true,
					allowed: ["npm", "git"],
					denied: ["rm -rf"],
				},
			},
		}

		await fs.writeFile(testFile, JSON.stringify(partialConfig, null, 2))

		const result = await loadConfig()

		// Custom values should be preserved
		expect(result.config.mode).toBe("architect")
		expect(result.config.telemetry).toBe(false)
		expect(result.config.autoApproval?.enabled).toBe(true)
		expect(result.config.autoApproval?.execute?.enabled).toBe(true)
		expect(result.config.autoApproval?.execute?.allowed).toEqual(["npm", "git"])
		expect(result.config.autoApproval?.execute?.denied).toEqual(["rm -rf"])

		// Missing values should be filled with defaults
		expect(result.config.autoApproval?.read).toEqual(DEFAULT_AUTO_APPROVAL.read)
		expect(result.config.autoApproval?.write).toEqual(DEFAULT_AUTO_APPROVAL.write)
		expect(result.config.autoApproval?.retry).toEqual(DEFAULT_AUTO_APPROVAL.retry)
		expect(result.validation.valid).toBe(true)
	})

	it("should save merged config back to file", async () => {
		// Create minimal config
		const minimalConfig: Partial<CLIConfig> = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [
				{
					id: "default",
					provider: "kilocode",
					kilocodeToken: "valid-token-1234567890",
					kilocodeModel: "anthropic/claude-sonnet-4",
				},
			],
		}

		await fs.writeFile(testFile, JSON.stringify(minimalConfig, null, 2))

		// Load config (which should merge and save)
		await loadConfig()

		// Read the file again
		const savedContent = await fs.readFile(testFile, "utf-8")
		const savedConfig = JSON.parse(savedContent)

		// Verify autoApproval was added to the file
		expect(savedConfig.autoApproval).toBeDefined()
		expect(savedConfig.autoApproval).toEqual(DEFAULT_AUTO_APPROVAL)
	})

	it("should handle deeply nested missing keys", async () => {
		// Create config with partial nested structure
		const partialConfig: Partial<CLIConfig> = {
			version: "1.0.0",
			mode: "code",
			telemetry: true,
			provider: "default",
			providers: [
				{
					id: "default",
					provider: "kilocode",
					kilocodeToken: "valid-token-1234567890",
					kilocodeModel: "anthropic/claude-sonnet-4",
				},
			],
			autoApproval: {
				enabled: true,
				retry: {
					enabled: true,
					// Missing: delay
				},
				question: {
					// Missing: enabled, timeout
				},
			},
		}

		await fs.writeFile(testFile, JSON.stringify(partialConfig, null, 2))

		const result = await loadConfig()

		expect(result.config.autoApproval?.retry?.enabled).toBe(true)
		expect(result.config.autoApproval?.retry?.delay).toBe(DEFAULT_AUTO_APPROVAL.retry?.delay)
		expect(result.config.autoApproval?.question?.enabled).toBe(DEFAULT_AUTO_APPROVAL.question?.enabled)
		expect(result.config.autoApproval?.question?.timeout).toBe(DEFAULT_AUTO_APPROVAL.question?.timeout)
		expect(result.validation.valid).toBe(true)
	})
})
