import { describe, expect, it, vi, beforeEach } from "vitest"
import * as path from "node:path"

const isWindows = process.platform === "win32"

describe("findKilocodeCli", () => {
	beforeEach(() => {
		vi.resetModules()
	})

	const loginShellTests = isWindows ? it.skip : it

	loginShellTests("finds CLI via login shell and returns CliDiscoveryResult with cliPath", async () => {
		// spawnSync is used for getLoginShellPath (with markers), execSync for findViaLoginShell
		const testShellPath = "/custom/path:/usr/bin"
		const spawnSyncMock = vi
			.fn()
			.mockReturnValue({ stdout: `__KILO_PATH_START__${testShellPath}__KILO_PATH_END__\n` })
		const execSyncMock = vi.fn().mockReturnValue("/Users/test/.nvm/versions/node/v20/bin/kilocode\n")
		const statSyncMock = vi.fn().mockImplementation((filePath: string) => {
			if (filePath === "/Users/test/.nvm/versions/node/v20/bin/kilocode") {
				return { isFile: () => true }
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
		})

		vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			statSync: statSyncMock,
			promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).not.toBeNull()
		expect(result?.cliPath).toBe("/Users/test/.nvm/versions/node/v20/bin/kilocode")
		// shellPath should be captured from login shell via spawnSync
		expect(result?.shellPath).toBe(testShellPath)
	})

	loginShellTests("falls back to findExecutable when login shell fails", async () => {
		const testShellPath = "/custom/path:/usr/bin"
		const spawnSyncMock = vi
			.fn()
			.mockReturnValue({ stdout: `__KILO_PATH_START__${testShellPath}__KILO_PATH_END__\n` })
		const execSyncMock = vi.fn().mockImplementation(() => {
			throw new Error("login shell failed")
		})
		const statMock = vi.fn().mockImplementation((filePath: string) => {
			if (filePath === "/usr/local/bin/kilocode") {
				return Promise.resolve({ isFile: () => true })
			}
			return Promise.reject(new Error("ENOENT"))
		})

		vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			statSync: vi.fn().mockImplementation(() => {
				throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
			}),
			promises: { stat: statMock },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result?.cliPath).toBe("/usr/local/bin/kilocode")
	})

	loginShellTests("ignores alias output from login shell", async () => {
		const originalEnv = { ...process.env }
		const testShellPath = "/custom/path:/usr/bin"
		const spawnSyncMock = vi
			.fn()
			.mockReturnValue({ stdout: `__KILO_PATH_START__${testShellPath}__KILO_PATH_END__\n` })
		const execSyncMock = vi.fn().mockReturnValue("alias kilocode='npx kilo'\n")
		const statMock = vi.fn().mockImplementation((filePath: string) => {
			if (filePath === "/usr/local/bin/kilocode") {
				return Promise.resolve({ isFile: () => true })
			}
			return Promise.reject(new Error("ENOENT"))
		})
		const statSyncMock = vi.fn().mockImplementation((filePath: string) => {
			if (filePath === "/usr/local/bin/kilocode") {
				return { isFile: () => true }
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
		})

		process.env.PATH = "/usr/local/bin"

		try {
			vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
			vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
			vi.doMock("node:fs", () => ({
				existsSync: vi.fn().mockReturnValue(false),
				statSync: statSyncMock,
				promises: { stat: statMock },
			}))

			const { findKilocodeCli } = await import("../CliPathResolver")
			const result = await findKilocodeCli()

			expect(result?.cliPath).toBe("/usr/local/bin/kilocode")
		} finally {
			Object.assign(process.env, originalEnv)
		}
	})

	loginShellTests("strips shell control codes from login shell output", async () => {
		const testShellPath = "/custom/path:/usr/bin"
		const spawnSyncMock = vi
			.fn()
			.mockReturnValue({ stdout: `__KILO_PATH_START__${testShellPath}__KILO_PATH_END__\n` })
		const execSyncMock = vi
			.fn()
			.mockReturnValue("\x1b]1337;RemoteHost=host.local\x07/opt/homebrew/bin/kilocode\n")
		const statSyncMock = vi.fn().mockImplementation((filePath: string) => {
			if (filePath === "/opt/homebrew/bin/kilocode") {
				return { isFile: () => true }
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
		})

		vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			statSync: statSyncMock,
			promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result?.cliPath).toBe("/opt/homebrew/bin/kilocode")
	})

	it("falls back to npm paths when all PATH lookups fail", async () => {
		const spawnSyncMock = vi.fn().mockImplementation(() => {
			throw new Error("not found")
		})
		const execSyncMock = vi.fn().mockImplementation(() => {
			throw new Error("not found")
		})
		const fileExistsMock = vi.fn().mockImplementation((path: string) => {
			return Promise.resolve(path.includes("kilocode"))
		})
		vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: fileExistsMock }))
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).not.toBeNull()
		expect(result?.cliPath).toBeDefined()
		expect(fileExistsMock).toHaveBeenCalled()
	})

	it("prefers PATHEXT executables when scanning npm paths on Windows", async () => {
		const originalPlatform = process.platform
		const originalEnv = { ...process.env }
		Object.defineProperty(process, "platform", { value: "win32", configurable: true })
		process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming"
		process.env.LOCALAPPDATA = ""
		process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD"

		try {
			const spawnSyncMock = vi.fn().mockImplementation(() => {
				throw new Error("not found")
			})
			const execSyncMock = vi.fn().mockImplementation(() => {
				throw new Error("not found")
			})
			const fileExistsMock = vi.fn().mockImplementation((filePath: string) => {
				return Promise.resolve(filePath.endsWith("kilocode.CMD"))
			})

			vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
			vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: fileExistsMock }))
			vi.doMock("node:fs", () => ({
				existsSync: vi.fn().mockReturnValue(false),
				promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
			}))

			const { findKilocodeCli } = await import("../CliPathResolver")
			const result = await findKilocodeCli()

			const expectedCmdPath = path.join("C:\\Users\\test\\AppData\\Roaming", "npm", "kilocode.CMD")
			const expectedBasePath = path.join("C:\\Users\\test\\AppData\\Roaming", "npm", "kilocode")
			expect(result?.cliPath).toBe(expectedCmdPath)
			expect(fileExistsMock).not.toHaveBeenCalledWith(expectedBasePath)
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
			for (const key of Object.keys(process.env)) {
				if (!(key in originalEnv)) {
					delete process.env[key]
				}
			}
			Object.assign(process.env, originalEnv)
		}
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
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const logMock = vi.fn()
		const result = await findKilocodeCli(logMock)

		expect(result).toBeNull()
		expect(logMock).toHaveBeenCalledWith("kilocode CLI not found")
	})

	it("logs when kilocode not in PATH", async () => {
		vi.doMock("node:child_process", () => ({
			execSync: vi.fn().mockImplementation(() => {
				throw new Error("not found")
			}),
			spawnSync: vi.fn().mockImplementation(() => {
				throw new Error("not found")
			}),
		}))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const logMock = vi.fn()
		await findKilocodeCli(logMock)

		expect(logMock).toHaveBeenCalledWith("kilocode not found in PATH lookup")
	})
})

