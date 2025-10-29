// npx vitest run integrations/terminal/__tests__/ExecaTerminalProcess.spec.ts

const mockPid = 12345

// Simple mock that avoids complex Promise prototype manipulation
let mockSubprocess: any
let mockExitCode = 0
let mockStreamData = ["test output\n"]

vitest.mock("execa", () => {
	const mockKill = vitest.fn()
	const execa = vitest.fn((options: any) => {
		return (_template: TemplateStringsArray, ...args: any[]) => {
			mockSubprocess = {
				pid: mockPid,
				kill: mockKill,
				iterable: (_opts: any) =>
					(async function* () {
						for (const data of mockStreamData) {
							yield data
						}
					})(),
				then: vitest.fn((onResolve) => {
					setTimeout(() => onResolve({ exitCode: mockExitCode }), 10)
					return Promise.resolve({ exitCode: mockExitCode })
				}),
				catch: vitest.fn((onReject) => {
					return Promise.resolve({ exitCode: mockExitCode })
				}),
			}
			return mockSubprocess
		}
	})
	return {
		execa,
		ExecaError: class extends Error {
			exitCode?: number
			signal?: string
			constructor(message: string, exitCode?: number, signal?: string) {
				super(message)
				this.exitCode = exitCode
				this.signal = signal
			}
		},
	}
})

vitest.mock("ps-tree", () => ({
	default: vitest.fn((_: number, cb: any) => cb(null, [])),
}))

import { execa } from "execa"
import { ExecaTerminalProcess } from "../ExecaTerminalProcess"
import type { RooTerminal } from "../types"

