import { describe, expect, it, vi, beforeEach } from "vitest"
import * as path from "node:path"

const isWindows = process.platform === "win32"

describe("findKilocodeCli", () => {
	beforeEach(() => {
		vi.resetModules()
	})

	const loginShellTests = isWindows ? it.skip : it

	loginShellTests("finds CLI via login shell and returns trimmed result", async () => {
		const execSyncMock = vi.fn().mockReturnValue("/Users/test/.nvm/versions/node/v20/bin/kilocode\n")
		vi.doMock("node:child_process", () => ({ execSync: execSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).toBe("/Users/test/.nvm/versions/node/v20/bin/kilocode")
		expect(execSyncMock).toHaveBeenCalledWith(
			expect.stringContaining("which kilocode"),
			expect.objectContaining({ encoding: "utf-8" }),
		)
	})

	loginShellTests("falls back to findExecutable when login shell fails", async () => {
		const execSyncMock = vi.fn().mockImplementation(() => {
			throw new Error("login shell failed")
		})
		const statMock = vi.fn().mockImplementation((filePath: string) => {
			if (filePath === "/usr/local/bin/kilocode") {
				return Promise.resolve({ isFile: () => true })
			}
			return Promise.reject(new Error("ENOENT"))
		})
		vi.doMock("node:child_process", () => ({ execSync: execSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			promises: { stat: statMock },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).toBe("/usr/local/bin/kilocode")
	})

	it("falls back to npm paths when all PATH lookups fail", async () => {
		const execSyncMock = vi.fn().mockImplementation(() => {
			throw new Error("not found")
		})
		const fileExistsMock = vi.fn().mockImplementation((path: string) => {
			return Promise.resolve(path.includes("kilocode"))
		})
		vi.doMock("node:child_process", () => ({ execSync: execSyncMock }))
		vi.doMock("../../../../utils/fs", () => ({ fileExistsAtPath: fileExistsMock }))
		vi.doMock("node:fs", () => ({
			existsSync: vi.fn().mockReturnValue(false),
			promises: { stat: vi.fn().mockRejectedValue(new Error("ENOENT")) },
		}))

		const { findKilocodeCli } = await import("../CliPathResolver")
		const result = await findKilocodeCli()

		expect(result).not.toBeNull()
		expect(fileExistsMock).toHaveBeenCalled()
	})

	it("returns null when CLI is not found anywhere", async () => {
		vi.doMock("node:child_process", () => ({
			execSync: vi.fn().mockImplementation(() => {
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
		it("tries PATHEXT extensions on Windows", async () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "win32", configurable: true })

			try {
				const expectedPath = path.join("/npm", "kilocode") + ".CMD"
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
				const result = await findExecutable("kilocode", "/home/test", ["/npm"], {
					PATH: "/npm",
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
				const expectedPath = path.join("/npm", "kilocode") + ".CMD"
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
				const result = await findExecutable("kilocode", "/home/test", ["/npm"], {
					PATH: "/npm",
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
				const expectedPath = path.join("/npm", "kilocode") + ".EXE"
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
				const result = await findExecutable("kilocode", "/home/test", undefined, {
					Path: "/npm",
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
				const comPath = path.join("/npm", "kilocode") + ".COM"
				const exePath = path.join("/npm", "kilocode") + ".EXE"
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
				const result = await findExecutable("kilocode", "/home/test", ["/npm"], {
					PATH: "/npm",
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
})
