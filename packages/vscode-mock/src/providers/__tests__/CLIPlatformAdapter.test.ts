import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { CLIPlatformAdapter } from "../CLIPlatformAdapter"
import { LogLevel, PlatformFeatures } from "../../types"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

describe("CLIPlatformAdapter", () => {
	let adapter: CLIPlatformAdapter
	let tempDir: string

	beforeEach(async () => {
		// Create a temporary directory for testing
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-adapter-test-"))

		adapter = new CLIPlatformAdapter({
			interactive: false, // Non-interactive for testing
			configName: "test-kilo",
			logLevel: LogLevel.Debug,
		})

		await adapter.initialize()
	})

	afterEach(async () => {
		await adapter.dispose()

		// Clean up temp directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("initialization", () => {
		it("should initialize successfully", () => {
			expect(adapter.isInitialized()).toBe(true)
			expect(adapter.isDisposed()).toBe(false)
		})

		it("should have correct platform name", () => {
			expect(adapter.name).toBe("cli")
		})

		it("should provide platform info", () => {
			const info = adapter.getPlatformInfo()
			expect(info.name).toBe("cli")
			expect(info.platform).toBe(process.platform)
			expect(info.nodeVersion).toBe(process.version)
		})
	})

	describe("feature support", () => {
		it("should support file watching", () => {
			expect(adapter.supportsFeature(PlatformFeatures.FileWatching)).toBe(true)
		})

		it("should support process spawning", () => {
			expect(adapter.supportsFeature(PlatformFeatures.ProcessSpawning)).toBe(true)
		})

		it("should support progress reporting", () => {
			expect(adapter.supportsFeature(PlatformFeatures.ProgressReporting)).toBe(true)
		})

		it("should not support interactive input in non-interactive mode", () => {
			expect(adapter.supportsFeature(PlatformFeatures.InteractiveInput)).toBe(false)
		})
	})

	describe("file system operations", () => {
		it("should read and write files", async () => {
			const testFile = path.join(tempDir, "test.txt")
			const content = "Hello, World!"

			await adapter.writeFile(testFile, content)
			expect(await adapter.exists(testFile)).toBe(true)

			const readContent = await adapter.readFile(testFile)
			expect(readContent).toBe(content)
		})

		it("should handle file operations through fileSystem provider", async () => {
			const testFile = path.join(tempDir, "fs-test.txt")
			const content = "FileSystem test"

			await adapter.fileSystem.writeFile(testFile, content)
			const stats = await adapter.fileSystem.stat(testFile)

			expect(stats.isFile).toBe(true)
			expect(stats.size).toBeGreaterThan(0)
		})
	})

	describe("process execution", () => {
		it("should execute simple commands", async () => {
			const result = await adapter.executeCommand("echo hello")

			expect(result.success).toBe(true)
			expect(result.exitCode).toBe(0)
			expect(result.stdout.trim()).toBe("hello")
		})

		it("should handle command failures", async () => {
			const result = await adapter.executeCommand("nonexistent-command-12345")

			expect(result.success).toBe(false)
			expect(result.exitCode).not.toBe(0)
		})
	})

	describe("configuration management", () => {
		it("should get and set configuration values", async () => {
			const key = "test.setting"
			const value = "test-value"

			await adapter.setConfig(key, value)
			const retrieved = adapter.getConfig(key)

			expect(retrieved).toBe(value)
		})

		it("should return default values for missing config", () => {
			const defaultValue = "default"
			const retrieved = adapter.getConfig("nonexistent.key", defaultValue)

			expect(retrieved).toBe(defaultValue)
		})
	})

	describe("logging", () => {
		it("should log messages at different levels", () => {
			// These should not throw
			adapter.logInfo("Info message")
			adapter.logDebug("Debug message")
			adapter.logWarn("Warning message")
			adapter.logError("Error message")
		})

		it("should create child loggers", () => {
			const childLogger = adapter.createChildLogger({ component: "test" })

			expect(childLogger).toBeDefined()
			// Child logger should not throw when logging
			childLogger.info("Child logger test")
		})
	})

	describe("user interface", () => {
		it("should handle non-interactive mode", () => {
			expect(adapter.userInterface.isInteractive()).toBe(false)
		})

		it("should support progress reporting", async () => {
			let progressCalled = false

			const result = await adapter.showProgress("Test operation", async (progress) => {
				progress.report("Starting...")
				progressCalled = true
				return "completed"
			})

			expect(result).toBe("completed")
			expect(progressCalled).toBe(true)
		})
	})

	describe("working directory", () => {
		it("should get and set working directory", async () => {
			const originalCwd = adapter.getCwd()

			await adapter.setCwd(tempDir)
			expect(adapter.getCwd()).toBe(tempDir)

			// Restore original directory
			await adapter.setCwd(originalCwd)
		})
	})

	describe("disposal", () => {
		it("should dispose cleanly", async () => {
			const testAdapter = new CLIPlatformAdapter()
			await testAdapter.initialize()

			expect(testAdapter.isInitialized()).toBe(true)

			await testAdapter.dispose()

			expect(testAdapter.isDisposed()).toBe(true)
		})
	})
})
