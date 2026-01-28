/**
 * Tests for the update command
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { detectInstallMethod, fetchLatestVersion, checkForUpdates, executeUpdate } from "../update.js"
import * as fs from "fs"
import * as childProcess from "child_process"
import { EventEmitter } from "events"
import packageJson from "package-json"

// Mock fs
vi.mock("fs", () => ({
	existsSync: vi.fn(),
	realpathSync: vi.fn((p: string) => p), // Default: return path as-is
}))

// Mock child_process
vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

// Mock Package
vi.mock("../../constants/package.js", () => ({
	Package: { version: "1.0.0", name: "@kilocode/cli" },
}))

// Mock package-json
vi.mock("package-json")

afterAll(() => {
	vi.unstubAllGlobals()
})

describe("update command", () => {
	const originalArgv1 = process.argv[1]
	const originalCwd = process.cwd

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset argv[1] after each test
		process.argv[1] = originalArgv1
		// Default cwd mock
		process.cwd = () => "/home/user/projects/myapp"
	})

	afterAll(() => {
		process.cwd = originalCwd
	})

	describe("detectInstallMethod", () => {
		it("should detect local node_modules install", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/home/user/projects/myapp/node_modules/.bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("unknown")
			expect(result.canUpdate).toBe(false)
			expect(result.message).toContain("local node_modules")
			expect(result.message).toContain("/home/user/projects/myapp")
		})

		it("should detect local install from @kilocode/cli path", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/home/user/projects/myapp/node_modules/@kilocode/cli/bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("unknown")
			expect(result.canUpdate).toBe(false)
			expect(result.message).toContain("local node_modules")
		})

		it("should detect local install when running from subdirectory", () => {
			// User is in subdirectory but runs local node_modules binary
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.cwd = () => "/home/user/projects/myapp/src/components"
			process.argv[1] = "/home/user/projects/myapp/node_modules/.bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("unknown")
			expect(result.canUpdate).toBe(false)
			expect(result.message).toContain("local node_modules")
		})

		it("should not misdetect global as local when cwd has local @kilocode/cli", () => {
			// Global pnpm install, project also has local @kilocode/cli
			// Original path is global, should detect as global
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.cwd = () => "/home/user/projects/myapp"
			process.argv[1] = "/home/user/.local/share/pnpm/global/5/node_modules/@kilocode/cli/bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("pnpm")
			expect(result.canUpdate).toBe(true)
		})

		it("should detect Yarn PnP cache as local install", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] =
				"/home/user/projects/myapp/.yarn/cache/@kilocode-cli-npm-1.0.0-abc123.zip/node_modules/@kilocode/cli/bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("unknown")
			expect(result.canUpdate).toBe(false)
			expect(result.message).toContain("Yarn PnP")
			expect(result.message).toContain("/home/user/projects/myapp")
		})

		it("should detect Yarn PnP unplugged as local install", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] =
				"/home/user/projects/myapp/.yarn/unplugged/@kilocode-cli-npm-1.0.0/node_modules/@kilocode/cli/bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("unknown")
			expect(result.canUpdate).toBe(false)
			expect(result.message).toContain("Yarn PnP")
		})

		it("should detect Docker environment", () => {
			vi.mocked(fs.existsSync).mockImplementation((path) => path === "/.dockerenv")

			const result = detectInstallMethod()

			expect(result.method).toBe("docker")
			expect(result.canUpdate).toBe(false)
			expect(result.message).toContain("docker pull")
		})

		it("should detect npx execution", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/home/user/.npm/_npx/abc123/node_modules/.bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("npx")
			expect(result.canUpdate).toBe(false)
		})

		it("should detect pnpm global install", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/home/user/.local/share/pnpm/global/5/node_modules/.bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("pnpm")
			expect(result.canUpdate).toBe(true)
			expect(result.updateCommand).toBe("pnpm add -g @kilocode/cli@latest")
		})

		it("should detect pnpm global install on macOS", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/Users/user/Library/pnpm/global/5/node_modules/.bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("pnpm")
			expect(result.canUpdate).toBe(true)
		})

		it("should detect pnpm global install on Windows", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "C:\\Users\\user\\AppData\\Local\\pnpm\\kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("pnpm")
			expect(result.canUpdate).toBe(true)
		})

		it("should detect yarn global install", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/home/user/.config/yarn/global/node_modules/.bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("yarn")
			expect(result.canUpdate).toBe(true)
			expect(result.updateCommand).toBe("yarn global add @kilocode/cli@latest")
		})

		it("should detect yarn global install on Windows", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "C:\\Users\\user\\AppData\\Roaming\\Yarn\\bin\\kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("yarn")
			expect(result.canUpdate).toBe(true)
		})

		it("should detect bun global install", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/home/user/.bun/bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("bun")
			expect(result.canUpdate).toBe(true)
			expect(result.updateCommand).toBe("bun add -g @kilocode/cli@latest")
		})

		it("should return unknown for unrecognized paths", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/some/custom/path/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("unknown")
			expect(result.canUpdate).toBe(false)
			expect(result.message).toContain("Could not detect installation method")
		})

		it("should detect npm global install", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/usr/local/lib/node_modules/@kilocode/cli/bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("npm")
			expect(result.canUpdate).toBe(true)
			expect(result.updateCommand).toBe("npm install -g @kilocode/cli@latest")
		})

		it("should detect npm global install via symlink", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			// Symlink at /usr/local/bin/kilocode resolves to real path
			vi.mocked(fs.realpathSync).mockReturnValue("/usr/local/lib/node_modules/@kilocode/cli/bin/kilocode")
			process.argv[1] = "/usr/local/bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("npm")
			expect(result.canUpdate).toBe(true)

			// Reset mock
			vi.mocked(fs.realpathSync).mockImplementation((p: string) => p as string)
		})

		it("should detect npm global install via nvm", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "/home/user/.nvm/versions/node/v20.0.0/lib/node_modules/@kilocode/cli/bin/kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("npm")
			expect(result.canUpdate).toBe(true)
		})

		it("should detect npm global install on Windows", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)
			process.argv[1] = "C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\@kilocode\\cli\\bin\\kilocode"

			const result = detectInstallMethod()

			expect(result.method).toBe("npm")
			expect(result.canUpdate).toBe(true)
		})
	})

	describe("fetchLatestVersion", () => {
		it("should fetch and return latest version from npm registry", async () => {
			vi.mocked(packageJson).mockResolvedValue({ version: "2.0.0" } as packageJson.AbbreviatedMetadata)

			const version = await fetchLatestVersion()

			expect(version).toBe("2.0.0")
			expect(packageJson).toHaveBeenCalledWith("@kilocode/cli")
		})

		it("should throw error on fetch failure", async () => {
			vi.mocked(packageJson).mockRejectedValue(new Error("Package not found"))

			await expect(fetchLatestVersion()).rejects.toThrow()
		})
	})

	describe("checkForUpdates", () => {
		it("should return updateAvailable true when newer version exists", async () => {
			vi.mocked(packageJson).mockResolvedValue({ version: "2.0.0" } as packageJson.AbbreviatedMetadata)

			const result = await checkForUpdates()

			expect(result.current).toBe("1.0.0")
			expect(result.latest).toBe("2.0.0")
			expect(result.updateAvailable).toBe(true)
		})

		it("should return updateAvailable false when on latest version", async () => {
			vi.mocked(packageJson).mockResolvedValue({ version: "1.0.0" } as packageJson.AbbreviatedMetadata)

			const result = await checkForUpdates()

			expect(result.current).toBe("1.0.0")
			expect(result.latest).toBe("1.0.0")
			expect(result.updateAvailable).toBe(false)
		})

		it("should handle semver comparison correctly", async () => {
			vi.mocked(packageJson).mockResolvedValue({ version: "1.0.1-beta.1" } as packageJson.AbbreviatedMetadata)

			const result = await checkForUpdates()

			// 1.0.1-beta.1 > 1.0.0
			expect(result.updateAvailable).toBe(true)
		})
	})

	describe("executeUpdate", () => {
		it("should spawn update command and resolve on success", async () => {
			const mockProcess = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
			mockProcess.stdout = new EventEmitter()
			mockProcess.stderr = new EventEmitter()
			vi.mocked(childProcess.spawn).mockReturnValue(mockProcess as ReturnType<typeof childProcess.spawn>)

			const promise = executeUpdate("npm install -g @kilocode/cli@latest")

			// Simulate successful exit
			mockProcess.emit("close", 0)

			const result = await promise
			expect(result.success).toBe(true)
			expect(childProcess.spawn).toHaveBeenCalledWith(
				"npm install -g @kilocode/cli@latest",
				expect.objectContaining({ shell: true, stdio: "inherit" }),
			)
		})

		it("should return error on non-zero exit code", async () => {
			const mockProcess = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
			mockProcess.stdout = new EventEmitter()
			mockProcess.stderr = new EventEmitter()
			vi.mocked(childProcess.spawn).mockReturnValue(mockProcess as ReturnType<typeof childProcess.spawn>)

			const promise = executeUpdate("npm install -g @kilocode/cli@latest")

			mockProcess.emit("close", 1)

			const result = await promise
			expect(result.success).toBe(false)
			expect(result.error).toContain("1")
		})

		it("should return error on spawn error", async () => {
			const mockProcess = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }
			mockProcess.stdout = new EventEmitter()
			mockProcess.stderr = new EventEmitter()
			vi.mocked(childProcess.spawn).mockReturnValue(mockProcess as ReturnType<typeof childProcess.spawn>)

			const promise = executeUpdate("npm install -g @kilocode/cli@latest")

			mockProcess.emit("error", new Error("spawn ENOENT"))

			const result = await promise
			expect(result.success).toBe(false)
			expect(result.error).toContain("ENOENT")
		})
	})
})
