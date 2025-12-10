import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"

describe("CliInstaller", () => {
	beforeEach(() => {
		vi.resetModules()
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("getCliInstallCommand", () => {
		it("returns the npm install command for the CLI", async () => {
			const { getCliInstallCommand } = await import("../CliInstaller")
			const command = getCliInstallCommand()
			expect(command).toBe("npm install -g @kilocode/cli")
		})
	})

	describe("findNodeExecutable", () => {
		it("finds node in PATH", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/node\n"),
				spawn: vi.fn(),
			}))

			const { findNodeExecutable } = await import("../CliInstaller")
			const result = findNodeExecutable()

			expect(result).toBe("/usr/local/bin/node")
		})

		it("returns null when node is not found", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockImplementation(() => {
					throw new Error("not found")
				}),
				spawn: vi.fn(),
			}))

			const { findNodeExecutable } = await import("../CliInstaller")
			const logMock = vi.fn()
			const result = findNodeExecutable(logMock)

			expect(result).toBeNull()
			expect(logMock).toHaveBeenCalledWith("Node.js not found in PATH")
		})

		it("logs when node is found", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/node"),
				spawn: vi.fn(),
			}))

			const { findNodeExecutable } = await import("../CliInstaller")
			const logMock = vi.fn()
			findNodeExecutable(logMock)

			expect(logMock).toHaveBeenCalledWith("Found Node.js at: /usr/local/bin/node")
		})
	})

	describe("findNpmExecutable", () => {
		it("finds npm in PATH", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/npm\n"),
				spawn: vi.fn(),
			}))

			const { findNpmExecutable } = await import("../CliInstaller")
			const result = findNpmExecutable()

			expect(result).toBe("/usr/local/bin/npm")
		})

		it("returns null when npm is not found", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockImplementation(() => {
					throw new Error("not found")
				}),
				spawn: vi.fn(),
			}))

			const { findNpmExecutable } = await import("../CliInstaller")
			const logMock = vi.fn()
			const result = findNpmExecutable(logMock)

			expect(result).toBeNull()
			expect(logMock).toHaveBeenCalledWith("npm not found in PATH")
		})
	})

	describe("canInstallCli", () => {
		it("returns true when both node and npm are available", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/node"),
				spawn: vi.fn(),
			}))

			const { canInstallCli } = await import("../CliInstaller")
			const result = canInstallCli()

			expect(result).toBe(true)
		})

		it("returns false when node is not available", async () => {
			let callCount = 0
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockImplementation((cmd: string) => {
					callCount++
					// First call for node fails
					if (callCount === 1 || cmd.includes("node")) {
						throw new Error("not found")
					}
					return "/usr/local/bin/npm"
				}),
				spawn: vi.fn(),
			}))

			const { canInstallCli } = await import("../CliInstaller")
			const result = canInstallCli()

			expect(result).toBe(false)
		})
	})

	describe("installOrUpdateCli", () => {
		it("returns error when npm is not available", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockImplementation(() => {
					throw new Error("not found")
				}),
				spawn: vi.fn(),
			}))

			const { installOrUpdateCli } = await import("../CliInstaller")
			const result = await installOrUpdateCli()

			expect(result.success).toBe(false)
			expect(result.error).toContain("npm is not available")
		})

		it("spawns npm install command when npm is available", async () => {
			const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
			const mockStdout = new EventEmitter()
			const mockStderr = new EventEmitter()

			Object.assign(mockProcess, {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: null,
				pid: 12345,
			})

			const spawnMock = vi.fn().mockReturnValue(mockProcess)

			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/npm"),
				spawn: spawnMock,
			}))

			vi.doMock("../../../../utils/fs", () => ({
				fileExistsAtPath: vi.fn().mockResolvedValue(false),
			}))

			const { installOrUpdateCli } = await import("../CliInstaller")
			const logMock = vi.fn()

			// Start the install (don't await yet)
			const installPromise = installOrUpdateCli(logMock)

			// Simulate successful npm install
			await new Promise((resolve) => setTimeout(resolve, 10))
			mockProcess.emit("exit", 0)

			const result = await installPromise

			expect(spawnMock).toHaveBeenCalledWith("npm", ["install", "-g", "@kilocode/cli"], expect.any(Object))
			// Result depends on whether CLI can be found after install
			expect(result).toBeDefined()
		})

		it("reports progress when installation completes", async () => {
			const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
			const mockStdout = new EventEmitter()
			const mockStderr = new EventEmitter()

			Object.assign(mockProcess, {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: null,
				pid: 12345,
			})

			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/npm"),
				spawn: vi.fn().mockReturnValue(mockProcess),
			}))

			vi.doMock("../../../../utils/fs", () => ({
				fileExistsAtPath: vi.fn().mockResolvedValue(false),
			}))

			const { installOrUpdateCli } = await import("../CliInstaller")
			const progressMock = vi.fn()

			// Start the install
			const installPromise = installOrUpdateCli(undefined, progressMock)

			// Simulate successful install
			await new Promise((resolve) => setTimeout(resolve, 10))
			mockProcess.emit("exit", 0)
			await installPromise

			// Verify progress is reported on completion
			expect(progressMock).toHaveBeenCalledWith("Done!")
		})

		it("returns error when npm install fails", async () => {
			const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
			const mockStdout = new EventEmitter()
			const mockStderr = new EventEmitter()

			Object.assign(mockProcess, {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: null,
				pid: 12345,
			})

			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/npm"),
				spawn: vi.fn().mockReturnValue(mockProcess),
			}))

			const { installOrUpdateCli } = await import("../CliInstaller")

			const installPromise = installOrUpdateCli()

			// Simulate failed npm install
			await new Promise((resolve) => setTimeout(resolve, 10))
			mockStderr.emit("data", "npm ERR! code EACCES")
			mockProcess.emit("exit", 1)

			const result = await installPromise

			expect(result.success).toBe(false)
			expect(result.error).toContain("npm ERR! code EACCES")
			expect(result.suggestTerminal).toBe(true) // EACCES is a permission error
		})

		it("sets suggestTerminal for permission denied errors", async () => {
			const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
			const mockStdout = new EventEmitter()
			const mockStderr = new EventEmitter()

			Object.assign(mockProcess, {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: null,
				pid: 12345,
			})

			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/npm"),
				spawn: vi.fn().mockReturnValue(mockProcess),
			}))

			const { installOrUpdateCli } = await import("../CliInstaller")

			const installPromise = installOrUpdateCli()

			await new Promise((resolve) => setTimeout(resolve, 10))
			mockStderr.emit("data", "Error: EPERM: operation not permitted")
			mockProcess.emit("exit", 1)

			const result = await installPromise

			expect(result.success).toBe(false)
			expect(result.suggestTerminal).toBe(true)
		})

		it("does not set suggestTerminal for non-permission errors", async () => {
			const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
			const mockStdout = new EventEmitter()
			const mockStderr = new EventEmitter()

			Object.assign(mockProcess, {
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: null,
				pid: 12345,
			})

			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/npm"),
				spawn: vi.fn().mockReturnValue(mockProcess),
			}))

			const { installOrUpdateCli } = await import("../CliInstaller")

			const installPromise = installOrUpdateCli()

			await new Promise((resolve) => setTimeout(resolve, 10))
			mockStderr.emit("data", "npm ERR! 404 Not Found")
			mockProcess.emit("exit", 1)

			const result = await installPromise

			expect(result.success).toBe(false)
			expect(result.suggestTerminal).toBeFalsy()
		})

		it("handles spawn error gracefully", async () => {
			const mockProcess = new EventEmitter() as ChildProcess & EventEmitter
			Object.assign(mockProcess, {
				stdout: null,
				stderr: null,
				stdin: null,
			})

			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/npm"),
				spawn: vi.fn().mockReturnValue(mockProcess),
			}))

			const { installOrUpdateCli } = await import("../CliInstaller")

			const installPromise = installOrUpdateCli()

			// Simulate spawn error
			await new Promise((resolve) => setTimeout(resolve, 10))
			mockProcess.emit("error", new Error("ENOENT"))

			const result = await installPromise

			expect(result.success).toBe(false)
			expect(result.error).toContain("Failed to run npm")
		})
	})

	describe("getNpmGlobalBinDir", () => {
		it("returns npm prefix bin directory", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockImplementation((cmd: string) => {
					if (cmd === "npm config get prefix") {
						return "/usr/local"
					}
					return ""
				}),
				spawn: vi.fn(),
			}))

			const { getNpmGlobalBinDir } = await import("../CliInstaller")
			const result = getNpmGlobalBinDir()

			expect(result).toBe("/usr/local/bin")
		})

		it("returns null on error", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockImplementation((cmd: string) => {
					if (cmd === "npm config get prefix") {
						throw new Error("npm not available")
					}
					return "/usr/local/bin/node"
				}),
				spawn: vi.fn(),
			}))

			const { getNpmGlobalBinDir } = await import("../CliInstaller")
			const logMock = vi.fn()
			const result = getNpmGlobalBinDir(logMock)

			expect(result).toBeNull()
			expect(logMock).toHaveBeenCalledWith(expect.stringContaining("Failed to get npm global bin directory"))
		})
	})
})
