import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"

// Mock os module
// kilocode_change start
vi.mock("os", async () => {
	const actual = await vi.importActual("os")
	return {
		...actual,
		platform: vi.fn(() => "darwin"), // Default to non-Windows
		tmpdir: vi.fn(() => "/mock/tmp/dir"),
	}
})

// Mock fs/promises module
const mockWriteFile = vi.fn().mockResolvedValue(undefined)
const mockUnlink = vi.fn().mockResolvedValue(undefined)
const mockReadFile = vi.fn().mockResolvedValue("mocked system prompt content")

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = (await importOriginal()) as any
	return {
		...actual,
		default: {
			writeFile: mockWriteFile,
			unlink: mockUnlink,
			readFile: mockReadFile,
		},
		writeFile: mockWriteFile,
		unlink: mockUnlink,
		readFile: mockReadFile,
	}
})

// Mock crypto for UUID generation
const mockRandomUUID = vi.fn(() => "3af3dd36-2332-43a2-9d57-41af7e4c9453")

vi.mock("node:crypto", async () => {
	const actual = await vi.importActual("node:crypto")
	return {
		...actual,
		randomUUID: mockRandomUUID,
	}
})

// Mock path module
const mockPathJoin = vi.fn((dir: string, filename: string) => `${dir}/${filename}`)

vi.mock("node:path", async () => {
	const actual = await vi.importActual("node:path")
	return {
		...actual,
		join: mockPathJoin,
	}
})
// kilocode_change end

// Mock vscode workspace
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/test/workspace",
				},
			},
		],
	},
}))

// Mock execa to test stdin behavior
const mockExeca = vi.fn()
const mockStdin = {
	write: vi.fn((data, encoding, callback) => {
		// Simulate successful write
		if (callback) callback(null)
	}),
	end: vi.fn(),
}

// Mock process that simulates successful execution
const createMockProcess = () => {
	let resolveProcess: (value: { exitCode: number }) => void
	const processPromise = new Promise<{ exitCode: number }>((resolve) => {
		resolveProcess = resolve
	})

	const mockProcess = {
		stdin: mockStdin,
		stdout: {
			on: vi.fn(),
		},
		stderr: {
			on: vi.fn((event, callback) => {
				// Don't emit any stderr data in tests
			}),
		},
		on: vi.fn((event, callback) => {
			if (event === "close") {
				// Simulate successful process completion after a short delay
				setTimeout(() => {
					callback(0)
					resolveProcess({ exitCode: 0 })
				}, 10)
			}
			if (event === "error") {
				// Don't emit any errors in tests
			}
		}),
		killed: false,
		kill: vi.fn(),
		then: processPromise.then.bind(processPromise),
		catch: processPromise.catch.bind(processPromise),
		finally: processPromise.finally.bind(processPromise),
	}
	return mockProcess
}

vi.mock("execa", () => ({
	execa: mockExeca,
}))

// Mock readline with proper interface simulation
let mockReadlineInterface: any = null

vi.mock("readline", () => ({
	default: {
		createInterface: vi.fn(() => {
			mockReadlineInterface = {
				async *[Symbol.asyncIterator]() {
					// Simulate Claude CLI JSON output
					yield '{"type":"text","text":"Hello"}'
					yield '{"type":"text","text":" world"}'
					// Simulate end of stream - must return to terminate the iterator
					return
				},
				close: vi.fn(),
			}
			return mockReadlineInterface
		}),
	},
}))

