// kilocode_change - new file
/**
 * Tests for auto-update utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getAutoUpdateStatus, generateUpdateAvailableMessage } from "../auto-update.js"
import * as fs from "fs"
import * as path from "path"
import packageJson from "package-json"
import { KiloCodePaths } from "../paths.js"

// Mock dependencies
vi.mock("package-json")
vi.mock("fs")
vi.mock("../paths.js")

describe("auto-update utilities", () => {
	const mockGlobalStorageDir = "/mock/global/storage"
	const mockCacheFilePath = path.join(mockGlobalStorageDir, "version-check-cache.json")

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()

		// Mock KiloCodePaths
		vi.mocked(KiloCodePaths.getGlobalStorageDir).mockReturnValue(mockGlobalStorageDir)
		vi.mocked(KiloCodePaths.ensureDirectoryExists).mockImplementation(() => {})
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	describe("getAutoUpdateStatus", () => {
		it("should fetch latest version from npm when no cache exists", async () => {
			// Mock no cache file
			vi.mocked(fs.existsSync).mockReturnValue(false)

			// Mock npm registry response
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "1.0.0",
			} as any)

			const result = await getAutoUpdateStatus()

			expect(result).toMatchObject({
				name: "@kilocode/cli",
				latestVersion: "1.0.0",
			})
			expect(packageJson).toHaveBeenCalledWith("@kilocode/cli")
		})

		it("should detect when current version is outdated", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			// Mock a newer version available
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "99.0.0",
			} as any)

			const result = await getAutoUpdateStatus()

			expect(result.isOutdated).toBe(true)
			expect(result.latestVersion).toBe("99.0.0")
		})

		it("should detect when current version is up to date", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			// Mock same version
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "0.18.1", // Current version from package.json
			} as any)

			const result = await getAutoUpdateStatus()

			expect(result.isOutdated).toBe(false)
		})

		it("should use cached data when cache is valid (less than 24 hours old)", async () => {
			const now = Date.now()
			vi.setSystemTime(now)

			const mockCache = {
				lastChecked: now - 1000 * 60 * 60, // 1 hour ago
				latestVersion: "1.5.0",
				isOutdated: true,
			}

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCache))

			const result = await getAutoUpdateStatus()

			expect(result.latestVersion).toBe("1.5.0")
			expect(result.isOutdated).toBe(true)
			// Should not call npm registry
			expect(packageJson).not.toHaveBeenCalled()
		})

		it("should fetch new data when cache is expired (more than 24 hours old)", async () => {
			const now = Date.now()
			vi.setSystemTime(now)

			const mockCache = {
				lastChecked: now - 1000 * 60 * 60 * 25, // 25 hours ago
				latestVersion: "1.0.0",
				isOutdated: false,
			}

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCache))

			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "2.0.0",
			} as any)

			const result = await getAutoUpdateStatus()

			expect(result.latestVersion).toBe("2.0.0")
			// Should call npm registry because cache is expired
			expect(packageJson).toHaveBeenCalled()
		})

		it("should write cache after successful npm fetch", async () => {
			const now = Date.now()
			vi.setSystemTime(now)

			vi.mocked(fs.existsSync).mockReturnValue(false)
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "1.5.0",
			} as any)

			await getAutoUpdateStatus()

			expect(fs.writeFileSync).toHaveBeenCalledWith(
				mockCacheFilePath,
				expect.stringContaining('"latestVersion":"1.5.0"'),
				"utf-8",
			)
		})

		it("should handle npm registry errors gracefully and return default", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			vi.mocked(packageJson).mockRejectedValue(new Error("Network error"))

			const result = await getAutoUpdateStatus()

			expect(result).toMatchObject({
				name: "@kilocode/cli",
				isOutdated: false,
				currentVersion: expect.any(String),
				latestVersion: expect.any(String),
			})
		})

		it("should use cached data on npm error if cache exists", async () => {
			const mockCache = {
				lastChecked: Date.now() - 1000 * 60 * 60 * 25, // Expired cache
				latestVersion: "1.2.0",
				isOutdated: true,
			}

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockCache))
			vi.mocked(packageJson).mockRejectedValue(new Error("Network error"))

			const result = await getAutoUpdateStatus()

			// Should fall back to cached data even though it's expired
			expect(result.latestVersion).toBe("1.2.0")
			expect(result.isOutdated).toBe(true)
		})

		it("should handle corrupted cache file gracefully", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readFileSync).mockReturnValue("invalid json{")

			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "1.0.0",
			} as any)

			const result = await getAutoUpdateStatus()

			// Should fetch from npm when cache is corrupted
			expect(packageJson).toHaveBeenCalled()
			expect(result.latestVersion).toBe("1.0.0")
		})

		it("should handle cache with invalid structure", async () => {
			const invalidCache = {
				lastChecked: "not a number",
				latestVersion: 123, // Should be string
				isOutdated: "yes", // Should be boolean
			}

			vi.mocked(fs.existsSync).mockReturnValue(true)
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(invalidCache))

			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "1.0.0",
			} as any)

			const result = await getAutoUpdateStatus()

			// Should fetch from npm when cache structure is invalid
			expect(packageJson).toHaveBeenCalled()
			expect(result.latestVersion).toBe("1.0.0")
		})

		it("should handle file system errors when writing cache", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			vi.mocked(fs.writeFileSync).mockImplementation(() => {
				throw new Error("Permission denied")
			})

			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "1.0.0",
			} as any)

			// Should not throw error even if cache write fails
			const result = await getAutoUpdateStatus()

			expect(result.latestVersion).toBe("1.0.0")
		})

		it("should ensure global storage directory exists before writing cache", async () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			vi.mocked(packageJson).mockResolvedValue({
				name: "@kilocode/cli",
				version: "1.0.0",
			} as any)

			await getAutoUpdateStatus()

			expect(KiloCodePaths.ensureDirectoryExists).toHaveBeenCalledWith(mockGlobalStorageDir)
		})
	})

	describe("generateUpdateAvailableMessage", () => {
		it("should generate correct update message", () => {
			const status = {
				name: "@kilocode/cli",
				isOutdated: true,
				currentVersion: "0.18.1",
				latestVersion: "1.0.0",
			}

			const message = generateUpdateAvailableMessage(status)

			expect(message.type).toBe("system")
			expect(message.content).toContain("A new version of Kilo CLI is available!")
			expect(message.content).toContain("v0.18.1")
			expect(message.content).toContain("v1.0.0")
			expect(message.content).toContain("npm install -g @kilocode/cli")
		})

		it("should include package name in install command", () => {
			const status = {
				name: "@kilocode/cli",
				isOutdated: true,
				currentVersion: "1.0.0",
				latestVersion: "2.0.0",
			}

			const message = generateUpdateAvailableMessage(status)

			expect(message.content).toContain("npm install -g @kilocode/cli")
		})

		it("should have proper message structure", () => {
			const status = {
				name: "@kilocode/cli",
				isOutdated: true,
				currentVersion: "1.0.0",
				latestVersion: "2.0.0",
			}

			const message = generateUpdateAvailableMessage(status)

			expect(message).toHaveProperty("type")
			expect(message).toHaveProperty("content")
			expect(message).toHaveProperty("ts")
		})
	})
})
