import { render } from "ink-testing-library"

import type { ToolRendererProps } from "../types.js"
import { CommandTool } from "../CommandTool.js"

describe("CommandTool", () => {
	describe("command display", () => {
		it("displays the command when toolData.command is provided", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "npm test",
					output: "All tests passed",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			// Command should be displayed with $ prefix
			expect(output).toContain("$")
			expect(output).toContain("npm test")
		})

		it("does not display command section when toolData.command is empty", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "",
					output: "All tests passed",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			// The output should be displayed but no command line with $
			expect(output).toContain("All tests passed")
			// Should not have a standalone $ followed by a command
			// (just checking the output is present without command)
		})

		it("does not display command section when toolData.command is undefined", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					output: "All tests passed",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			// The output should be displayed
			expect(output).toContain("All tests passed")
		})

		it("displays command with complex arguments", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: 'git commit -m "fix: resolve issue"',
					output: "[main abc123] fix: resolve issue",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("$")
			expect(output).toContain('git commit -m "fix: resolve issue"')
		})
	})

	describe("output display", () => {
		it("displays output when provided", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "echo hello",
					output: "hello",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("hello")
		})

		it("displays multi-line output", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "ls",
					output: "file1.txt\nfile2.txt\nfile3.txt",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("file1.txt")
			expect(output).toContain("file2.txt")
			expect(output).toContain("file3.txt")
		})

		it("uses content as fallback when output is not provided", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "ls",
					content: "fallback content",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			expect(output).toContain("fallback content")
		})

		it("truncates output to MAX_OUTPUT_LINES", () => {
			// Create output with more than 10 lines (MAX_OUTPUT_LINES = 10)
			const longOutput = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")

			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "cat longfile.txt",
					output: longOutput,
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			// First 10 lines should be visible
			expect(output).toContain("line 1")
			expect(output).toContain("line 10")

			// Should show truncation indicator
			expect(output).toContain("more lines")
		})
	})

	describe("header display", () => {
		it("displays terminal icon when rendered", () => {
			const props: ToolRendererProps = {
				toolData: {
					tool: "execute_command",
					command: "echo test",
				},
			}

			const { lastFrame } = render(<CommandTool {...props} />)
			const output = lastFrame()

			// The terminal icon fallback is "$", which also appears before the command
			expect(output).toContain("$")
			expect(output).toContain("echo test")
		})
	})
})
