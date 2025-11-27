import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest"
import { spawn, type ChildProcess } from "child_process"
import { platform } from "os"
import openConfigFile from "../openConfig.js"
import * as configModule from "../index.js"
import { EventEmitter } from "events"

// Mock dependencies
vi.mock("child_process")
vi.mock("os")
vi.mock("../index.js", () => ({
	ensureConfigDir: vi.fn(),
	configExists: vi.fn(),
	saveConfig: vi.fn(),
	getConfigPath: vi.fn(),
	DEFAULT_CONFIG: {},
}))

describe("openConfigFile", () => {
	const mockConfigPath = "/home/user/.config/kilocode/config.json"
	let originalEnv: NodeJS.ProcessEnv
	let consoleLogSpy: MockInstance
	let consoleErrorSpy: MockInstance
	let processExitSpy: MockInstance

	beforeEach(() => {
		vi.clearAllMocks()
		originalEnv = { ...process.env }

		// Setup default mocks
		vi.mocked(configModule.ensureConfigDir).mockResolvedValue(undefined)
		vi.mocked(configModule.configExists).mockResolvedValue(true)
		vi.mocked(configModule.getConfigPath).mockResolvedValue(mockConfigPath)

		// Mock console methods
		consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never)
	})

	afterEach(() => {
		process.env = originalEnv
		vi.restoreAllMocks()
	})

	const createMockProcess = (): ChildProcess => {
		const mockProcess = new EventEmitter() as unknown as ChildProcess
		Object.defineProperty(mockProcess, "stdio", {
			value: { inherit: true },
			writable: true,
		})
		return mockProcess
	}

	describe("Linux platform", () => {
		beforeEach(() => {
			vi.mocked(platform).mockReturnValue("linux")
			delete process.env.EDITOR
			delete process.env.VISUAL
		})

		it("should use xdg-open by default on Linux", async () => {
			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			expect(spawn).toHaveBeenCalledWith("xdg-open", [mockConfigPath], {
				stdio: "inherit",
			})

			// Simulate successful exit
			mockProcess.emit("exit", 0)

			await promise
		})

		it("should fallback to nano when xdg-open fails on Linux", async () => {
			const xdgProcess = createMockProcess()
			const nanoProcess = createMockProcess()

			vi.mocked(spawn).mockReturnValueOnce(xdgProcess).mockReturnValueOnce(nanoProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate xdg-open error
			const error = new Error("xdg-open: command not found")
			xdgProcess.emit("error", error)

			// Wait for fallback to be triggered
			await new Promise((resolve) => setImmediate(resolve))

			expect(consoleLogSpy).toHaveBeenCalledWith("xdg-open failed, trying nano as fallback...")
			expect(spawn).toHaveBeenNthCalledWith(2, "nano", [mockConfigPath], {
				stdio: "inherit",
			})

			// Simulate nano successful exit
			nanoProcess.emit("exit", 0)

			await promise
		})

		it("should report error when both xdg-open and nano fail", async () => {
			const xdgProcess = createMockProcess()
			const nanoProcess = createMockProcess()

			vi.mocked(spawn).mockReturnValueOnce(xdgProcess).mockReturnValueOnce(nanoProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate xdg-open error
			const xdgError = new Error("xdg-open: command not found")
			xdgProcess.emit("error", xdgError)

			// Wait for fallback to be triggered
			await new Promise((resolve) => setImmediate(resolve))

			// Simulate nano error
			const nanoError = new Error("nano: command not found")
			nanoProcess.emit("error", nanoError)

			await expect(promise).rejects.toThrow()

			expect(consoleErrorSpy).toHaveBeenCalledWith(`Failed to open editor: ${xdgError.message}`)
			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Nano fallback also failed"))
			expect(processExitSpy).not.toHaveBeenCalled()
		})

		it("should not fallback to nano when EDITOR is set", async () => {
			process.env.EDITOR = "vim"

			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			expect(spawn).toHaveBeenCalledWith("vim", [mockConfigPath], {
				stdio: "inherit",
			})

			// Simulate error with custom editor
			const error = new Error("vim: command not found")
			mockProcess.emit("error", error)

			await expect(promise).rejects.toThrow()

			expect(spawn).toHaveBeenCalledTimes(1)
			expect(consoleErrorSpy).toHaveBeenCalledWith(`Failed to open editor: ${error.message}`)
			expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Nano fallback"))
			expect(processExitSpy).not.toHaveBeenCalled()
		})
	})

	describe("macOS platform", () => {
		beforeEach(() => {
			vi.mocked(platform).mockReturnValue("darwin")
			delete process.env.EDITOR
			delete process.env.VISUAL
		})

		it("should use open with -t flag on macOS", async () => {
			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			expect(spawn).toHaveBeenCalledWith("open", ["-t", mockConfigPath], {
				stdio: "inherit",
			})

			mockProcess.emit("exit", 0)
			await promise
		})

		it("should not fallback to nano on macOS", async () => {
			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			const error = new Error("open: command not found")
			mockProcess.emit("error", error)

			await expect(promise).rejects.toThrow()

			expect(spawn).toHaveBeenCalledTimes(1)
			expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("nano"))
			expect(processExitSpy).not.toHaveBeenCalled()
		})
	})

	describe("Windows platform", () => {
		beforeEach(() => {
			vi.mocked(platform).mockReturnValue("win32")
			delete process.env.EDITOR
			delete process.env.VISUAL
		})

		it("should use cmd /c start on Windows", async () => {
			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			expect(spawn).toHaveBeenCalledWith("cmd", ["/c", "start", "", mockConfigPath], {
				stdio: "inherit",
			})

			mockProcess.emit("exit", 0)
			await promise
		})

		it("should not fallback to nano on Windows", async () => {
			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			const error = new Error("cmd: command not found")
			mockProcess.emit("error", error)

			await expect(promise).rejects.toThrow()

			expect(spawn).toHaveBeenCalledTimes(1)
			expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("nano"))
			expect(processExitSpy).not.toHaveBeenCalled()
		})
	})

	describe("Config file creation", () => {
		it("should create default config if it doesn't exist", async () => {
			vi.mocked(platform).mockReturnValue("linux")
			vi.mocked(configModule.configExists).mockResolvedValue(false)

			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			expect(consoleLogSpy).toHaveBeenCalledWith("Config file not found. Creating default configuration...")
			expect(configModule.saveConfig).toHaveBeenCalledWith(configModule.DEFAULT_CONFIG, true)
			expect(consoleLogSpy).toHaveBeenCalledWith("Default configuration created.")

			mockProcess.emit("exit", 0)
			await promise
		})
	})

	describe("EDITOR environment variable", () => {
		beforeEach(() => {
			vi.mocked(platform).mockReturnValue("linux")
		})

		it("should use EDITOR environment variable when set", async () => {
			process.env.EDITOR = "emacs"

			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			expect(spawn).toHaveBeenCalledWith("emacs", [mockConfigPath], {
				stdio: "inherit",
			})

			mockProcess.emit("exit", 0)
			await promise
		})

		it("should use VISUAL environment variable when set", async () => {
			delete process.env.EDITOR
			delete process.env.VISUAL
			process.env.VISUAL = "code"

			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			expect(spawn).toHaveBeenCalledWith("code", [mockConfigPath], {
				stdio: "inherit",
			})

			mockProcess.emit("exit", 0)
			await promise
		})

		it("should prefer EDITOR over VISUAL", async () => {
			process.env.EDITOR = "vim"
			process.env.VISUAL = "code"

			const mockProcess = createMockProcess()
			vi.mocked(spawn).mockReturnValue(mockProcess)

			const promise = openConfigFile()

			// Wait for async setup to complete
			await new Promise((resolve) => setImmediate(resolve))

			expect(spawn).toHaveBeenCalledWith("vim", [mockConfigPath], {
				stdio: "inherit",
			})

			mockProcess.emit("exit", 0)
			await promise
		})
	})
})
