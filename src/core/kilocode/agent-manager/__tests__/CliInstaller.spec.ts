import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

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
