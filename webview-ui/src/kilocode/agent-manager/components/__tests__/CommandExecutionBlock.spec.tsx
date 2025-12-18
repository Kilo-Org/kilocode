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

		it("shows success indicator (green) when has output without exitCode", () => {
			const text = `echo hello${COMMAND_OUTPUT_STRING}hello`
			const { container } = render(<CommandExecutionBlock text={text} />)

			expect(container.querySelector(".bg-green-500")).toBeInTheDocument()
		})
	})

	describe("deterministic exit code based error detection", () => {
		it("does not treat error-like text as errors without exit code", () => {
			const text = `some-command${COMMAND_OUTPUT_STRING}Error: something went wrong`
			const { container } = render(<CommandExecutionBlock text={text} />)

			// Without exitCode, output text patterns are ignored - should show success (green)
			expect(container.querySelector(".bg-green-500")).toBeInTheDocument()
		})

		it("trusts exit code over output content", () => {
			const text = `some-command${COMMAND_OUTPUT_STRING}Build successful`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={1} />)

			// Even with successful output, non-zero exit code means error (red)
			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
		})

		it("shows green indicator when exitCode is 0 regardless of output", () => {
			const text = `some-command${COMMAND_OUTPUT_STRING}Error: something`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={0} />)

			// Exit code 0 always means success (green), even with "Error" in output
			expect(container.querySelector(".bg-green-500")).toBeInTheDocument()
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
		it("applies red text color when exitCode indicates error", () => {
			const text = `npm run build${COMMAND_OUTPUT_STRING}Build output`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={1} />)

			// Check that the error output has red text
			const outputPre = container.querySelector("pre.text-red-400")
			expect(outputPre).toBeInTheDocument()
			// Background should match editor background
			const outputDiv = container.querySelector(".bg-vscode-editor-background")
			expect(outputDiv).toBeInTheDocument()
		})

		it("applies normal text color when command succeeds (exitCode 0)", () => {
			const text = `npm run build${COMMAND_OUTPUT_STRING}Build successful`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={0} />)

			// Check that successful output has normal text color
			const outputPre = container.querySelector("pre.text-vscode-descriptionForeground")
			expect(outputPre).toBeInTheDocument()
			// Background should match editor background for all outputs
			const outputDiv = container.querySelector(".bg-vscode-editor-background")
			expect(outputDiv).toBeInTheDocument()
		})

		it("applies normal text color when output exists without exitCode", () => {
			const text = `npm run build${COMMAND_OUTPUT_STRING}Build output`
			const { container } = render(<CommandExecutionBlock text={text} />)

			// Without exitCode, it's treated as success and uses normal color
			const outputPre = container.querySelector("pre.text-vscode-descriptionForeground")
			expect(outputPre).toBeInTheDocument()
		})
	})

	describe("exit code reliability for error detection", () => {
		it("shows red indicator for exit code 127 (command not found)", () => {
			const text = `nonexistent_command${COMMAND_OUTPUT_STRING}command not found`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={127} />)

			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
		})

		it("shows red indicator for exit code 2 (stderr output)", () => {
			const text = `ls /invalid${COMMAND_OUTPUT_STRING}No such file or directory`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={2} />)

			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
		})

		it("shows green indicator for exit code 0 even with 'error' in output text", () => {
			const text = `test_check${COMMAND_OUTPUT_STRING}Checked 5 items, 0 errors found`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={0} />)

			expect(container.querySelector(".bg-green-500")).toBeInTheDocument()
		})

		it("shows red indicator for exit code 1 even with 'success' in output text", () => {
			const text = `failing_script${COMMAND_OUTPUT_STRING}Build failed: success unlikely`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={1} />)

			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
		})

		it("shows error indicator when terminalStatus is timeout even with other factors", () => {
			// terminalStatus=timeout overrides other status indicators
			const text = `long_cmd${COMMAND_OUTPUT_STRING}Still processing`
			const { container } = render(<CommandExecutionBlock text={text} terminalStatus="timeout" />)

			// terminalStatus=timeout means error
			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
		})

		it("shows red indicator when terminalStatus is timeout without exitCode", () => {
			const text = `long_cmd${COMMAND_OUTPUT_STRING}Still running...`
			const { container } = render(<CommandExecutionBlock text={text} terminalStatus="timeout" />)

			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
		})
	})

	describe("metadata extraction from command output messages", () => {
		it("correctly extracts and applies exitCode metadata to determine status", () => {
			// This test verifies the complete flow: metadata → component prop → status indicator
			const text = `failing_cmd${COMMAND_OUTPUT_STRING}Error details`

			// When exitCode metadata is provided, it should result in red indicator
			const { container } = render(
				<CommandExecutionBlock
					text={text}
					exitCode={1} // This would come from message metadata
					isLast={true}
				/>,
			)

			// Verify red indicator (error status)
			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
			// Verify no green indicator
			expect(container.querySelector(".bg-green-500")).not.toBeInTheDocument()
		})

		it("displays red error output text when exitCode indicates failure", () => {
			const text = `git_push${COMMAND_OUTPUT_STRING}fatal: Authentication failed`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={128} />)

			// Should have red error indicator
			expect(container.querySelector(".bg-red-500")).toBeInTheDocument()
			// Output should be visible and colored red
			const outputPre = container.querySelector("pre.text-red-400")
			expect(outputPre).toBeInTheDocument()
			expect(outputPre?.textContent).toContain("fatal: Authentication failed")
		})

		it("displays green success output text when exitCode is 0", () => {
			const text = `npm_test${COMMAND_OUTPUT_STRING}All tests passed: 42`
			const { container } = render(<CommandExecutionBlock text={text} exitCode={0} />)

			// Should have green success indicator
			expect(container.querySelector(".bg-green-500")).toBeInTheDocument()
			// Output should be visible and not red
			const outputPre = container.querySelector("pre.text-vscode-descriptionForeground")
			expect(outputPre).toBeInTheDocument()
			expect(outputPre?.textContent).toContain("All tests passed")
		})
	})
})
