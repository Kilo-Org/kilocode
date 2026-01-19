/**
 * Tests for env-loader utilities
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { existsSync } from "fs"
import { config } from "dotenv"

// Mock fs and dotenv modules
vi.mock("fs", () => ({
	existsSync: vi.fn(),
}))

vi.mock("dotenv", () => ({
	config: vi.fn(),
}))

describe("loadEnvFile", () => {
	const mockExistsSync = vi.mocked(existsSync)
	const mockConfig = vi.mocked(config)
	let loadEnvFile: typeof import("../env-loader.js").loadEnvFile

	beforeEach(async () => {
		vi.clearAllMocks()
		vi.resetModules() // Reset module cache to ensure fresh import with mocks
		// Use vi.spyOn for safer mocking that auto-restores
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never)
		vi.spyOn(console, "error").mockImplementation(() => {})
		// Import module after mocks are set up
		const module = await import("../env-loader.js")
		loadEnvFile = module.loadEnvFile
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("should return early without logging when .env file does not exist", () => {
		mockExistsSync.mockReturnValue(false)

		loadEnvFile()

		expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining(".env"))
		expect(mockConfig).not.toHaveBeenCalled()
		expect(console.error).not.toHaveBeenCalled()
		expect(process.exit).not.toHaveBeenCalled()
	})

	it("should load .env file when it exists", () => {
		mockExistsSync.mockReturnValue(true)
		mockConfig.mockReturnValue({ parsed: { TEST_VAR: "value" } })

		loadEnvFile()

		expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining(".env"))
		expect(mockConfig).toHaveBeenCalledWith({ path: expect.stringContaining(".env") })
		expect(process.exit).not.toHaveBeenCalled()
	})

	it("should exit with error when .env file exists but has parsing errors", () => {
		mockExistsSync.mockReturnValue(true)
		mockConfig.mockReturnValue({ error: new Error("Parse error") })

		loadEnvFile()

		expect(mockExistsSync).toHaveBeenCalledWith(expect.stringContaining(".env"))
		expect(mockConfig).toHaveBeenCalledWith({ path: expect.stringContaining(".env") })
		expect(console.error).toHaveBeenCalledWith("Error loading .env file: Parse error")
		expect(process.exit).toHaveBeenCalledWith(1)
	})
})
