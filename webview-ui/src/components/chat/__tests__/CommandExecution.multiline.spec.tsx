import React from "react"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { CommandExecution } from "../CommandExecution"
import { ExtensionStateContext } from "../../../context/ExtensionStateContext"

// Mock dependencies - must be hoisted before imports
vi.mock("react-use", () => ({
	useEvent: vi.fn(),
}))

// Mock the vscode API
vi.mock("../../../utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock CodeBlock component
vi.mock("../../kilocode/common/CodeBlock", () => {
	return {
		default: ({ source }: { source: string }) => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const React = require("react")
			return React.createElement("div", { "data-testid": "code-block" }, source)
		},
	}
})

// Mock CommandPatternSelector to check if it's rendered
vi.mock("../CommandPatternSelector", () => {
	return {
		CommandPatternSelector: ({ patterns }: any) => {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const React = require("react")
			if (!patterns || patterns.length === 0) return null
			return React.createElement(
				"div",
				{ "data-testid": "command-pattern-selector" },
				React.createElement("span", null, "chat:commandExecution.manageCommands"),
				patterns.map((pattern: any, index: number) =>
					React.createElement("span", { key: index }, pattern.pattern),
				),
			)
		},
	}
})

describe("CommandExecution - Multiline Commands", () => {
	// Mock ExtensionStateContext
	const mockExtensionState = {
		terminalShellIntegrationDisabled: true,
		allowedCommands: ["git", "npm"],
		deniedCommands: ["rm"],
		setAllowedCommands: vi.fn(),
		setDeniedCommands: vi.fn(),
	}

	const ExtensionStateWrapper = ({ children }: { children: React.ReactNode }) => (
		<ExtensionStateContext.Provider value={mockExtensionState as any}>{children}</ExtensionStateContext.Provider>
	)

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should not show pattern selector for multiline commands", () => {
		// A multiline command with actual newlines (not in quotes)
		const multilineCommand = `git add .
git commit -m "feat: update"
git push`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-1" text={multilineCommand} />
			</ExtensionStateWrapper>,
		)

		// The command should be displayed
		expect(screen.getByText(/git add/)).toBeInTheDocument()

		// But the pattern selector should not be shown
		// (The "Manage Commands" button should not exist)
		expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()
	})

	it("should show pattern selector for single-line commands", () => {
		// A single-line command
		const singleLineCommand = `git status`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-2" text={singleLineCommand} />
			</ExtensionStateWrapper>,
		)

		// The command should be displayed
		expect(screen.getByTestId("code-block")).toHaveTextContent("git status")

		// The pattern selector should be shown
		expect(screen.getByTestId("command-pattern-selector")).toBeInTheDocument()
		expect(screen.getByText("chat:commandExecution.manageCommands")).toBeInTheDocument()
	})

	it("should show pattern selector for commands with quoted newlines", () => {
		// A command with newlines inside quotes (should be treated as single-line)
		const quotedNewlineCommand = `git commit -m "feat: update\n\n- Added feature A\n- Fixed bug B"`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-3" text={quotedNewlineCommand} />
			</ExtensionStateWrapper>,
		)

		// The command should be displayed
		expect(screen.getByTestId("code-block")).toHaveTextContent("git commit")

		// The pattern selector should be shown (because newlines are within quotes)
		expect(screen.getByTestId("command-pattern-selector")).toBeInTheDocument()
		expect(screen.getByText("chat:commandExecution.manageCommands")).toBeInTheDocument()
	})

	it("should not show pattern selector for commands chained with && on multiple lines", () => {
		// Commands chained with && across multiple lines
		const chainedMultilineCommand = `npm install &&
npm run build &&
npm test`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-4" text={chainedMultilineCommand} />
			</ExtensionStateWrapper>,
		)

		// The command should be displayed
		expect(screen.getByText(/npm install/)).toBeInTheDocument()

		// The pattern selector should not be shown for multiline commands
		expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()
	})

	it("should show pattern selector for commands chained with && on single line", () => {
		// Commands chained with && on a single line
		const chainedSingleLineCommand = `npm install && npm run build && npm test`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-5" text={chainedSingleLineCommand} />
			</ExtensionStateWrapper>,
		)

		// The command should be displayed
		expect(screen.getByTestId("code-block")).toHaveTextContent("npm install && npm run build && npm test")

		// The pattern selector should be shown for single-line chained commands
		expect(screen.getByTestId("command-pattern-selector")).toBeInTheDocument()
		expect(screen.getByText("chat:commandExecution.manageCommands")).toBeInTheDocument()
	})

	it("should not show pattern selector for shell scripts with multiple lines", () => {
		// A shell script with multiple lines
		const shellScript = `for file in *.txt; do
	 echo "Processing $file"
	 cat "$file"
done`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-6" text={shellScript} />
			</ExtensionStateWrapper>,
		)

		// The command should be displayed
		expect(screen.getByText(/for file in/)).toBeInTheDocument()

		// The pattern selector should not be shown
		expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()
	})

	it("should not show pattern selector for heredoc commands", () => {
		// A heredoc command
		const heredocCommand = `cat << EOF > config.txt
line1
line2
line3
EOF`

		render(
			<ExtensionStateWrapper>
				<CommandExecution executionId="test-7" text={heredocCommand} />
			</ExtensionStateWrapper>,
		)

		// The command should be displayed
		expect(screen.getByText(/cat << EOF/)).toBeInTheDocument()

		// The pattern selector should not be shown
		expect(screen.queryByTestId("command-pattern-selector")).not.toBeInTheDocument()
	})
})
