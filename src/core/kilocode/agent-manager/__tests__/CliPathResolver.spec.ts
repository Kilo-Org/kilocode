import { describe, expect, it, vi, beforeEach } from "vitest"
import * as path from "node:path"

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
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).not.toBeNull()
		expect(result?.cliPath).toBe("/Users/test/.nvm/versions/node/v20/bin/kilocode")
		// shellPath should be captured from login shell via spawnSync
		expect(result?.shellPath).toBe("/custom/path:/usr/bin")
	})

	loginShellTests("falls back to findExecutable when login shell fails", async () => {
		const spawnSyncMock = vi.fn().mockReturnValue({ stdout: "/custom/path:/usr/bin\n" })
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
			promises: { stat: statMock },
		}))

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

	const loginShellTests = isWindows ? it.skip : it

	it("returns absolute path if file exists", async () => {
		const statMock = vi.fn().mockResolvedValue({ isFile: () => true })
		vi.doMock("node:fs", () => ({
			promises: { stat: statMock },
		}))

		const { findExecutable } = await import("../CliPathResolver")
		const result = await findExecutable("/usr/bin/kilocode")

		expect(result).toBe("/usr/bin/kilocode")
	})

	it("returns undefined for absolute path if file does not exist", async () => {
		const statMock = vi.fn().mockRejectedValue(new Error("ENOENT"))
		vi.doMock("node:fs", () => ({
			promises: { stat: statMock },
		}))

		const { findExecutable } = await import("../CliPathResolver")
		const result = await findExecutable("/usr/bin/nonexistent")

		expect(result).toBeUndefined()
	})

	it("searches PATH entries for command", async () => {
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

	describe("Windows PATHEXT handling", () => {
		// Use platform-appropriate test paths
		const testDir = isWindows ? "C:\\npm" : "/npm"
		const testCwd = isWindows ? "C:\\home\\test" : "/home/test"

		it("tries PATHEXT extensions on Windows", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })

			try {
				const expectedPath = path.join(testDir, "kilocode") + ".CMD"
				const statMock = vi.fn().mockImplementation((filePath: string) => {
					if (filePath === expectedPath) {
						return Promise.resolve({ isFile: () => true })
					}
					return Promise.reject(new Error("ENOENT"))
				})
				vi.doMock("node:fs", () => ({
					promises: { stat: statMock },
				}))

				const { findExecutable } = await import("../CliPathResolver")
				const result = await findExecutable("kilocode", testCwd, [testDir], {
					PATH: testDir,
					PATHEXT: ".COM;.EXE;.BAT;.CMD",
				})

				expect(result).toBe(expectedPath)
			} finally {
				Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
			}
		})

		it("uses default PATHEXT if not in env", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })

			try {
				const expectedPath = path.join(testDir, "kilocode") + ".CMD"
				const statMock = vi.fn().mockImplementation((filePath: string) => {
					if (filePath === expectedPath) {
						return Promise.resolve({ isFile: () => true })
					}
					return Promise.reject(new Error("ENOENT"))
				})
				vi.doMock("node:fs", () => ({
					promises: { stat: statMock },
				}))

				const { findExecutable } = await import("../CliPathResolver")
				const result = await findExecutable("kilocode", testCwd, [testDir], {
					PATH: testDir,
				})

				expect(result).toBe(expectedPath)
			} finally {
				Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
			}
		})

		it("handles case-insensitive PATH lookup", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })

			try {
				const expectedPath = path.join(testDir, "kilocode") + ".EXE"
				const statMock = vi.fn().mockImplementation((filePath: string) => {
					if (filePath === expectedPath) {
						return Promise.resolve({ isFile: () => true })
					}
					return Promise.reject(new Error("ENOENT"))
				})
				vi.doMock("node:fs", () => ({
					promises: { stat: statMock },
				}))

				const { findExecutable } = await import("../CliPathResolver")
				const result = await findExecutable("kilocode", testCwd, undefined, {
					Path: testDir,
					PathExt: ".COM;.EXE;.BAT;.CMD",
				})

				expect(result).toBe(expectedPath)
			} finally {
				Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
			}
		})

		it("returns first matching PATHEXT extension", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })

			try {
				const comPath = path.join(testDir, "kilocode") + ".COM"
				const exePath = path.join(testDir, "kilocode") + ".EXE"
				const statMock = vi.fn().mockImplementation((filePath: string) => {
					if (filePath === comPath || filePath === exePath) {
						return Promise.resolve({ isFile: () => true })
					}
					return Promise.reject(new Error("ENOENT"))
				})
				vi.doMock("node:fs", () => ({
					promises: { stat: statMock },
				}))

				const { findExecutable } = await import("../CliPathResolver")
				const result = await findExecutable("kilocode", testCwd, [testDir], {
					PATH: testDir,
					PATHEXT: ".COM;.EXE;.BAT;.CMD",
				})

				expect(result).toBe(comPath)
			} finally {
				Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
			}
		})
	})

	it("does not use PATHEXT on non-Windows platforms", async () => {
		const originalPlatform = process.platform
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true })

		try {
			const statMock = vi.fn().mockImplementation((filePath: string) => {
				if (filePath === "/usr/bin/kilocode") {
					return Promise.resolve({ isFile: () => true })
				}
				return Promise.reject(new Error("ENOENT"))
			})
			vi.doMock("node:fs", () => ({
				promises: { stat: statMock },
			}))

			const { findExecutable } = await import("../CliPathResolver")
			const result = await findExecutable("kilocode", "/home/user", ["/usr/bin"])

			expect(result).toBe("/usr/bin/kilocode")
			expect(statMock).not.toHaveBeenCalledWith(expect.stringContaining(".CMD"))
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
		}
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
