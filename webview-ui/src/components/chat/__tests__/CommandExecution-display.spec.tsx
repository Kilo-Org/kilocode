import { describe, it, expect } from "vitest"
import { render } from "@testing-library/react"
import { CommandExecution } from "../CommandExecution"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext"
import { TooltipProvider } from "@src/components/ui/tooltip"

describe("CommandExecution - Display Fix", () => {
	const mockExtensionState = {
		terminalShellIntegrationDisabled: true,
		allowedCommands: [],
		deniedCommands: [],
		setAllowedCommands: () => {},
		setDeniedCommands: () => {},
	}

	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<TooltipProvider>
			<ExtensionStateContextProvider {...(mockExtensionState as any)}>{children}</ExtensionStateContextProvider>
		</TooltipProvider>
	)

	it("should display newlines correctly in git commit messages", () => {
		const commandText = 'git commit -m "feat: title\n\n- point a\n- point b"'

		const { container } = render(<CommandExecution executionId="test-1" text={commandText} />, { wrapper })

		// The command should be displayed with actual newlines, not placeholders
		const codeBlock = container.querySelector("code")
		expect(codeBlock?.textContent).toContain("feat: title")
		expect(codeBlock?.textContent).not.toContain("___NEWLINE___")
		expect(codeBlock?.textContent).not.toContain("___CARRIAGE_RETURN___")
	})

	it("should not show multi-line commands in pattern selector", async () => {
		const commandText =
			'echo "ACT I Scene 1: A Digital Stage\n[The curtain rises on an empty terminal]\n[A lone cursor blinks in the darkness]"'

		const { container } = render(<CommandExecution executionId="test-4" text={commandText} />, { wrapper })

		// The command display should show the full command with newlines
		const codeBlock = container.querySelector("code")
		expect(codeBlock?.textContent).toContain("ACT I Scene 1")

		// Expand the pattern selector
		const expandButton =
			container.querySelector('button[aria-label*="manage"]') || container.querySelector("button:has(svg)")
		if (expandButton) {
			;(expandButton as HTMLButtonElement).click()
		}

		// Wait a bit for the expansion
		await new Promise((resolve) => setTimeout(resolve, 100))

		// The pattern selector should only show "echo", not the full multi-line command
		const patternElements = container.querySelectorAll(".font-mono.text-xs")
		const patternTexts = Array.from(patternElements).map((el) => el.textContent?.trim())

		// Should have "echo" pattern
		expect(patternTexts.some((text) => text === "echo")).toBe(true)

		// Should NOT have the full multi-line command
		expect(patternTexts.some((text) => text && text.includes("ACT I Scene 1"))).toBe(false)
		expect(patternTexts.some((text) => text && text.includes("\n"))).toBe(false)
	})

	it("should display CRLF correctly", () => {
		const commandText = 'echo "hello\r\nworld"'

		const { container } = render(<CommandExecution executionId="test-2" text={commandText} />, { wrapper })

		// Just verify the component renders without errors
		expect(container).toBeTruthy()
		// Verify no placeholders are visible in the rendered output
		expect(container.innerHTML).not.toContain("___NEWLINE___")
		expect(container.innerHTML).not.toContain("___CARRIAGE_RETURN___")
	})
})