describe("ExecaTerminalProcess", () => {
	let mockTerminal: RooTerminal
	let terminalProcess: ExecaTerminalProcess
	let originalEnv: NodeJS.ProcessEnv

	beforeEach(() => {
		originalEnv = { ...process.env }
		mockTerminal = {
			provider: "execa",
			id: 1,
			busy: false,
			running: false,
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/cwd"),
			isClosed: vitest.fn().mockReturnValue(false),
			runCommand: vitest.fn(),
			setActiveStream: vitest.fn(),
			shellExecutionComplete: vitest.fn(),
			getProcessesWithOutput: vitest.fn().mockReturnValue([]),
			getUnretrievedOutput: vitest.fn().mockReturnValue(""),
			getLastCommand: vitest.fn().mockReturnValue(""),
			cleanCompletedProcessQueue: vitest.fn(),
		} as unknown as RooTerminal
		terminalProcess = new ExecaTerminalProcess(mockTerminal)

		// Reset mock state
		mockExitCode = 0
		mockStreamData = ["test output\n"]
		vitest.clearAllMocks()
	})

	afterEach(() => {
		process.env = originalEnv
		vitest.clearAllMocks()
	})

	describe("UTF-8 encoding and detached process options", () => {
		it("should set LANG and LC_ALL to en_US.UTF-8 with detached options", async () => {
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: true,
					cwd: "/test/cwd",
					all: true,
					detached: true, // Should be detached for background execution
					cleanup: true, // Should auto-cleanup on exit
					stdin: "ignore",
					env: expect.objectContaining({
						LANG: "en_US.UTF-8",
						LC_ALL: "en_US.UTF-8",
					}),
				}),
			)
		})

		it("should preserve existing environment variables", async () => {
			process.env.EXISTING_VAR = "existing"
			terminalProcess = new ExecaTerminalProcess(mockTerminal)
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			const calledOptions = execaMock.mock.calls[0][0] as any
			expect(calledOptions.env.EXISTING_VAR).toBe("existing")
		})

		it("should override existing LANG and LC_ALL values", async () => {
			process.env.LANG = "C"
			process.env.LC_ALL = "POSIX"
			terminalProcess = new ExecaTerminalProcess(mockTerminal)
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			const calledOptions = execaMock.mock.calls[0][0] as any
			expect(calledOptions.env.LANG).toBe("en_US.UTF-8")
			expect(calledOptions.env.LC_ALL).toBe("en_US.UTF-8")
		})
	})

	describe("basic functionality and background execution", () => {
		it("should create instance with terminal reference", () => {
			expect(terminalProcess).toBeInstanceOf(ExecaTerminalProcess)
			expect(terminalProcess.terminal).toBe(mockTerminal)
		})

		it("should emit shell_execution_started and continue immediately", async () => {
			const startSpy = vitest.fn()
			const continueSpy = vitest.fn()
			terminalProcess.on("shell_execution_started", startSpy)
			terminalProcess.on("continue", continueSpy)

			await terminalProcess.run("echo test")

			expect(startSpy).toHaveBeenCalledWith(mockPid)
			expect(continueSpy).toHaveBeenCalled()
		})

		it("should start background stream monitoring", async () => {
			await terminalProcess.run("echo test")
			expect(mockTerminal.setActiveStream).toHaveBeenCalledWith(expect.any(Object), mockPid)
		})

		it("should complete run() immediately without waiting for subprocess", async () => {
			const startTime = Date.now()
			await terminalProcess.run("sleep 1") // Would normally take 1 second
			const elapsed = Date.now() - startTime

			// Should complete almost immediately (< 100ms) since it's non-blocking
			expect(elapsed).toBeLessThan(100)
		})
	})

	describe("continue() behavior", () => {
		it("should stop emitting line events when continue() is called", () => {
			const lineSpy = vitest.fn()
			terminalProcess.on("line", lineSpy)

			// Initially listening
			expect(terminalProcess["isListening"]).toBe(true)

			// Call continue - should stop listening
			terminalProcess.continue()

			// Should no longer be listening
			expect(terminalProcess["isListening"]).toBe(false)

			// Should have emitted continue event
			const continueSpy = vitest.fn()
			terminalProcess.on("continue", continueSpy)
			terminalProcess.continue()
			expect(continueSpy).toHaveBeenCalled()
		})

		it("should emit remaining buffer before stopping listening", () => {
			// Setup some unretrieved output
			terminalProcess["fullOutput"] = "some output\n"
			terminalProcess["lastRetrievedIndex"] = 0

			const lineSpy = vitest.fn()
			terminalProcess.on("line", lineSpy)

			// Call continue - should emit remaining output first
			terminalProcess.continue()

			// Should have emitted the remaining output
			expect(lineSpy).toHaveBeenCalledWith("some output\n")
		})
	})

	describe("background stream monitoring", () => {
		it("should emit shell_execution_complete when background subprocess finishes", async () => {
			const completeSpy = vitest.fn()
			terminalProcess.on("shell_execution_complete", completeSpy)

			// Set custom exit code
			mockExitCode = 42

			await terminalProcess.run("test command")

			// Wait for background completion
			await new Promise((resolve) => setTimeout(resolve, 50))

			expect(completeSpy).toHaveBeenCalledWith({ exitCode: 42 })
		})

		it("should emit completed event when background monitoring finishes", async () => {
			const completedSpy = vitest.fn()
			terminalProcess.on("completed", completedSpy)

			await terminalProcess.run("echo test")

			// Wait for background completion
			await new Promise((resolve) => setTimeout(resolve, 50))

			expect(completedSpy).toHaveBeenCalledWith("test output\n")
		})

		it("should collect output during background monitoring", async () => {
			mockStreamData = ["line 1\n", "line 2\n", "line 3\n"]

			await terminalProcess.run("multi-line command")

			// Wait for stream processing
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Verify output was collected
			expect(terminalProcess["fullOutput"]).toBe("line 1\nline 2\nline 3\n")
		})

		it("should handle background subprocess errors properly", async () => {
			const completeSpy = vitest.fn()
			terminalProcess.on("shell_execution_complete", completeSpy)

			// Set up error scenario by manipulating the mock's behavior
			mockExitCode = 1
			mockStreamData = ["error output\n"]

			await terminalProcess.run("failing command")

			// Wait for background processing
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Should still emit completion event even for errors
			expect(completeSpy).toHaveBeenCalledWith({ exitCode: 1 })
		})
	})

	describe("process cleanup", () => {
		it("should perform final cleanup when background monitoring completes", async () => {
			const completedSpy = vitest.fn()
			terminalProcess.on("completed", completedSpy)

			await terminalProcess.run("echo test")

			// Wait for background completion
			await new Promise((resolve) => setTimeout(resolve, 50))

			// Verify final cleanup was called
			expect(mockTerminal.setActiveStream).toHaveBeenLastCalledWith(undefined)
			expect(completedSpy).toHaveBeenCalled()
		})

		it("should handle abort during background monitoring", async () => {
			// Test that abort functionality works by checking the aborted flag
			await terminalProcess.run("long command")

			// Allow background monitoring to start
			await new Promise((resolve) => setTimeout(resolve, 10))

			// Abort the process
			terminalProcess.abort()

			// Verify that the aborted flag was set
			expect(terminalProcess["aborted"]).toBe(true)

			// Verify cleanup was called
			expect(mockTerminal.setActiveStream).toHaveBeenLastCalledWith(undefined)
		})
	})

	describe("output retrieval", () => {
		it("should track unretrieved output correctly", () => {
			terminalProcess["fullOutput"] = "line 1\nline 2\nline 3\n"
			terminalProcess["lastRetrievedIndex"] = 0

			expect(terminalProcess.hasUnretrievedOutput()).toBe(true)

			const output = terminalProcess.getUnretrievedOutput()
			expect(output).toBe("line 1\nline 2\nline 3\n")

			expect(terminalProcess.hasUnretrievedOutput()).toBe(false)
		})

		it("should handle partial output retrieval", () => {
			terminalProcess["fullOutput"] = "line 1\nline 2\npartial"
			terminalProcess["lastRetrievedIndex"] = 0

			const output = terminalProcess.getUnretrievedOutput()
			expect(output).toBe("line 1\nline 2\n")

			// Partial line should remain unretrieved
			expect(terminalProcess.hasUnretrievedOutput()).toBe(true)
		})
	})
})