describe("findExecutable", () => {
	beforeEach(() => {
		vi.resetModules()
	})

	// These tests use Unix-style paths which are not absolute on Windows
	// Skip on Windows - the Windows-specific behavior is tested below
	const unixOnlyTest = isWindows ? it.skip : it

	unixOnlyTest("returns absolute path if file exists", async () => {
		const statMock = vi.fn().mockResolvedValue({ isFile: () => true })
		vi.doMock("node:fs", () => ({
			promises: { stat: statMock },
		}))

		const { findExecutable } = await import("../CliPathResolver")
		const result = await findExecutable("/usr/bin/kilocode")

		expect(result).toBe("/usr/bin/kilocode")
	})

	unixOnlyTest("returns undefined for absolute path if file does not exist", async () => {
		const statMock = vi.fn().mockRejectedValue(new Error("ENOENT"))
		vi.doMock("node:fs", () => ({
			promises: { stat: statMock },
		}))

		const { findExecutable } = await import("../CliPathResolver")
		const result = await findExecutable("/usr/bin/nonexistent")

		expect(result).toBeUndefined()
	})

	unixOnlyTest("searches PATH entries for command", async () => {
		const statMock = vi.fn().mockImplementation((filePath: string) => {
			if (filePath === "/custom/bin/myapp") {
				return Promise.resolve({ isFile: () => true })
			}
			return Promise.reject(new Error("ENOENT"))
		})
		vi.doMock("node:fs", () => ({
			promises: { stat: statMock },
		}))

		const { findExecutable } = await import("../CliPathResolver")
		const result = await findExecutable("myapp", "/home/user", ["/usr/bin", "/custom/bin"])

		expect(result).toBe("/custom/bin/myapp")
	})

	// Windows PATHEXT tests - run only on Windows CI
	// We don't simulate Windows on other platforms - let actual Windows CI test it
	describe("Windows PATHEXT handling", () => {
		const windowsOnlyTest = isWindows ? it : it.skip
		const testDir = "C:\\npm"
		const testCwd = "C:\\home\\test"

		const createFsMock = (matchPaths: string[]) => ({
			existsSync: vi.fn().mockReturnValue(false),
			promises: {
				stat: vi.fn().mockImplementation((filePath: string) => {
					if (matchPaths.some((p) => filePath === p)) {
						return Promise.resolve({ isFile: () => true })
					}
					return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
				}),
				lstat: vi.fn().mockImplementation((filePath: string) => {
					if (matchPaths.some((p) => filePath === p)) {
						return Promise.resolve({ isFile: () => true, isSymbolicLink: () => false })
					}
					return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
				}),
			},
		})

		windowsOnlyTest("finds .CMD file via PATHEXT", async () => {
			const expectedPath = path.join(testDir, "kilocode") + ".CMD"
			vi.doMock("node:fs", () => createFsMock([expectedPath]))

			const { findExecutable } = await import("../CliPathResolver")
			const result = await findExecutable("kilocode", testCwd, [testDir], {
				PATH: testDir,
				PATHEXT: ".COM;.EXE;.BAT;.CMD",
			})

			expect(result).toBe(expectedPath)
		})

		windowsOnlyTest("uses default PATHEXT when not in env", async () => {
			const expectedPath = path.join(testDir, "kilocode") + ".CMD"
			vi.doMock("node:fs", () => createFsMock([expectedPath]))

			const { findExecutable } = await import("../CliPathResolver")
			const result = await findExecutable("kilocode", testCwd, [testDir], {
				PATH: testDir,
			})

			expect(result).toBe(expectedPath)
		})

		windowsOnlyTest("handles case-insensitive env var lookup", async () => {
			const expectedPath = path.join(testDir, "kilocode") + ".EXE"
			vi.doMock("node:fs", () => createFsMock([expectedPath]))

			const { findExecutable } = await import("../CliPathResolver")
			const result = await findExecutable("kilocode", testCwd, undefined, {
				Path: testDir, // lowercase 'ath' - Windows env vars are case-insensitive
				PathExt: ".COM;.EXE;.BAT;.CMD",
			})

			expect(result).toBe(expectedPath)
		})

		windowsOnlyTest("returns first matching PATHEXT extension", async () => {
			const comPath = path.join(testDir, "kilocode") + ".COM"
			const exePath = path.join(testDir, "kilocode") + ".EXE"
			vi.doMock("node:fs", () => createFsMock([comPath, exePath]))

			const { findExecutable } = await import("../CliPathResolver")
			const result = await findExecutable("kilocode", testCwd, [testDir], {
				PATH: testDir,
				PATHEXT: ".COM;.EXE;.BAT;.CMD",
			})

			expect(result).toBe(comPath)
		})
	})

	// Non-Windows test - skipped on Windows since we can't simulate other platforms
	const nonWindowsTest = isWindows ? it.skip : it

	nonWindowsTest("does not use PATHEXT on non-Windows platforms", async () => {
		const statMock = vi.fn().mockImplementation((filePath: string) => {
			if (filePath === "/usr/bin/kilocode") {
				return Promise.resolve({ isFile: () => true })
			}
			return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }))
		})
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			promises: {
				stat: statMock,
				lstat: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
			},
		}))

		const { findExecutable } = await import("../CliPathResolver")
		const result = await findExecutable("kilocode", "/home/user", ["/usr/bin"])

		expect(result).toBe("/usr/bin/kilocode")
		expect(statMock).not.toHaveBeenCalledWith(expect.stringContaining(".CMD"))
	})

	// Login shell PATH capture test - skipped on Windows
	const loginShellTests = isWindows ? it.skip : it

	loginShellTests("captures shell PATH for spawning CLI on macOS", async () => {
		// spawnSync returns output with markers to handle shell startup noise
		const testPath = "/opt/homebrew/bin:/usr/local/bin:/usr/bin"
		const spawnSyncMock = vi
			.fn()
			.mockReturnValue({ stdout: `some banner\n__KILO_PATH_START__${testPath}__KILO_PATH_END__\n` })
		const execSyncMock = vi.fn().mockReturnValue("/opt/homebrew/bin/kilocode\n")
		const statSyncMock = vi.fn().mockImplementation((filePath: string) => {
			if (filePath === "/opt/homebrew/bin/kilocode") {
				return { isFile: () => true }
			}
			throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
		})

		vi.doMock("node:child_process", () => ({ execSync: execSyncMock, spawnSync: spawnSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			statSync: statSyncMock,
			promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).not.toBeNull()
		expect(result?.cliPath).toBe("/opt/homebrew/bin/kilocode")
		expect(result?.shellPath).toBe(testPath)

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
