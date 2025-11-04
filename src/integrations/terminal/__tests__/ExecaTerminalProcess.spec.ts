// npx vitest run integrations/terminal/__tests__/ExecaTerminalProcess.spec.ts

const mockPid = 12345
// kilocode_change start - mocking
let mockSubprocess: any
let mockExitCode = 0
let mockStreamData = ["test output\n"]
// kilocode_change end - mocking

vitest.mock("execa", () => {
	const mockKill = vitest.fn()
	const execa = vitest.fn((options: any) => {
		// kilocode_change update mockSubprocess with mocks ^
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

		// kilocode_change start - mocking
		mockExitCode = 0
		mockStreamData = ["test output\n"]
		vitest.clearAllMocks()
		// kilocode_change end  - mocking
	})

	afterEach(() => {
		process.env = originalEnv
		vitest.clearAllMocks()
	})

	describe("UTF-8 encoding fix", () => {
		it("should set LANG and LC_ALL to en_US.UTF-8", async () => {
			await terminalProcess.run("echo test")
			const execaMock = vitest.mocked(execa)
			expect(execaMock).toHaveBeenCalledWith(
				expect.objectContaining({
					shell: true,
					cwd: "/test/cwd",
					all: true,
					detached: true, // kilocode_change - Should be detached for background execution
					cleanup: true, // kilocode_change - Should auto-cleanup on exit
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

	describe.skip("basic functionality", () => {
		it("should create instance with terminal reference", () => {
			expect(terminalProcess).toBeInstanceOf(ExecaTerminalProcess)
			expect(terminalProcess.terminal).toBe(mockTerminal)
		})

		it("should emit shell_execution_complete with exitCode 0", async () => {
			const spy = vitest.fn()
			terminalProcess.on("shell_execution_complete", spy)
			await terminalProcess.run("echo test")
			expect(spy).toHaveBeenCalledWith({ exitCode: 0 })
		})

		it("should emit completed event with full output", async () => {
			const spy = vitest.fn()
			terminalProcess.on("completed", spy)
			await terminalProcess.run("echo test")
			expect(spy).toHaveBeenCalledWith("test output\n")
		})

		it("should set and clear active stream", async () => {
			await terminalProcess.run("echo test")
			expect(mockTerminal.setActiveStream).toHaveBeenCalledWith(expect.any(Object), mockPid)
			expect(mockTerminal.setActiveStream).toHaveBeenLastCalledWith(undefined)
		})
	})

	// kilocode_change start - background support
	describe("basic functionality with background support", () => {
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
	// kilocode_change end - background support
})
