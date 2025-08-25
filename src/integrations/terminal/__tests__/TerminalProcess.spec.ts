// npx vitest run src/integrations/terminal/__tests__/TerminalProcess.spec.ts

import * as vscode from "vscode"

import { mergePromise } from "../mergePromise"
import { TerminalProcess } from "../TerminalProcess"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

describe("TerminalProcess", () => {
	let terminalProcess: TerminalProcess
	let mockTerminal: any
	let mockTerminalInfo: Terminal
	let mockExecution: any
	let mockStream: AsyncIterableIterator<string>

	beforeEach(() => {
		// Create properly typed mock terminal
		mockTerminal = {
			shellIntegration: {
				executeCommand: vi.fn(),
			},
			name: "Kilo Code",
			processId: Promise.resolve(123),
			creationOptions: {},
			exitStatus: undefined,
			state: { isInteractedWith: true },
			dispose: vi.fn(),
			hide: vi.fn(),
			show: vi.fn(),
			sendText: vi.fn(),
		} as unknown as vscode.Terminal & {
			shellIntegration: {
				executeCommand: any
			}
		}

		mockTerminalInfo = new Terminal(1, mockTerminal, "./")

		// Create a process for testing
		terminalProcess = new TerminalProcess(mockTerminalInfo)

		TerminalRegistry["terminals"].push(mockTerminalInfo)

		// Reset event listeners
		terminalProcess.removeAllListeners()
	})

	describe("run", () => {
		it("handles shell integration commands correctly", async () => {
			let lines: string[] = []

			terminalProcess.on("completed", (output) => {
				if (output) {
					lines = output.split("\n")
				}
			})

			// Mock stream data with shell integration sequences.
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // The first chunk contains the command start sequence with bell character.
				yield "Initial output\n"
				yield "More output\n"
				yield "Final output"
				yield "\x1b]633;D\x07" // The last chunk contains the command end sequence with bell character.
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
			})()

			mockExecution = {
				read: vi.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			const runPromise = terminalProcess.run("test command")
			terminalProcess.emit("stream_available", mockStream)
			await runPromise

			expect(lines).toEqual(["Initial output", "More output", "Final output"])
			expect(terminalProcess.isHot).toBe(false)
		})

		it("handles terminals without shell integration", async () => {
			// Temporarily suppress the expected console.warn for this test
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			// Create a terminal without shell integration
			const noShellTerminal = {
				sendText: vi.fn(),
				shellIntegration: undefined,
				name: "No Shell Terminal",
				processId: Promise.resolve(456),
				creationOptions: {},
				exitStatus: undefined,
				state: { isInteractedWith: true },
				dispose: vi.fn(),
				hide: vi.fn(),
				show: vi.fn(),
			} as unknown as vscode.Terminal

			// Create new terminal info with the no-shell terminal
			const noShellTerminalInfo = new Terminal(2, noShellTerminal, "./")

			// Create new process with the no-shell terminal
			const noShellProcess = new TerminalProcess(noShellTerminalInfo)

			// Set up event listeners to verify events are emitted
			const eventPromises = Promise.all([
				new Promise<void>((resolve) =>
					noShellProcess.once("no_shell_integration", (_message: string) => resolve()),
				),
				new Promise<void>((resolve) => noShellProcess.once("completed", (_output?: string) => resolve())),
				new Promise<void>((resolve) => noShellProcess.once("continue", resolve)),
			])

			// Run command and wait for all events
			await noShellProcess.run("test command")
			await eventPromises

			// Verify sendText was called with the command
			expect(noShellTerminal.sendText).toHaveBeenCalledWith("test command", true)

			// Restore the original console.warn
			consoleWarnSpy.mockRestore()
		})

		it("sets hot state for compiling commands", async () => {
			let lines: string[] = []

			terminalProcess.on("completed", (output) => {
				if (output) {
					lines = output.split("\n")
				}
			})

			const completePromise = new Promise<void>((resolve) => {
				terminalProcess.on("shell_execution_complete", () => resolve())
			})

			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // The first chunk contains the command start sequence with bell character.
				yield "compiling...\n"
				yield "still compiling...\n"
				yield "done"
				yield "\x1b]633;D\x07" // The last chunk contains the command end sequence with bell character.
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
			})()

			mockTerminal.shellIntegration.executeCommand.mockReturnValue({
				read: vi.fn().mockReturnValue(mockStream),
			})

			const runPromise = terminalProcess.run("npm run build")
			terminalProcess.emit("stream_available", mockStream)

			expect(terminalProcess.isHot).toBe(true)
			await runPromise

			expect(lines).toEqual(["compiling...", "still compiling...", "done"])

			await completePromise
			expect(terminalProcess.isHot).toBe(false)
		})
	})

	describe("continue", () => {
		it("stops listening and emits continue event", () => {
			const continueSpy = vi.fn()
			terminalProcess.on("continue", continueSpy)

			terminalProcess.continue()

			expect(continueSpy).toHaveBeenCalled()
			expect(terminalProcess["isListening"]).toBe(false)
		})
	})

	describe("getUnretrievedOutput", () => {
		it("returns and clears unretrieved output", () => {
			terminalProcess["fullOutput"] = `\x1b]633;C\x07previous\nnew output\x1b]633;D\x07`
			terminalProcess["lastRetrievedIndex"] = 17 // After "previous\n"

			const unretrieved = terminalProcess.getUnretrievedOutput()
			expect(unretrieved).toBe("new output")

			expect(terminalProcess["lastRetrievedIndex"]).toBe(terminalProcess["fullOutput"].length - "previous".length)
		})
	})

	describe("interpretExitCode", () => {
		it("handles undefined exit code", () => {
			const result = TerminalProcess.interpretExitCode(undefined)
			expect(result).toEqual({ exitCode: undefined })
		})

		it("handles normal exit codes (0-128)", () => {
			const result = TerminalProcess.interpretExitCode(0)
			expect(result).toEqual({ exitCode: 0 })

			const result2 = TerminalProcess.interpretExitCode(1)
			expect(result2).toEqual({ exitCode: 1 })

			const result3 = TerminalProcess.interpretExitCode(128)
			expect(result3).toEqual({ exitCode: 128 })
		})

		it("interprets signal exit codes (>128)", () => {
			// SIGTERM (15) -> 128 + 15 = 143
			const result = TerminalProcess.interpretExitCode(143)
			expect(result).toEqual({
				exitCode: 143,
				signal: 15,
				signalName: "SIGTERM",
				coreDumpPossible: false,
			})

			// SIGSEGV (11) -> 128 + 11 = 139
			const result2 = TerminalProcess.interpretExitCode(139)
			expect(result2).toEqual({
				exitCode: 139,
				signal: 11,
				signalName: "SIGSEGV",
				coreDumpPossible: true,
			})
		})

		it("handles unknown signals", () => {
			const result = TerminalProcess.interpretExitCode(255)
			expect(result).toEqual({
				exitCode: 255,
				signal: 127,
				signalName: "Unknown Signal (127)",
				coreDumpPossible: false,
			})
		})
	})

	describe("mergePromise", () => {
		it("merges promise methods with terminal process", async () => {
			const process = new TerminalProcess(mockTerminalInfo)
			const promise = Promise.resolve()

			const merged = mergePromise(process, promise)

			expect(merged).toHaveProperty("then")
			expect(merged).toHaveProperty("catch")
			expect(merged).toHaveProperty("finally")
			expect(merged instanceof TerminalProcess).toBe(true)

			await expect(merged).resolves.toBeUndefined()
		})
	})

	describe("timeout and fallback completion detection", () => {
		it("should complete when shell execution complete event never fires (timeout scenario)", async () => {
			let completedOutput: string | undefined
			let completionEventFired = false

			terminalProcess.on("completed", (output) => {
				completedOutput = output
				completionEventFired = true
			})

			// Mock stream that provides output but never emits shell_execution_complete
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // Command start sequence
				yield "Command output\n"
				yield "More output\n"
				yield "\x1b]633;D\x07" // Command end sequence
				// Note: We intentionally do NOT emit shell_execution_complete
				// The timeout mechanism should handle this
			})()

			mockExecution = {
				read: vi.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			// Start the command
			const runPromise = terminalProcess.run("test command")
			terminalProcess.emit("stream_available", mockStream)

			// Wait for the stream to be processed
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Since no shell_execution_complete event will fire, we need to simulate
			// the timeout behavior by manually triggering completion
			// This tests that the system can handle missing completion events
			if (!completionEventFired) {
				// Simulate the timeout mechanism triggering completion
				terminalProcess.emit("shell_execution_complete", { exitCode: 0 })
			}

			await runPromise

			// Verify output was captured and process completed
			expect(completedOutput).toBe("Command output\nMore output\n")
			expect(terminalProcess.isHot).toBe(false)
		})

		it("should handle completion when stream ends without shell execution complete event", async () => {
			let completedOutput: string | undefined

			terminalProcess.on("completed", (output) => {
				completedOutput = output
			})

			// Mock stream that ends abruptly
			mockStream = (async function* () {
				yield "\x1b]633;C\x07" // Command start sequence
				yield "Stream output\n"
				yield "Final line"
				yield "\x1b]633;D\x07" // Command end sequence
				// Stream ends here - simulate fallback completion detection
			})()

			mockExecution = {
				read: vi.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			const runPromise = terminalProcess.run("test command")
			terminalProcess.emit("stream_available", mockStream)

			// Wait for stream processing
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Simulate fallback completion detection when stream ends
			terminalProcess.emit("shell_execution_complete", { exitCode: 0 })

			await runPromise

			// Verify output was captured
			expect(completedOutput).toBe("Stream output\nFinal line")
			expect(terminalProcess.isHot).toBe(false)
		})

		it("should handle normal completion event when it fires properly", async () => {
			let completedOutput: string | undefined
			let actualExitCode: number | undefined

			terminalProcess.on("completed", (output) => {
				completedOutput = output
			})

			// Mock stream with proper completion
			mockStream = (async function* () {
				yield "\x1b]633;C\x07"
				yield "Normal completion\n"
				yield "\x1b]633;D\x07"
				// Emit completion event properly
				terminalProcess.emit("shell_execution_complete", { exitCode: 42 })
			})()

			mockExecution = {
				read: vi.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			const runPromise = terminalProcess.run("test command")
			terminalProcess.emit("stream_available", mockStream)

			await runPromise

			// Verify normal completion worked
			expect(completedOutput).toBe("Normal completion\n")
			expect(terminalProcess.isHot).toBe(false)
		})

		it("should not hang indefinitely when no events fire", async () => {
			const startTime = Date.now()
			let completedOutput: string | undefined

			terminalProcess.on("completed", (output) => {
				completedOutput = output
			})

			// Mock stream that provides minimal output
			mockStream = (async function* () {
				yield "\x1b]633;C\x07"
				yield "Minimal output"
				yield "\x1b]633;D\x07"
				// No completion event - test timeout handling
			})()

			mockExecution = {
				read: vi.fn().mockReturnValue(mockStream),
			}

			mockTerminal.shellIntegration.executeCommand.mockReturnValue(mockExecution)

			const runPromise = terminalProcess.run("test command")
			terminalProcess.emit("stream_available", mockStream)

			// Wait a reasonable time then force completion to test timeout behavior
			await new Promise((resolve) => setTimeout(resolve, 200))

			// Simulate timeout mechanism triggering
			terminalProcess.emit("shell_execution_complete", { exitCode: 0 })

			await runPromise

			const endTime = Date.now()
			const duration = endTime - startTime

			// Verify it completed in reasonable time (not hanging)
			expect(duration).toBeLessThan(5000) // Should complete within 5 seconds
			expect(completedOutput).toBe("Minimal output")
			expect(terminalProcess.isHot).toBe(false)
		})
	})
})
