import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ShellSession } from "../shell/session.js"
import { spawn, ChildProcess } from "child_process"

// Mock the default-shell module
vi.mock("default-shell", () => ({
	detectDefaultShell: vi.fn(() => "/bin/bash"),
}))

// Mock child_process.spawn
vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

type MockStream = {
	on: (event: string, callback: (data: string) => void) => void
}

type MockStdin = {
	write: (data: string, encoding: string, callback?: (error?: Error) => void) => void
	end: () => void
}

type MockChildProcess = {
	stdout: MockStream | null
	stderr: MockStream | null
	stdin: MockStdin | null
	kill: () => void
	on: (event: string, callback: (code?: number, signal?: string) => void) => void
}

describe("ShellSession", () => {
	let mockChildProcess: MockChildProcess
	let mockStdout: MockStream
	let mockStderr: MockStream
	let mockStdin: MockStdin

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup mock streams
		mockStdout = {
			on: vi.fn(),
		}
		mockStderr = {
			on: vi.fn(),
		}
		mockStdin = {
			write: vi.fn(),
			end: vi.fn(),
		}

		// Setup mock child process
		mockChildProcess = {
			stdout: mockStdout,
			stderr: mockStderr,
			stdin: mockStdin,
			kill: vi.fn(),
			on: vi.fn(),
		}

		vi.mocked(spawn).mockReturnValue(mockChildProcess as unknown as ChildProcess)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("initialization", () => {
		it("should create a new shell session with default shell", async () => {
			const session = new ShellSession()

			// Mock the ready event
			mockChildProcess.on.mockImplementation(
				(event: string, callback: (code?: number, signal?: string) => void) => {
					if (event === "close") return
					setTimeout(() => callback(0, null), 10)
				},
			)

			await session.ensureSession("/tmp/test")

			expect(spawn).toHaveBeenCalledWith("/bin/bash", [], {
				cwd: "/tmp/test",
				stdio: ["pipe", "pipe", "pipe"],
				env: expect.objectContaining({
					PS1: "",
					PROMPT_COMMAND: expect.stringContaining("__KILO_DONE__"),
				}),
				detached: false,
			})
		})

		it("should handle shell spawn errors", async () => {
			const session = new ShellSession()

			mockChildProcess.on.mockImplementation(
				(event: string, callback: (code?: number, signal?: string) => void) => {
					if (event === "error") {
						setTimeout(() => callback(new Error("Spawn failed")), 10)
					}
				},
			)

			await expect(session.ensureSession("/tmp/test")).rejects.toThrow("Spawn failed")
		})
	})

	describe("command execution", () => {
		let session: ShellSession

		beforeEach(async () => {
			session = new ShellSession()
			await session.ensureSession("/tmp/test")

			// Setup event handlers
			mockStdout.on.mockImplementation((event: string, callback: (data: string) => void) => {
				if (event === "data") {
					// Simulate sentinel output
					setTimeout(() => callback("__KILO_DONE__:0:/tmp/test\n"), 10)
				}
			})

			mockStderr.on.mockImplementation((_event: string, _callback: (data: string) => void) => {
				// No stderr
			})

			mockChildProcess.on.mockImplementation(
				(event: string, _callback: (code?: number, signal?: string) => void) => {
					if (event === "close") return
				},
			)
		})

		it("should execute commands and parse sentinel output", async () => {
			const result = await session.run("echo hello")

			expect(result).toEqual({
				stdout: "",
				stderr: "",
				exitCode: 0,
				cwd: "/tmp/test",
			})

			expect(mockStdin.write).toHaveBeenCalledWith(
				expect.stringContaining("echo hello"),
				"utf8",
				expect.any(Function),
			)
		})

		it("should handle command output", async () => {
			mockStdout.on.mockImplementation((event: string, callback: (data: string) => void) => {
				if (event === "data") {
					setTimeout(() => callback("hello world\n__KILO_DONE__:0:/tmp/test\n"), 10)
				}
			})

			const result = await session.run("echo hello")

			expect(result).toEqual({
				stdout: "hello world",
				stderr: "",
				exitCode: 0,
				cwd: "/tmp/test",
			})
		})

		it("should handle stderr output", async () => {
			mockStderr.on.mockImplementation((event: string, callback: (data: string) => void) => {
				if (event === "data") {
					setTimeout(() => callback("error message\n"), 10)
				}
			})

			mockStdout.on.mockImplementation((event: string, callback: (data: string) => void) => {
				if (event === "data") {
					setTimeout(() => callback("__KILO_DONE__:1:/tmp/test\n"), 10)
				}
			})

			const result = await session.run("failing command")

			expect(result).toEqual({
				stdout: "",
				stderr: "error message",
				exitCode: 1,
				cwd: "/tmp/test",
			})
		})

		it("should timeout long-running commands", async () => {
			const session = new ShellSession({ timeout: 50 })

			// Don't send sentinel to trigger timeout
			mockStdout.on.mockImplementation(() => {})
			mockStderr.on.mockImplementation(() => {})

			await expect(session.run("sleep 1")).rejects.toThrow("Command timeout after 50ms")
		})

		it("should reject concurrent commands", async () => {
			const promise1 = session.run("cmd1")

			await expect(session.run("cmd2")).rejects.toThrow("Command already in progress")

			// Complete the first command
			setTimeout(() => {
				mockStdout.on.mock.calls[0][1]("__KILO_DONE__:0:/tmp/test\n")
			}, 10)

			await promise1
		})
	})

	describe("directory tracking", () => {
		it("should track current directory from sentinel", async () => {
			const session = new ShellSession()
			await session.ensureSession("/tmp/test")

			mockStdout.on.mockImplementation((event: string, callback: (data: string) => void) => {
				if (event === "data") {
					setTimeout(() => callback("__KILO_DONE__:0:/home/user\n"), 10)
				}
			})

			await session.run("cd /home/user")

			expect(session.getCurrentDirectory()).toBe("/home/user")
		})
	})

	describe("lifecycle", () => {
		it("should dispose properly", async () => {
			const session = new ShellSession()
			await session.ensureSession("/tmp/test")

			session.dispose()

			expect(mockChildProcess.kill).toHaveBeenCalled()
			expect(session.isSessionReady()).toBe(false)
		})

		it("should handle process exit", async () => {
			const session = new ShellSession()
			await session.ensureSession("/tmp/test")

			mockChildProcess.on.mockImplementation(
				(event: string, callback: (code?: number, signal?: string) => void) => {
					if (event === "close") {
						setTimeout(() => callback(1, "SIGTERM"), 10)
					}
				},
			)

			const promise = session.run("test")
			await expect(promise).rejects.toThrow("Shell process exited unexpectedly with code 1")

			expect(session.isSessionReady()).toBe(false)
		})
	})
})
