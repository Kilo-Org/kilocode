import { describe, expect, it, vi, beforeEach } from "vitest"

const isWindows = process.platform === "win32"

describe("findKilocodeCli", () => {
	beforeEach(() => {
		vi.resetModules()
	})

	const loginShellTests = isWindows ? it.skip : it

	loginShellTests("finds CLI via login shell and returns CliDiscoveryResult with cliPath", async () => {
		// spawnSync is used for getLoginShellPath, execSync for findViaLoginShell
		const spawnSyncMock = vi.fn().mockReturnValue({ stdout: "/custom/path:/usr/bin\n" })
		const execSyncMock = vi.fn().mockReturnValue("/Users/test/.nvm/versions/node/v20/bin/kilocode\n")

		vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).not.toBeNull()
		expect(result?.cliPath).toBe("/Users/test/.nvm/versions/node/v20/bin/kilocode")
		// shellPath should be captured from login shell via spawnSync
		expect(result?.shellPath).toBe("/custom/path:/usr/bin")
	})

	loginShellTests("falls back to direct PATH when login shell fails", async () => {
		let execCallCount = 0
		const spawnSyncMock = vi.fn().mockReturnValue({ stdout: "/custom/path:/usr/bin\n" })
		const execSyncMock = vi.fn().mockImplementation(() => {
			execCallCount++
			// First call: findViaLoginShell (fails), second: direct PATH
			if (execCallCount === 1) {
				throw new Error("login shell failed")
			}
			return "/usr/local/bin/kilocode\n"
		})

		vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result?.cliPath).toBe("/usr/local/bin/kilocode")
	})

	it("falls back to npm paths when all PATH lookups fail", async () => {
		const spawnSyncMock = vi.fn().mockImplementation(() => {
			throw new Error("not found")
		})
		const execSyncMock = vi.fn().mockImplementation(() => {
			throw new Error("not found")
		})
		const fileExistsMock = vi.fn().mockImplementation((path: string) => {
			// Return true for first path checked to verify fallback works
			return Promise.resolve(path.includes("kilocode"))
		})
		vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: fileExistsMock }))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).not.toBeNull()
		expect(result?.cliPath).toBeDefined()
		expect(fileExistsMock).toHaveBeenCalled()
	})

	it("returns null when CLI is not found anywhere", async () => {
		vi.doMock("node:child_process", () => ({
			execSync: vi.fn().mockImplementation(() => {
				throw new Error("not found")
			}),
			spawnSync: vi.fn().mockImplementation(() => {
				throw new Error("not found")
			}),
		}))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const logMock = vi.fn()
		const result = await findKilocodeCli(logMock)

		expect(result).toBeNull()
		expect(logMock).toHaveBeenCalledWith("kilocode CLI not found")
	})

	it("logs when kilocode not in direct PATH", async () => {
		vi.doMock("node:child_process", () => ({
			execSync: vi.fn().mockImplementation(() => {
				throw new Error("not found")
			}),
			spawnSync: vi.fn().mockImplementation(() => {
				throw new Error("not found")
			}),
		}))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const logMock = vi.fn()
		await findKilocodeCli(logMock)

		expect(logMock).toHaveBeenCalledWith("kilocode not found in direct PATH lookup")
	})

	loginShellTests("captures shell PATH for spawning CLI on macOS", async () => {
		// spawnSync with stdio: ['ignore', 'pipe', 'pipe'] to prevent stdin blocking
		const spawnSyncMock = vi.fn().mockReturnValue({ stdout: "/opt/homebrew/bin:/usr/local/bin:/usr/bin\n" })
		const execSyncMock = vi.fn().mockReturnValue("/opt/homebrew/bin/kilocode\n")

		vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).not.toBeNull()
		expect(result?.cliPath).toBe("/opt/homebrew/bin/kilocode")
		expect(result?.shellPath).toBe("/opt/homebrew/bin:/usr/local/bin:/usr/bin")

		// Verify spawnSync was called with correct args for login shell
		expect(spawnSyncMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.arrayContaining(["-i", "-l", "-c"]),
			expect.objectContaining({
				stdio: ["ignore", "pipe", "pipe"],
			}),
		)
	})
})
