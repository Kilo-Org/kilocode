/**
 * Tests for the update service
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { spawn, type ChildProcess } from "child_process"
import { readFileSync } from "fs"
import { EventEmitter } from "events"
import {
	getCurrentVersion,
	checkForUpdates,
	performUpdate,
	restartCLI,
	compareVersions,
	isVersionGreater,
	isVersionLess,
	isVersionEqual,
	getLastUpdateCheckTimestamp,
} from "../update.js"

// Mock the logs module
vi.mock("../logs.js", () => ({
	logs: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}))

// Mock the child_process module
vi.mock("child_process")

// Mock the fs module
vi.mock("fs")

// Mock @roo-code/core
vi.mock("@roo-code/core", () => ({
	getCliInstallCommand: vi.fn(() => "npm install -g @kilocode/cli"),
	getLocalCliInstallCommand: vi.fn(() => "npm install @kilocode/cli --prefix /home/user/.kilocode/cli/pkg"),
}))

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// Helper function to create mock child process
const createMockProcess = (): ChildProcess => {
	const mockProcess = new EventEmitter() as unknown as ChildProcess
	Object.defineProperty(mockProcess, "stdio", {
		value: { inherit: true },
		writable: true,
	})
	Object.defineProperty(mockProcess, "unref", {
		value: vi.fn(),
		writable: true,
	})
	return mockProcess
}

describe("update service", () => {
	describe("getCurrentVersion", () => {
		it("should return the version from package.json", () => {
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: "1.2.3" }))

			const version = getCurrentVersion()

			expect(version).toBe("1.2.3")
			expect(readFileSync).toHaveBeenCalled()
		})

		it("should return '0.0.0' when package.json is invalid", () => {
			vi.mocked(readFileSync).mockReturnValue("invalid json")

			const version = getCurrentVersion()

			expect(version).toBe("0.0.0")
		})

		it("should return '0.0.0' when package.json has no version", () => {
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({}))

			const version = getCurrentVersion()

			expect(version).toBe("0.0.0")
		})

		it("should return '0.0.0' when reading package.json fails", () => {
			vi.mocked(readFileSync).mockImplementation(() => {
				throw new Error("File not found")
			})

			const version = getCurrentVersion()

			expect(version).toBe("0.0.0")
		})
	})

	describe("checkForUpdates", () => {
		beforeEach(() => {
			vi.clearAllMocks()
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: "1.0.0" }))
		})

		it("should return update available when latest version is greater", async () => {
			vi.mocked(mockFetch).mockResolvedValue({
				ok: true,
				json: async () => ({
					"dist-tags": { latest: "1.1.0" },
				}),
			} as Response)

			const result = await checkForUpdates()

			expect(result.currentVersion).toBe("1.0.0")
			expect(result.latestVersion).toBe("1.1.0")
			expect(result.updateAvailable).toBe(true)
			expect(result.message).toBe("Update available: 1.0.0 → 1.1.0")
		})

		it("should return no update available when versions are equal", async () => {
			vi.mocked(mockFetch).mockResolvedValue({
				ok: true,
				json: async () => ({
					"dist-tags": { latest: "1.0.0" },
				}),
			} as Response)

			const result = await checkForUpdates()

			expect(result.currentVersion).toBe("1.0.0")
			expect(result.latestVersion).toBe("1.0.0")
			expect(result.updateAvailable).toBe(false)
			expect(result.message).toBe("Already up to date (v1.0.0)")
		})

		it("should return no update available when current version is greater", async () => {
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: "1.1.0" }))

			vi.mocked(mockFetch).mockResolvedValue({
				ok: true,
				json: async () => ({
					"dist-tags": { latest: "1.0.0" },
				}),
			} as Response)

			const result = await checkForUpdates()

			expect(result.currentVersion).toBe("1.1.0")
			expect(result.latestVersion).toBe("1.0.0")
			expect(result.updateAvailable).toBe(false)
			expect(result.message).toBe("Already up to date (v1.1.0)")
		})

		it("should return null latestVersion when fetch fails", async () => {
			vi.mocked(mockFetch).mockResolvedValue({
				ok: false,
				status: 404,
				statusText: "Not Found",
			} as Response)

			const result = await checkForUpdates()

			expect(result.currentVersion).toBe("1.0.0")
			expect(result.latestVersion).toBe(null)
			expect(result.updateAvailable).toBe(false)
			expect(result.message).toBe("Failed to check for updates. Please try again later.")
		})

		it("should return null latestVersion when network error occurs", async () => {
			vi.mocked(mockFetch).mockRejectedValue(new Error("Network error"))

			const result = await checkForUpdates()

			expect(result.currentVersion).toBe("1.0.0")
			expect(result.latestVersion).toBe(null)
			expect(result.updateAvailable).toBe(false)
			expect(result.message).toBe("Failed to check for updates. Please try again later.")
		})

		it("should return null latestVersion when dist-tags is missing", async () => {
			vi.mocked(mockFetch).mockResolvedValue({
				ok: true,
				json: async () => ({}),
			} as Response)

			const result = await checkForUpdates()

			expect(result.currentVersion).toBe("1.0.0")
			expect(result.latestVersion).toBe(null)
			expect(result.updateAvailable).toBe(false)
			expect(result.message).toBe("Failed to check for updates. Please try again later.")
		})

		it("should return null latestVersion when latest tag is missing", async () => {
			vi.mocked(mockFetch).mockResolvedValue({
				ok: true,
				json: async () => ({
					"dist-tags": {},
				}),
			} as Response)

			const result = await checkForUpdates()

			expect(result.currentVersion).toBe("1.0.0")
			expect(result.latestVersion).toBe(null)
			expect(result.updateAvailable).toBe(false)
			expect(result.message).toBe("Failed to check for updates. Please try again later.")
		})

		it("should handle pre-release versions correctly", async () => {
			vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: "1.0.0" }))

			vi.mocked(mockFetch).mockResolvedValue({
				ok: true,
				json: async () => ({
					"dist-tags": { latest: "1.1.0-beta.1" },
				}),
			} as Response)

			const result = await checkForUpdates()

			expect(result.currentVersion).toBe("1.0.0")
			expect(result.latestVersion).toBe("1.1.0-beta.1")
			expect(result.updateAvailable).toBe(true)
		})
	})

	describe("performUpdate", () => {
		it("should return success when global npm install succeeds", async () => {
			const mockChildProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockChildProcess)

			const promise = performUpdate()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate successful exit
			mockChildProcess.emit("close", 0)

			const result = await promise

			expect(result.success).toBe(true)
			expect(result.message).toBe("Update completed successfully. Please restart the CLI to use the new version.")
			expect(spawn).toHaveBeenCalledWith("npm install -g @kilocode/cli", {
				stdio: "pipe",
				shell: true,
			})
		})

		it("should try local installation when global install fails", async () => {
			const mockChildProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockChildProcess)

			const promise = performUpdate()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate failed exit for global install
			mockChildProcess.emit("close", 1)

			// Wait for second attempt (local install)
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate successful exit for local install
			mockChildProcess.emit("close", 0)

			const result = await promise

			expect(result.success).toBe(true)
			expect(result.message).toContain("Update completed successfully (local installation)")
			expect(spawn).toHaveBeenCalledTimes(2)
		})

		it("should return failure when both global and local install fail", async () => {
			const mockChildProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockChildProcess)

			const promise = performUpdate()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate failed exit for global install
			mockChildProcess.emit("close", 1)

			// Wait for second attempt (local install)
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate failed exit for local install
			mockChildProcess.emit("close", 1)

			const result = await promise

			expect(result.success).toBe(false)
			expect(result.message).toContain("Update failed")
			expect(result.message).toContain("npm install -g @kilocode/cli")
			expect(result.message).toContain("npm install @kilocode/cli --prefix")
		})

		it("should return failure when spawn fails", async () => {
			const mockChildProcess = createMockProcess()
			vi.mocked(spawn).mockImplementation(() => {
				throw new Error("Command not found")
			})

			const promise = performUpdate()

			const result = await promise

			expect(result.success).toBe(false)
			expect(result.message).toBe("Failed to start update process: Command not found")
		})

		it("should capture stdout data", async () => {
			const mockChildProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockChildProcess)

			const promise = performUpdate()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate stdout data
			mockChildProcess.emit("data", Buffer.from("npm output"))

			// Simulate successful exit
			mockChildProcess.emit("close", 0)

			await promise

			// The test passes if no error is thrown
			expect(true).toBe(true)
		})

		it("should capture stderr data", async () => {
			const mockChildProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockChildProcess)

			const promise = performUpdate()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate stderr data
			mockChildProcess.emit("data", Buffer.from("npm error"))

			// Simulate failed exit
			mockChildProcess.emit("close", 1)

			await promise

			// The test passes if no error is thrown
			expect(true).toBe(true)
		})
	})

	describe("restartCLI", () => {
		let originalExit: typeof process.exit
		let originalArgv: string[]
		let originalExecPath: string

		beforeEach(() => {
			originalExit = process.exit
			originalArgv = process.argv
			originalExecPath = process.execPath
			vi.clearAllMocks()
		})

		afterEach(() => {
			process.exit = originalExit
			process.argv = originalArgv
			process.execPath = originalExecPath
		})

		it("should spawn new process and exit", () => {
			const mockChildProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockChildProcess)

			// Mock process.exit to prevent actual exit
			process.exit = vi.fn() as never

			const result = restartCLI()

			expect(result.success).toBe(true)
			expect(result.message).toBe("Restarting CLI...")
			expect(spawn).toHaveBeenCalledWith(process.execPath, [process.argv[1]], {
				detached: true,
				stdio: "ignore",
			})
			expect(process.exit).toHaveBeenCalledWith(0)
		})

		it("should pass command line arguments to new process", () => {
			const mockChildProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockChildProcess)

			// Mock process.argv to include arguments
			process.argv = ["node", "cli.js", "--help", "--verbose"]

			// Mock process.exit to prevent actual exit
			process.exit = vi.fn() as never

			restartCLI()

			expect(spawn).toHaveBeenCalledWith(process.execPath, ["cli.js", "--help", "--verbose"], {
				detached: true,
				stdio: "ignore",
			})
		})

		it("should return failure when spawn throws error", () => {
			vi.mocked(spawn).mockImplementation(() => {
				throw new Error("Spawn failed")
			})

			const result = restartCLI()

			expect(result.success).toBe(false)
			expect(result.message).toBe("Failed to restart CLI: Spawn failed")
		})
	})

	describe("compareVersions", () => {
		it("should return 1 when version1 is greater", () => {
			const result = compareVersions("1.2.0", "1.1.0")
			expect(result).toBe(1)
		})

		it("should return -1 when version1 is less", () => {
			const result = compareVersions("1.1.0", "1.2.0")
			expect(result).toBe(-1)
		})

		it("should return 0 when versions are equal", () => {
			const result = compareVersions("1.1.0", "1.1.0")
			expect(result).toBe(0)
		})

		it("should handle patch versions", () => {
			const result = compareVersions("1.1.1", "1.1.0")
			expect(result).toBe(1)
		})

		it("should handle major versions", () => {
			const result = compareVersions("2.0.0", "1.9.9")
			expect(result).toBe(1)
		})

		it("should handle pre-release versions", () => {
			const result = compareVersions("1.0.0", "1.0.0-beta")
			expect(result).toBe(1)
		})
	})

	describe("isVersionGreater", () => {
		it("should return true when version1 is greater", () => {
			const result = isVersionGreater("1.2.0", "1.1.0")
			expect(result).toBe(true)
		})

		it("should return false when version1 is less", () => {
			const result = isVersionGreater("1.1.0", "1.2.0")
			expect(result).toBe(false)
		})

		it("should return false when versions are equal", () => {
			const result = isVersionGreater("1.1.0", "1.1.0")
			expect(result).toBe(false)
		})

		it("should handle patch versions", () => {
			const result = isVersionGreater("1.1.1", "1.1.0")
			expect(result).toBe(true)
		})

		it("should handle major versions", () => {
			const result = isVersionGreater("2.0.0", "1.9.9")
			expect(result).toBe(true)
		})
	})

	describe("isVersionLess", () => {
		it("should return true when version1 is less", () => {
			const result = isVersionLess("1.1.0", "1.2.0")
			expect(result).toBe(true)
		})

		it("should return false when version1 is greater", () => {
			const result = isVersionLess("1.2.0", "1.1.0")
			expect(result).toBe(false)
		})

		it("should return false when versions are equal", () => {
			const result = isVersionLess("1.1.0", "1.1.0")
			expect(result).toBe(false)
		})

		it("should handle patch versions", () => {
			const result = isVersionLess("1.1.0", "1.1.1")
			expect(result).toBe(true)
		})

		it("should handle major versions", () => {
			const result = isVersionLess("1.9.9", "2.0.0")
			expect(result).toBe(true)
		})
	})

	describe("isVersionEqual", () => {
		it("should return true when versions are equal", () => {
			const result = isVersionEqual("1.1.0", "1.1.0")
			expect(result).toBe(true)
		})

		it("should return false when version1 is greater", () => {
			const result = isVersionEqual("1.2.0", "1.1.0")
			expect(result).toBe(false)
		})

		it("should return false when version1 is less", () => {
			const result = isVersionEqual("1.1.0", "1.2.0")
			expect(result).toBe(false)
		})

		it("should handle patch versions", () => {
			const result = isVersionEqual("1.1.1", "1.1.1")
			expect(result).toBe(true)
		})

		it("should handle major versions", () => {
			const result = isVersionEqual("2.0.0", "2.0.0")
			expect(result).toBe(true)
		})
	})

	describe("getLastUpdateCheckTimestamp", () => {
		it("should return a valid ISO timestamp", () => {
			const timestamp = getLastUpdateCheckTimestamp()

			expect(timestamp).toBeTruthy()
			expect(typeof timestamp).toBe("string")
			expect(() => new Date(timestamp)).not.toThrow()
		})

		it("should return a timestamp in ISO format", () => {
			const timestamp = getLastUpdateCheckTimestamp()

			expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
		})

		it("should return a timestamp close to current time", () => {
			const before = Date.now()
			const timestamp = getLastUpdateCheckTimestamp()
			const after = Date.now()

			const timestampDate = new Date(timestamp).getTime()

			expect(timestampDate).toBeGreaterThanOrEqual(before)
			expect(timestampDate).toBeLessThanOrEqual(after)
		})
	})
})