describe("runClaudeCode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockExeca.mockReturnValue(createMockProcess())
		// kilocode_change start
		// Reset mock functions
		mockWriteFile.mockResolvedValue(undefined)
		mockUnlink.mockResolvedValue(undefined)
		mockReadFile.mockResolvedValue("mocked system prompt content")
		mockRandomUUID.mockReturnValue("3af3dd36-2332-43a2-9d57-41af7e4c9453")
		mockPathJoin.mockImplementation((dir: string, filename: string) => `${dir}/${filename}`)
		// kilocode_change end
		// Mock setImmediate to run synchronously in tests
		vi.spyOn(global, "setImmediate").mockImplementation((callback: any) => {
			callback()
			return {} as any
		})
		// kilocode_change Reset the module cache to ensure fresh imports
		vi.resetModules()
		// kilocode_change end
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("should export runClaudeCode function", async () => {
		const { runClaudeCode } = await import("../run")
		expect(typeof runClaudeCode).toBe("function")
	})

	test("should be an async generator function", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const result = runClaudeCode(options)
		expect(Symbol.asyncIterator in result).toBe(true)
		expect(typeof result[Symbol.asyncIterator]).toBe("function")
	})

	test("should handle platform-specific stdin behavior", async () => {
		const messages = [{ role: "user" as const, content: "Hello world!" }]
		const systemPrompt = "You are a helpful assistant"
		const options = {
			systemPrompt,
			messages,
		}

		// Test on Windows
		const os = await import("os")
		vi.mocked(os.platform).mockReturnValue("win32")

		// kilocode_change start
		// Import the module after setting up mocks
		const { runClaudeCode } = await import("../run")
		const generator = runClaudeCode(options)
		// Consume at least one item to trigger process spawn
		await generator.next()
		// Clean up the generator
		await generator.return(undefined)
		const [, args] = mockExeca.mock.calls[0]
		expect(args).toContain("--system-prompt-file")
		// When using system prompt file, should only pass messages via stdin
		const expectedStdinData = JSON.stringify(messages)
		expect(mockStdin.write).toHaveBeenCalledWith(expectedStdinData, "utf8", expect.any(Function))

		// Verify that writeFile was called to create temp file
		expect(mockWriteFile).toHaveBeenCalledWith(
			expect.stringContaining("kilocode-system-prompt-"),
			systemPrompt,
			"utf8",
		)
		// kilocode_change end

		// Reset mocks for non-Windows test
		vi.clearAllMocks()
		mockExeca.mockReturnValue(createMockProcess())

		// Test on non-Windows
		vi.mocked(os.platform).mockReturnValue("darwin")

		// kilocode_change start
		// Re-import to get fresh module with new platform setting
		vi.resetModules()
		const { runClaudeCode: runClaudeCode2 } = await import("../run")
		const generator2 = runClaudeCode2(options)
		// kilocode_change end
		const results2 = []
		for await (const chunk of generator2) {
			results2.push(chunk)
		}

		// On non-Windows, should have --system-prompt in args
		const [, args2] = mockExeca.mock.calls[0]
		expect(args2).toContain("--system-prompt")
		expect(args2).toContain(systemPrompt)

		// Should only pass messages via stdin
		expect(mockStdin.write).toHaveBeenCalledWith(JSON.stringify(messages), "utf8", expect.any(Function))
	})

	test("should include model parameter when provided", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			modelId: "claude-3-5-sonnet-20241022",
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		const [, args] = mockExeca.mock.calls[0]
		expect(args).toContain("--model")
		expect(args).toContain("claude-3-5-sonnet-20241022")
	})

	test("should use custom claude path when provided", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			path: "/custom/path/to/claude",
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		const [claudePath] = mockExeca.mock.calls[0]
		expect(claudePath).toBe("/custom/path/to/claude")
	})

	test("should handle stdin write errors gracefully", async () => {
		const { runClaudeCode } = await import("../run")

		// Create a mock process with stdin that fails
		const mockProcessWithError = createMockProcess()
		mockProcessWithError.stdin.write = vi.fn((data, encoding, callback) => {
			// Simulate write error
			if (callback) callback(new Error("EPIPE: broken pipe"))
		})

		// Mock console.error to verify error logging
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		mockExeca.mockReturnValueOnce(mockProcessWithError)

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Try to consume the generator
		try {
			await generator.next()
		} catch (error) {
			// Expected to fail
		}

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error writing to Claude Code stdin:", expect.any(Error))

		// Verify process was killed
		expect(mockProcessWithError.kill).toHaveBeenCalled()

		// Clean up
		consoleErrorSpy.mockRestore()
		await generator.return(undefined)
	})

	test("should handle stdin access errors gracefully", async () => {
		const { runClaudeCode } = await import("../run")

		// Create a mock process without stdin
		const mockProcessWithoutStdin = createMockProcess()
		mockProcessWithoutStdin.stdin = null as any

		// Mock console.error to verify error logging
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		mockExeca.mockReturnValueOnce(mockProcessWithoutStdin)

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Try to consume the generator
		try {
			await generator.next()
		} catch (error) {
			// Expected to fail
		}

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error accessing Claude Code stdin:", expect.any(Error))

		// Verify process was killed
		expect(mockProcessWithoutStdin.kill).toHaveBeenCalled()

		// Clean up
		consoleErrorSpy.mockRestore()
		await generator.return(undefined)
	})
})
