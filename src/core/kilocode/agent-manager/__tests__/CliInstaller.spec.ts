import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import * as os from "node:os"
import * as path from "node:path"

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

	describe("getLocalCliDir", () => {
		it("returns the local CLI installation directory", async () => {
			const { getLocalCliDir } = await import("../CliInstaller")
			const dir = getLocalCliDir()
			const expectedDir = path.join(os.homedir(), ".kilocode", "cli", "pkg")
			expect(dir).toBe(expectedDir)
		})
	})

	describe("getLocalCliBinDir", () => {
		it("returns the local CLI bin directory", async () => {
			const { getLocalCliBinDir } = await import("../CliInstaller")
			const binDir = getLocalCliBinDir()
			const expectedDir = path.join(os.homedir(), ".kilocode", "cli", "pkg", "node_modules", ".bin")
			expect(binDir).toBe(expectedDir)
		})
	})

	describe("getLocalCliPath", () => {
		it("returns the local CLI executable path on Unix", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "linux" })

			const { getLocalCliPath } = await import("../CliInstaller")
			const cliPath = getLocalCliPath()
			const expectedPath = path.join(os.homedir(), ".kilocode", "cli", "pkg", "node_modules", ".bin", "kilocode")
			expect(cliPath).toBe(expectedPath)

			Object.defineProperty(process, "platform", { value: originalPlatform })
		})

		it("returns the local CLI executable path with .cmd extension on Windows", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "win32" })

			vi.resetModules()
			const { getLocalCliPath } = await import("../CliInstaller")
			const cliPath = getLocalCliPath()
			const expectedPath = path.join(
				os.homedir(),
				".kilocode",
				"cli",
				"pkg",
				"node_modules",
				".bin",
				"kilocode.cmd",
			)
			expect(cliPath).toBe(expectedPath)

			Object.defineProperty(process, "platform", { value: originalPlatform })
		})
	})

	describe("getLocalCliInstallCommand", () => {
		it("returns the npm install command for local CLI installation", async () => {
			const { getLocalCliInstallCommand } = await import("../CliInstaller")
			const command = getLocalCliInstallCommand()
			const expectedDir = path.join(os.homedir(), ".kilocode", "cli", "pkg")
			expect(command).toBe(`npm install @kilocode/cli --prefix ${expectedDir}`)
		})
	})

	describe("findNodeExecutable", () => {
		it("finds node in PATH", async () => {
			vi.doMock("node:child_process", () => ({
				execSync: vi.fn().mockReturnValue("/usr/local/bin/node\n"),
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
			}))

			const { canInstallCli } = await import("../CliInstaller")
			const result = canInstallCli()

			expect(result).toBe(false)
		})
	})
})
