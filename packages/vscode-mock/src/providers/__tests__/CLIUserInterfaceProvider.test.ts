import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { CLIUserInterfaceProvider } from "../CLIUserInterfaceProvider"

describe("CLIUserInterfaceProvider", () => {
	let provider: CLIUserInterfaceProvider
	let originalStdout: typeof process.stdout.write
	let originalStderr: typeof process.stderr.write
	let stdoutOutput: string[]
	let stderrOutput: string[]

	beforeEach(() => {
		stdoutOutput = []
		stderrOutput = []

		// Mock stdout and stderr to capture output
		originalStdout = process.stdout.write
		originalStderr = process.stderr.write

		process.stdout.write = vi.fn((chunk: any) => {
			stdoutOutput.push(chunk.toString())
			return true
		}) as any

		process.stderr.write = vi.fn((chunk: any) => {
			stderrOutput.push(chunk.toString())
			return true
		}) as any
	})

	afterEach(() => {
		// Restore original stdout and stderr
		process.stdout.write = originalStdout
		process.stderr.write = originalStderr
	})

	describe("initialization", () => {
		it("should create provider in interactive mode", () => {
			provider = new CLIUserInterfaceProvider(true)
			expect(provider.isInteractive()).toBe(true)
		})

		it("should create provider in non-interactive mode", () => {
			provider = new CLIUserInterfaceProvider(false)
			expect(provider.isInteractive()).toBe(false)
		})

		it("should detect rich formatting support", () => {
			provider = new CLIUserInterfaceProvider(false)
			const supportsRich = provider.supportsRichFormatting()
			expect(typeof supportsRich).toBe("boolean")
		})
	})

	describe("message display", () => {
		beforeEach(() => {
			provider = new CLIUserInterfaceProvider(false) // Non-interactive for testing
		})

		it("should show info messages", async () => {
			await provider.showInfo("Test info message")

			const output = stdoutOutput.join("")
			expect(output).toContain("Test info message")
		})

		it("should show error messages", async () => {
			await provider.showError("Test error message")

			const output = stderrOutput.join("")
			expect(output).toContain("Test error message")
		})

		it("should show warning messages", async () => {
			await provider.showWarning("Test warning message")

			const output = stdoutOutput.join("")
			expect(output).toContain("Test warning message")
		})

		it("should show messages with actions", async () => {
			const actions = [
				{ text: "Action 1", value: "action1" },
				{ text: "Action 2", value: "action2" },
			]

			// In non-interactive mode, should return undefined
			const result = await provider.showMessage("Choose action", actions)
			expect(result).toBeUndefined()
		})

		it("should handle message options", async () => {
			const actions = [{ text: "OK", value: "ok" }]
			const options = {
				modal: true,
				timeout: 1000,
			}

			await provider.showMessage("Test message", actions, options)

			const output = stdoutOutput.join("")
			expect(output).toContain("Test message")
		})
	})

	describe("progress reporting", () => {
		beforeEach(() => {
			provider = new CLIUserInterfaceProvider(false)
		})

		it("should show progress with callback", async () => {
			let progressReported = false
			let progressValue = 0
			let progressMessage = ""

			const result = await provider.showProgress("Test operation", async (progress) => {
				progress.report("Starting...")
				progressReported = true
				progressMessage = "Starting..."

				progress.report(50, "Halfway done")
				progressValue = 50

				progress.report(100, "Complete")
				return "operation result"
			})

			expect(result).toBe("operation result")
			expect(progressReported).toBe(true)
		})

		it("should handle progress with options", async () => {
			const options = {
				location: "notification" as const,
				cancellable: true,
			}

			const result = await provider.showProgress(
				"Test with options",
				async (progress) => {
					progress.report("Working...")
					return "done"
				},
				options,
			)

			expect(result).toBe("done")
		})

		it("should handle progress errors", async () => {
			const error = new Error("Progress error")

			await expect(
				provider.showProgress("Failing operation", async () => {
					throw error
				}),
			).rejects.toThrow("Progress error")
		})
	})

	describe("input handling", () => {
		beforeEach(() => {
			provider = new CLIUserInterfaceProvider(false) // Non-interactive
		})

		it("should handle input requests in non-interactive mode", async () => {
			const result = await provider.askQuestion("Enter value")
			expect(result).toBeUndefined() // Non-interactive should return undefined
		})

		it("should handle selection in non-interactive mode", async () => {
			const options = [
				{ label: "Option 1", value: "opt1" },
				{ label: "Option 2", value: "opt2" },
				{ label: "Option 3", value: "opt3" },
			]
			const result = await provider.askSelection("Choose option", options)
			expect(result).toBeUndefined()
		})

		it("should handle selection with objects", async () => {
			const options = [
				{ label: "Item 1", value: { id: "1", name: "First" }, description: "First item" },
				{ label: "Item 2", value: { id: "2", name: "Second" }, description: "Second item" },
			]

			const result = await provider.askSelection("Choose item", options)
			expect(result).toBeUndefined()
		})

		it("should handle multi-select", async () => {
			const options = [
				{ label: "A", value: "a" },
				{ label: "B", value: "b" },
				{ label: "C", value: "c" },
			]
			const result = await provider.askSelection("Choose multiple", options, {
				multiple: true,
			})
			expect(result).toBeUndefined()
		})
	})

	describe("confirmation dialogs", () => {
		beforeEach(() => {
			provider = new CLIUserInterfaceProvider(false)
		})

		it("should handle confirmation requests", async () => {
			const result = await provider.askConfirmation("Are you sure?")
			expect(typeof result).toBe("boolean")
		})

		it("should handle confirmation with options", async () => {
			const options = {
				defaultChoice: false,
				yesText: "Yes, delete",
				noText: "Cancel",
			}

			const result = await provider.askConfirmation("Delete file?", options)
			expect(typeof result).toBe("boolean")
		})
	})

	describe("file dialogs", () => {
		beforeEach(() => {
			provider = new CLIUserInterfaceProvider(false)
		})

		it("should handle file picker requests", async () => {
			const options = {
				multiple: false,
				filters: [{ name: "Text files", extensions: ["txt"] }],
				title: "Select file",
			}

			// In CLI mode, file dialogs typically return undefined or use fallback
			const result = await provider.openFilePicker(options)
			expect(result).toBeUndefined()
		})

		it("should handle folder picker requests", async () => {
			const options = {
				title: "Select folder",
				defaultPath: "/home/user",
			}

			const result = await provider.openFolderPicker(options)
			expect(result).toBeUndefined()
		})

		it("should handle save dialog requests", async () => {
			const options = {
				defaultName: "default.txt",
				filters: [{ name: "Text files", extensions: ["txt"] }],
			}

			const result = await provider.openSaveDialog(options)
			expect(result).toBeUndefined()
		})
	})

	describe("output handling", () => {
		beforeEach(() => {
			provider = new CLIUserInterfaceProvider(false)
		})

		it("should write to output", async () => {
			await provider.write("Test output message")

			const output = stdoutOutput.join("")
			expect(output).toContain("Test output message")
		})

		it("should write lines to output", async () => {
			await provider.writeLine("Line output")

			const output = stdoutOutput.join("")
			expect(output).toContain("Line output")
			expect(output).toContain("\n")
		})

		it("should write to output with options", async () => {
			const options = {
				color: "blue" as const,
				bold: true,
			}

			await provider.write("Formatted output", options)

			const output = stdoutOutput.join("")
			expect(output).toContain("Formatted output")
		})

		it("should clear output", async () => {
			await provider.write("Some output")
			await provider.clear()

			// After clearing, new output should work normally
			await provider.write("New output")
			const output = stdoutOutput.join("")
			expect(output).toContain("New output")
		})
	})

	describe("status handling", () => {
		beforeEach(() => {
			provider = new CLIUserInterfaceProvider(false)
		})

		it("should set status", async () => {
			await provider.setStatus("Working...")

			const output = stdoutOutput.join("")
			expect(output).toContain("Working...")
		})

		it("should set status with timeout", async () => {
			await provider.setStatus("Temporary status", 100)

			const output = stdoutOutput.join("")
			expect(output).toContain("Temporary status")
		})
	})

	describe("interactive mode", () => {
		it("should behave differently in interactive mode", () => {
			const interactiveProvider = new CLIUserInterfaceProvider(true)
			const nonInteractiveProvider = new CLIUserInterfaceProvider(false)

			expect(interactiveProvider.isInteractive()).toBe(true)
			expect(nonInteractiveProvider.isInteractive()).toBe(false)
		})

		it("should support interactive mode switching", () => {
			const provider = new CLIUserInterfaceProvider(false)
			expect(provider.isInteractive()).toBe(false)

			provider.setInteractive(true)
			expect(provider.isInteractive()).toBe(true)

			provider.setInteractive(false)
			expect(provider.isInteractive()).toBe(false)
		})
	})

	describe("formatting support", () => {
		beforeEach(() => {
			provider = new CLIUserInterfaceProvider(false)
		})

		it("should handle rich formatting when supported", async () => {
			if (provider.supportsRichFormatting()) {
				await provider.write("**Bold text** and *italic text*")
				// Rich formatting testing would depend on the actual implementation
			}
		})

		it("should format text with colors when supported", async () => {
			if (provider.supportsRichFormatting()) {
				await provider.write("Colored text", { color: "red" })
				// Color support testing would depend on the actual implementation
			}
		})
	})

	describe("error handling", () => {
		beforeEach(() => {
			provider = new CLIUserInterfaceProvider(false)
		})

		it("should handle output errors gracefully", async () => {
			// Mock stdout to throw an error
			process.stdout.write = vi.fn(() => {
				throw new Error("Output error")
			}) as any

			// Should not crash the application
			await expect(provider.write("Test")).rejects.toThrow("Output error")
		})

		it("should handle invalid input gracefully", async () => {
			// Test with invalid options
			await expect(provider.showInfo("")).resolves.not.toThrow()
			await expect(provider.askQuestion("")).resolves.not.toThrow()
		})
	})

	describe("resource cleanup", () => {
		it("should clean up resources properly", () => {
			provider = new CLIUserInterfaceProvider(true)

			// Test disposal
			expect(() => {
				provider.dispose()
			}).not.toThrow()
		})

		it("should handle multiple dispose calls", () => {
			provider = new CLIUserInterfaceProvider(true)

			provider.dispose()
			expect(() => {
				provider.dispose()
			}).not.toThrow()
		})
	})
})
