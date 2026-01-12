// npx vitest run integrations/terminal/__tests__/ExecaTerminal.spec.ts

import { RooTerminalCallbacks } from "../types"
import { ExecaTerminal } from "../ExecaTerminal"

describe("ExecaTerminal", () => {
	const isWindows = process.platform === "win32"

	it("should run terminal commands and collect output", async () => {
		if (isWindows) {
			return
		}

		const terminal = new ExecaTerminal(1, "/tmp")
		let result: string | undefined

		// Create a promise that resolves when onCompleted is called
		let resolveCompletion: () => void
		const completionPromise = new Promise<void>((resolve) => {
			resolveCompletion = resolve
		})

		const onLineSpy = vi.fn()
		const onShellExecutionStartedSpy = vi.fn()
		const onShellExecutionCompleteSpy = vi.fn()

		const callbacks: RooTerminalCallbacks = {
			onLine: (line, process) => onLineSpy(line, process),
			onCompleted: (output, process) => {
				result = output
				resolveCompletion()
			},
			onShellExecutionStarted: (pid, process) => onShellExecutionStartedSpy(pid, process),
			onShellExecutionComplete: (details, process) => onShellExecutionCompleteSpy(details, process),
		}

		const subprocess = terminal.runCommand("ls -al", callbacks)
		await subprocess

		// Wait for the actual completion callback
		await completionPromise

		expect(onLineSpy).toHaveBeenCalled()
		expect(onShellExecutionStartedSpy).toHaveBeenCalled()
		expect(onShellExecutionCompleteSpy).toHaveBeenCalled()
		expect(onShellExecutionCompleteSpy).toHaveBeenCalledWith(
			expect.objectContaining({ exitCode: 0 }),
			expect.anything(),
		)

		expect(result).toBeTypeOf("string")
		expect(result).toContain("total")
	})

	it("should handle command errors properly", async () => {
		if (isWindows) {
			return
		}

		const terminal = new ExecaTerminal(2, "/tmp")
		let completedOutput: string | undefined
		let exitDetails: any

		const completionPromise = new Promise<void>((resolve) => {
			const callbacks: RooTerminalCallbacks = {
				onLine: vi.fn(),
				onCompleted: (output) => {
					completedOutput = output
					resolve()
				},
				onShellExecutionStarted: vi.fn(),
				onShellExecutionComplete: (details) => {
					exitDetails = details
				},
			}

			terminal.runCommand("exit 42", callbacks)
		})

		await completionPromise

		expect(exitDetails).toBeDefined()
		expect(exitDetails.exitCode).toBe(42)
		expect(completedOutput).toBeDefined()
	})

	it("should handle abort() correctly", async () => {
		if (isWindows) {
			return
		}

		const terminal = new ExecaTerminal(3, "/tmp")
		let wasCompleted = false
		let exitDetails: any

		const completionPromise = new Promise<void>((resolve) => {
			const callbacks: RooTerminalCallbacks = {
				onLine: vi.fn(),
				onCompleted: (output) => {
					wasCompleted = true
					resolve()
				},
				onShellExecutionStarted: vi.fn(),
				onShellExecutionComplete: (details) => {
					exitDetails = details
				},
			}

			const subprocess = terminal.runCommand("sleep 10", callbacks)

			// Abort after a short delay
			setTimeout(() => {
				if (terminal.process) {
					terminal.process.abort()
				}
			}, 100)
		})

		await completionPromise

		expect(wasCompleted).toBe(true)
		expect(terminal.busy).toBe(false)
	})

	it("should emit line events for all output", async () => {
		if (isWindows) {
			return
		}

		const terminal = new ExecaTerminal(4, "/tmp")
		const lines: string[] = []

		const completionPromise = new Promise<void>((resolve) => {
			const callbacks: RooTerminalCallbacks = {
				onLine: (line) => lines.push(line),
				onCompleted: () => resolve(),
				onShellExecutionStarted: vi.fn(),
				onShellExecutionComplete: vi.fn(),
			}

			terminal.runCommand("echo 'line1'; echo 'line2'; echo 'line3'", callbacks)
		})

		await completionPromise

		expect(lines.length).toBeGreaterThan(0)
		const output = lines.join("")
		expect(output).toContain("line1")
		expect(output).toContain("line2")
		expect(output).toContain("line3")
	})

	it("should run commands in background (non-blocking)", async () => {
		if (isWindows) {
			return
		}

		const terminal = new ExecaTerminal(5, "/tmp")

		const callbacks: RooTerminalCallbacks = {
			onLine: vi.fn(),
			onCompleted: vi.fn(),
			onShellExecutionStarted: vi.fn(),
			onShellExecutionComplete: vi.fn(),
		}

		const startTime = Date.now()
		const subprocess = terminal.runCommand("sleep 0.2", callbacks)
		await subprocess // This should complete immediately
		const elapsed = Date.now() - startTime

		// Should complete almost immediately (< 100ms) since it runs in background
		expect(elapsed).toBeLessThan(100)

		// Wait a bit to ensure cleanup happens
		await new Promise((resolve) => setTimeout(resolve, 300))
	})
})
