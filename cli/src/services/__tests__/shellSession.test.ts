import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { ShellSession } from "../shell/session.js"
import { spawn, ChildProcess } from "child_process"
import { EventEmitter } from "events"

// Define mock types for testing
interface MockStdin {
	write: ReturnType<typeof vi.fn>
	end: ReturnType<typeof vi.fn>
}

interface MockChildProcess extends EventEmitter {
	stdout: EventEmitter
	stderr: EventEmitter
	stdin: MockStdin
	kill: ReturnType<typeof vi.fn>
}

// Mock the default-shell module
vi.mock("default-shell", () => ({
	detectDefaultShell: vi.fn(() => "/bin/bash"),
}))

// Mock child_process.spawn
vi.mock("child_process", () => ({
	spawn: vi.fn(),
}))

describe("ShellSession", () => {
	let mockChildProcess: MockChildProcess
	let stdoutEmitter: EventEmitter
	let stderrEmitter: EventEmitter
	let stdin: MockStdin

	beforeEach(() => {
		vi.clearAllMocks()

		// Use EventEmitters for stdout/stderr to easily simulate data events
		stdoutEmitter = new EventEmitter()
		stderrEmitter = new EventEmitter()

		stdin = {
			write: vi.fn(),
			end: vi.fn(),
		}

		mockChildProcess = new EventEmitter()
		mockChildProcess.stdout = stdoutEmitter
		mockChildProcess.stderr = stderrEmitter
		mockChildProcess.stdin = stdin
		mockChildProcess.kill = vi.fn()

		vi.mocked(spawn).mockReturnValue(mockChildProcess as unknown as ChildProcess)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("initialization", () => {
		it("should create a new shell session with default shell", async () => {
			const session = new ShellSession()

			await session.ensureSession("/tmp/test")

			expect(spawn).toHaveBeenCalledWith("/bin/bash", [], {
				cwd: "/tmp/test",
				stdio: ["pipe", "pipe", "pipe"],
				env: expect.objectContaining({
					PS1: "",
					// PROMPT_COMMAND is no longer set in env
				}),
				detached: false,
			})
		})

		it("should handle shell spawn errors", async () => {
			const session = new ShellSession()

			// ensureSession doesn't reject on spawn error because spawn error is async
			// and ensureSession returns immediately.
			// We should verify that the error event is emitted.

			const errorPromise = new Promise<void>((resolve, reject) => {
				session.on("error", (err) => {
					try {
						expect(err.message).toBe("Spawn failed")
						resolve()
					} catch (e) {
						reject(e)
					}
				})
			})

			await session.ensureSession("/tmp/test")

			// Simulate spawn error
			mockChildProcess.emit("error", new Error("Spawn failed"))

			await errorPromise
		})
	})

	describe("command execution", () => {
		let session: ShellSession

		beforeEach(async () => {
			session = new ShellSession()
			await session.ensureSession("/tmp/test")
		})

		it("should execute commands and parse sentinel output", async () => {
			const runPromise = session.run("echo hello")

			// Simulate output
			stdoutEmitter.emit("data", "__KILO_DONE__:0:/tmp/test\n")

			const result = await runPromise

			expect(result).toEqual({
				stdout: "",
				stderr: "",
				exitCode: 0,
				cwd: "/tmp/test",
			})

			expect(stdin.write).toHaveBeenCalledWith(
				expect.stringContaining("echo hello"),
				"utf8",
				expect.any(Function),
			)
		})

		it("should handle command output", async () => {
			const runPromise = session.run("echo hello")

			// Simulate output
			stdoutEmitter.emit("data", "hello world\n__KILO_DONE__:0:/tmp/test\n")

			const result = await runPromise

			expect(result).toEqual({
				stdout: "hello world",
				stderr: "",
				exitCode: 0,
				cwd: "/tmp/test",
			})
		})

		it("should handle stderr output", async () => {
			const runPromise = session.run("failing command")

			// Simulate output
			stderrEmitter.emit("data", "error message\n")
			stdoutEmitter.emit("data", "__KILO_DONE__:1:/tmp/test\n")

			const result = await runPromise

			expect(result).toEqual({
				stdout: "",
				stderr: "error message",
				exitCode: 1,
				cwd: "/tmp/test",
			})
		})

		it("should timeout long-running commands", async () => {
			const session = new ShellSession({ timeout: 50 })
			// We need to initialize the session first (which was done in beforeEach but for the other 'session' instance)
			// Actually beforeEach initializes 'session'. But here we create a new one.

			// Mock spawn again for this new session if needed, but the global mock persists.
			await session.ensureSession("/tmp/test")

			await expect(session.run("sleep 1")).rejects.toThrow("Command timeout after 50ms")
		})

		it("should reject concurrent commands", async () => {
			const promise1 = session.run("cmd1")

			await expect(session.run("cmd2")).rejects.toThrow("Command already in progress")

			// Complete the first command
			stdoutEmitter.emit("data", "__KILO_DONE__:0:/tmp/test\n")

			await promise1
		})
	})

	describe("directory tracking", () => {
		it("should track current directory from sentinel", async () => {
			const session = new ShellSession()
			await session.ensureSession("/tmp/test")

			const runPromise = session.run("cd /home/user")

			stdoutEmitter.emit("data", "__KILO_DONE__:0:/home/user\n")

			await runPromise

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

			const runPromise = session.run("test")

			mockChildProcess.emit("close", 1, "SIGTERM")

			await expect(runPromise).rejects.toThrow("Shell process exited unexpectedly with code 1")

			expect(session.isSessionReady()).toBe(false)
		})
	})
})
