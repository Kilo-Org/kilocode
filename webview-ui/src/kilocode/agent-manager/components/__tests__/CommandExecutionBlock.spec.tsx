import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { CommandExecutionBlock } from "../CommandExecutionBlock"
import { COMMAND_OUTPUT_STRING } from "@roo/combineCommandSequences"

// Mock react-i18next
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) => {
			const translations: Record<string, string> = {
				"messages.copyCommand": "Copy command",
				"messages.expandOutput": "Expand output",
				"messages.collapseOutput": "Collapse output",
			}
			return translations[key] || key
		},
	}),
	initReactI18next: { type: "3rdParty", init: () => {} },
}))

// Mock clipboard API
const mockClipboard = {
	writeText: vi.fn().mockResolvedValue(undefined),
}
Object.assign(navigator, { clipboard: mockClipboard })

describe("CommandExecutionBlock", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("parsing command and output", () => {
		it("renders command only when no output", () => {
			render(<CommandExecutionBlock text="ls -la" />)

			expect(screen.getByText("ls -la")).toBeInTheDocument()
		})

		it("renders command and output when both present", () => {
			const text = `echo hello${COMMAND_OUTPUT_STRING}hello`
			render(<CommandExecutionBlock text={text} />)

			expect(screen.getByText("echo hello")).toBeInTheDocument()
			expect(screen.getByText("hello")).toBeInTheDocument()
		})

		it("handles empty text gracefully", () => {
			const { container } = render(<CommandExecutionBlock text="" />)

			// Should render without crashing
			expect(container.querySelector(".bg-vscode-editor-background")).toBeInTheDocument()
		})

		it("cleans up command_output text from output", () => {
			const text = `npm run build${COMMAND_OUTPUT_STRING}command_output\nBuild successful`
			render(<CommandExecutionBlock text={text} />)

			expect(screen.getByText("npm run build")).toBeInTheDocument()
			expect(screen.getByText("Build successful")).toBeInTheDocument()
			// Should not show the literal "command_output" text
			expect(screen.queryByText(/^command_output$/)).not.toBeInTheDocument()
		})

		it("does not render output panel for ANSI-only output", () => {
			const text = `cmd${COMMAND_OUTPUT_STRING}\u001b[2J\u001b[H\u001b[2K`
			const { container } = render(<CommandExecutionBlock text={text} />)

			// Output pre has `text-xs` class, command pre does not.
			expect(container.querySelector("pre.text-xs")).not.toBeInTheDocument()
		})
	})

	describe("status indicators", () => {
		it("shows pending indicator (yellow) when no output and not running", () => {
			const { container } = render(<CommandExecutionBlock text="npm install" isRunning={false} />)

			expect(container.querySelector(".bg-yellow-500\\/70")).toBeInTheDocument()
		})

		it("shows running indicator (spinner) when isRunning and no output", () => {
			const { container } = render(<CommandExecutionBlock text="npm install" isRunning={true} />)

			expect(container.querySelector(".animate-spin")).toBeInTheDocument()
		})

		it("shows running indicator (spinner) when Output marker present and isLast but no output", () => {
			const text = `npm install\n${COMMAND_OUTPUT_STRING}`
			const { container } = render(<CommandExecutionBlock text={text} isLast={true} />)

			expect(container.querySelector(".animate-spin")).toBeInTheDocument()
		})

		it("shows error indicator (red) when exitCode is non-zero", () => {
			const text = `exit 1\n${COMMAND_OUTPUT_STRING}`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={1} />)

			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
		})

		it("shows success indicator (green) when exitCode is 0", () => {
			const text = `echo ok\n${COMMAND_OUTPUT_STRING}`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={0} />)

			expect(container.querySelector(".bg-green-500")).toBeInTheDocument()
		})

		it("shows success indicator (green) when Output marker present but not last and no output", () => {
			const text = `npm install\n${COMMAND_OUTPUT_STRING}`
			const { container } = render(<CommandExecutionBlock text={text} isLast={false} />)

			expect(container.querySelector(".bg-green-500")).toBeInTheDocument()
		})

		it("shows success indicator (green) when has output without errors", () => {
			const text = `echo hello${COMMAND_OUTPUT_STRING}hello`
			const { container } = render(<CommandExecutionBlock text={text} />)

			expect(container.querySelector(".bg-green-500")).toBeInTheDocument()
		})

		it("shows error indicator (red) when output contains error patterns", () => {
			const text = `npm run build${COMMAND_OUTPUT_STRING}Error: Build failed`
			const { container } = render(<CommandExecutionBlock text={text} />)

			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
		})
	})

	describe("error detection", () => {
		const errorPatterns = [
			"Error: something went wrong",
			"fatal: not a git repository",
			"command not found",
			"No such file or directory",
			"Permission denied",
			"cannot find module",
			"Unable to resolve",
			"Exception in thread",
			"Traceback (most recent call last)",
			"Segmentation fault",
			"panic: runtime error",
		]

		errorPatterns.forEach((errorOutput) => {
			it(`detects error pattern: ${errorOutput.substring(0, 30)}...`, () => {
				const text = `some-command${COMMAND_OUTPUT_STRING}${errorOutput}`
				const { container } = render(<CommandExecutionBlock text={text} />)

				// Should show red indicator for error
				expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
			})
		})
	})

	describe("copy button", () => {
		it("copies command to clipboard when clicked", async () => {
			render(<CommandExecutionBlock text="npm install" />)

			const copyButton = screen.getByTitle("Copy command")
			fireEvent.click(copyButton)

			await waitFor(() => {
				expect(mockClipboard.writeText).toHaveBeenCalledWith("npm install")
			})
		})

		it("shows check icon after copying", async () => {
			render(<CommandExecutionBlock text="npm install" />)

			const copyButton = screen.getByTitle("Copy command")
			fireEvent.click(copyButton)

			// Wait for the check icon to appear (indicates copy success)
			await waitFor(() => {
				expect(mockClipboard.writeText).toHaveBeenCalled()
			})
		})
	})

	describe("expand/collapse output", () => {
		it("shows expand button when there is output", () => {
			const text = `npm run build${COMMAND_OUTPUT_STRING}Build successful`
			render(<CommandExecutionBlock text={text} />)

			expect(screen.getByTitle("Collapse output")).toBeInTheDocument()
		})

		it("does not show expand button when no output", () => {
			render(<CommandExecutionBlock text="npm install" />)

			expect(screen.queryByTitle("Expand output")).not.toBeInTheDocument()
			expect(screen.queryByTitle("Collapse output")).not.toBeInTheDocument()
		})

		it("toggles output visibility when clicked", () => {
			const text = `npm run build${COMMAND_OUTPUT_STRING}Build successful`
			render(<CommandExecutionBlock text={text} />)

			// Initially expanded (shows "Collapse output")
			const toggleButton = screen.getByTitle("Collapse output")
			fireEvent.click(toggleButton)

			// Now collapsed (shows "Expand output")
			expect(screen.getByTitle("Expand output")).toBeInTheDocument()
		})
	})

	describe("output styling", () => {
		it("applies red text color when output contains errors", () => {
			const text = `npm run build${COMMAND_OUTPUT_STRING}Error: Build failed`
			const { container } = render(<CommandExecutionBlock text={text} />)

			// Check that the error output has red text
			const outputPre = container.querySelector("pre.text-red-400")
			expect(outputPre).toBeInTheDocument()
			// Background should be visibly darker
			const outputDiv = container.querySelector(".bg-black\\/40")
			expect(outputDiv).toBeInTheDocument()
		})

		it("applies normal text color when output is successful", () => {
			const text = `npm run build${COMMAND_OUTPUT_STRING}Build successful`
			const { container } = render(<CommandExecutionBlock text={text} />)

			// Check that successful output has normal text color
			const outputPre = container.querySelector("pre.text-vscode-descriptionForeground")
			expect(outputPre).toBeInTheDocument()
			// Background should be visibly darker for all outputs
			const outputDiv = container.querySelector(".bg-black\\/40")
			expect(outputDiv).toBeInTheDocument()
		})
	})
})
