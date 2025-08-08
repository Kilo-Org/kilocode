import { describe, it, expect } from "vitest"
import { CLIFileSystemProvider } from "../CLIFileSystemProvider"
import { CLIUserInterfaceProvider } from "../CLIUserInterfaceProvider"
import { CLIConfigurationProvider } from "../CLIConfigurationProvider"
import { CLIProcessExecutorProvider } from "../CLIProcessExecutorProvider"
import { CLILoggerProvider } from "../CLILoggerProvider"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

describe("CLI Providers Basic Functionality", () => {
	describe("CLIFileSystemProvider", () => {
		it("should create instance without errors", () => {
			const provider = new CLIFileSystemProvider()
			expect(provider).toBeDefined()
		})

		it("should handle basic file operations", async () => {
			const provider = new CLIFileSystemProvider()
			const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-test-"))
			const testFile = path.join(tempDir, "test.txt")
			const content = "Hello, World!"

			try {
				// Test write and read
				await provider.writeFile(testFile, content)
				expect(await provider.exists(testFile)).toBe(true)

				const readContent = await provider.readFile(testFile)
				expect(readContent).toBe(content)

				// Test stats
				const stats = await provider.stat(testFile)
				expect(stats.isFile).toBe(true)
				expect(stats.size).toBeGreaterThan(0)

				// Test path operations
				expect(provider.basename(testFile)).toBe("test.txt")
				expect(provider.extname(testFile)).toBe(".txt")
				expect(provider.dirname(testFile)).toBe(tempDir)
			} finally {
				// Cleanup
				try {
					await fs.rm(tempDir, { recursive: true, force: true })
				} catch {
					// Ignore cleanup errors
				}
			}
		})
	})

	describe("CLIUserInterfaceProvider", () => {
		it("should create instance without errors", () => {
			const provider = new CLIUserInterfaceProvider(false) // Non-interactive
			expect(provider).toBeDefined()
		})

		it("should handle non-interactive mode", () => {
			const provider = new CLIUserInterfaceProvider(false)
			expect(provider.isInteractive()).toBe(false)
		})

		it("should support rich formatting detection", () => {
			const provider = new CLIUserInterfaceProvider(false)
			const supportsRich = provider.supportsRichFormatting()
			expect(typeof supportsRich).toBe("boolean")
		})

		it("should handle progress operations", async () => {
			const provider = new CLIUserInterfaceProvider(false)

			const result = await provider.showProgress("Test operation", async (progress) => {
				progress.report("Starting...")
				progress.report(50, "Halfway done")
				return "completed"
			})

			expect(result).toBe("completed")
		})
	})

	describe("CLIConfigurationProvider", () => {
		it("should create instance without errors", () => {
			const provider = new CLIConfigurationProvider("test")
			expect(provider).toBeDefined()
		})

		it("should handle basic configuration operations", async () => {
			const provider = new CLIConfigurationProvider("test")
			await provider.initialize()

			// Test get/set
			await provider.set("test.key", "test-value")
			expect(provider.get("test.key")).toBe("test-value")
			expect(provider.has("test.key")).toBe(true)

			// Test default values
			expect(provider.get("nonexistent.key", "default")).toBe("default")
			expect(provider.has("nonexistent.key")).toBe(false)

			// Test environment variables
			const envValue = provider.getEnv("PATH")
			expect(typeof envValue).toBe("string")
		})
	})

	describe("CLIProcessExecutorProvider", () => {
		it("should create instance without errors", () => {
			const provider = new CLIProcessExecutorProvider()
			expect(provider).toBeDefined()
		})

		it("should handle basic command execution", async () => {
			const provider = new CLIProcessExecutorProvider()

			// Test simple echo command
			const result = await provider.execute("echo hello")
			expect(result.success).toBe(true)
			expect(result.exitCode).toBe(0)
			expect(result.stdout.trim()).toBe("hello")
		})

		it("should handle working directory operations", async () => {
			const provider = new CLIProcessExecutorProvider()
			const originalCwd = provider.getCwd()

			expect(typeof originalCwd).toBe("string")
			expect(originalCwd.length).toBeGreaterThan(0)
		})

		it("should handle environment variables", () => {
			const provider = new CLIProcessExecutorProvider()
			const env = provider.getEnv()

			expect(typeof env).toBe("object")
			expect(Object.keys(env).length).toBeGreaterThan(0)
		})
	})

	describe("CLILoggerProvider", () => {
		it("should create instance without errors", () => {
			const provider = new CLILoggerProvider()
			expect(provider).toBeDefined()
		})

		it("should handle basic logging operations", () => {
			const provider = new CLILoggerProvider()

			// These should not throw
			provider.info("Info message")
			provider.debug("Debug message")
			provider.warn("Warning message")
			provider.error("Error message")
		})

		it("should handle log levels", () => {
			const provider = new CLILoggerProvider()

			// Test level operations
			const currentLevel = provider.getLevel()
			expect(typeof currentLevel).toBe("number")

			provider.setLevel(currentLevel)
			expect(provider.getLevel()).toBe(currentLevel)
		})

		it("should create child loggers", () => {
			const provider = new CLILoggerProvider()
			const childLogger = provider.child({ component: "test" })

			expect(childLogger).toBeDefined()
			// Child logger should not throw when logging
			childLogger.info("Child logger test")
		})

		it("should handle timing operations", () => {
			const provider = new CLILoggerProvider()

			provider.time("test-timer")
			provider.timeEnd("test-timer")

			// Should not throw
		})
	})
})
