import { render } from "ink-testing-library"

import type { TUIMessage } from "../../types.js"
import ChatHistoryItem from "../ChatHistoryItem.js"
import { resetNerdFontCache } from "../Icon.js"

describe("ChatHistoryItem", () => {
	beforeEach(() => {
		// Use fallback icons in tests so they render as visible characters
		process.env.ROOCODE_NERD_FONT = "0"
		resetNerdFontCache()
	})

	afterEach(() => {
		delete process.env.ROOCODE_NERD_FONT
		resetNerdFontCache()
	})

	describe("content sanitization", () => {
		it("sanitizes tabs in user messages", () => {
			const message: TUIMessage = {
				id: "1",
				role: "user",
				content: "function test() {\n\treturn true;\n}",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// Tabs should be replaced with 4 spaces
			expect(output).toContain("function test() {")
			expect(output).toContain("    return true;") // Tab replaced with 4 spaces
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in assistant messages", () => {
			const message: TUIMessage = {
				id: "2",
				role: "assistant",
				content: "Here's the code:\n\tconst x = 1;",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("    const x = 1;")
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in thinking messages", () => {
			const message: TUIMessage = {
				id: "3",
				role: "thinking",
				content: "Looking at:\n\tMarkdown example:\n\t```ts\n\t\tfunction foo() {}\n\t```",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// All tabs should be converted to spaces
			expect(output).not.toContain("\t")
			expect(output).toContain("    Markdown example:")
			expect(output).toContain("        function foo() {}") // Double-indented
		})

		it("sanitizes tabs in tool messages with parsed content", () => {
			// Tool messages parse JSON content to extract fields like 'content'
			const message: TUIMessage = {
				id: "4",
				role: "tool",
				content: JSON.stringify({
					tool: "read_file",
					path: "test.js",
					content: "function() {\n\treturn true;\n}",
				}),
				toolName: "read_file",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// The content inside the JSON should be sanitized
			expect(output).toContain("    return true;")
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in tool messages with toolDisplayOutput", () => {
			const message: TUIMessage = {
				id: "5",
				role: "tool",
				content: "raw content",
				toolDisplayOutput: "function() {\n\treturn;\n}",
				toolName: "execute_command",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// toolDisplayOutput should be used and sanitized
			expect(output).toContain("    return;")
			expect(output).not.toContain("\t")
		})

		it("sanitizes tabs in system messages", () => {
			const message: TUIMessage = {
				id: "6",
				role: "system",
				content: "System info:\n\tCPU: high",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("    CPU: high")
			expect(output).not.toContain("\t")
		})

		it("strips carriage returns from content", () => {
			const message: TUIMessage = {
				id: "7",
				role: "thinking",
				content: "Line 1\r\nLine 2\rLine 3",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// Carriage returns should be stripped
			expect(output).not.toContain("\r")
			expect(output).toContain("Line 1")
			expect(output).toContain("Line 2")
			expect(output).toContain("Line 3")
		})

		it("strips carriage returns from toolDisplayOutput", () => {
			const message: TUIMessage = {
				id: "8",
				role: "tool",
				content: "raw",
				toolDisplayOutput: "Output\r\nwith\rCR",
				toolName: "test_tool",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).not.toContain("\r")
		})

		it("handles content with both tabs and carriage returns", () => {
			const message: TUIMessage = {
				id: "9",
				role: "thinking",
				content: "Code:\r\n\tfunction() {\r\n\t\treturn;\r\n\t}",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// Both should be sanitized
			expect(output).not.toContain("\t")
			expect(output).not.toContain("\r")
			expect(output).toContain("    function()")
			expect(output).toContain("        return;") // Double-indented
		})
	})

	describe("message rendering", () => {
		it("renders user messages with correct header", () => {
			const message: TUIMessage = {
				id: "1",
				role: "user",
				content: "Hello",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("You said:")
			expect(output).toContain("Hello")
		})

		it("renders assistant messages with correct header", () => {
			const message: TUIMessage = {
				id: "2",
				role: "assistant",
				content: "Hi there",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("Roo said:")
			expect(output).toContain("Hi there")
		})

		it("renders thinking messages with correct header", () => {
			const message: TUIMessage = {
				id: "3",
				role: "thinking",
				content: "Let me think...",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("Roo is thinking:")
			expect(output).toContain("Let me think...")
		})

		it("renders tool messages with icon and tool display name", () => {
			const message: TUIMessage = {
				id: "4",
				role: "tool",
				content: JSON.stringify({ tool: "read_file", path: "test.txt", content: "Output text" }),
				toolName: "read_file",
				toolDisplayName: "Read File",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// ToolDisplay (fallback without toolData) shows display name without icon
			expect(output).toContain("Read File")
			expect(output).toContain("Output text")
		})

		it("renders tool messages with path indicator for file tools", () => {
			const message: TUIMessage = {
				id: "5",
				role: "tool",
				content: JSON.stringify({ tool: "read_file", path: "src/test.ts", content: "file content" }),
				toolName: "read_file",
				toolDisplayName: "Read File",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("file:")
			expect(output).toContain("src/test.ts")
		})

		it("renders tool messages with directory path indicator for list tools", () => {
			const message: TUIMessage = {
				id: "6",
				role: "tool",
				content: JSON.stringify({ tool: "listFilesRecursive", path: "src/", content: "file1\nfile2" }),
				toolName: "listFilesRecursive",
				toolDisplayName: "List Files",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("dir:")
			expect(output).toContain("src/")
		})

		it("shows outside workspace warning when applicable", () => {
			const message: TUIMessage = {
				id: "7",
				role: "tool",
				content: JSON.stringify({
					tool: "read_file",
					path: "/etc/hosts",
					isOutsideWorkspace: true,
					content: "hosts file",
				}),
				toolName: "read_file",
				toolDisplayName: "Read File",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("outside workspace")
		})

		it("uses fallback content when message.content is empty", () => {
			const message: TUIMessage = {
				id: "8",
				role: "assistant",
				content: "",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			expect(output).toContain("...")
		})

		it("returns null for unknown role", () => {
			const message = {
				id: "9",
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				role: "unknown" as any,
				content: "Test",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			expect(lastFrame()).toBe("")
		})

		it("renders command tools with command icon", () => {
			const message: TUIMessage = {
				id: "10",
				role: "tool",
				content: JSON.stringify({ tool: "execute_command" }),
				toolName: "execute_command",
				toolDisplayName: "Execute Command",
				toolDisplayOutput: "command output",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// ToolDisplay (fallback without toolData) shows display name without icon
			expect(output).toContain("Execute Command")
			expect(output).toContain("command output")
		})

		it("renders search tools with search icon", () => {
			const message: TUIMessage = {
				id: "11",
				role: "tool",
				content: JSON.stringify({ tool: "search_files" }),
				toolName: "search_files",
				toolDisplayName: "Search Files",
				toolDisplayOutput: "search results",
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// ToolDisplay (fallback without toolData) shows display name without icon
			expect(output).toContain("Search Files")
		})

		it("renders attempt_completion tool with CompletionTool renderer", () => {
			const message: TUIMessage = {
				id: "12",
				role: "tool",
				content: JSON.stringify({
					tool: "attempt_completion",
					result: "I've completed the task successfully.",
				}),
				toolName: "attempt_completion",
				toolDisplayName: "Task Complete",
				toolDisplayOutput: "✅ I've completed the task successfully.",
				toolData: {
					tool: "attempt_completion",
					result: "I've completed the task successfully.",
				},
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// CompletionTool renders the result content directly without icon or header
			expect(output).toContain("I've completed the task successfully.")
		})

		it("renders ask_followup_question tool with CompletionTool renderer", () => {
			const message: TUIMessage = {
				id: "13",
				role: "tool",
				content: JSON.stringify({ tool: "ask_followup_question", question: "What color would you like?" }),
				toolName: "ask_followup_question",
				toolDisplayName: "Question",
				toolDisplayOutput: "❓ What color would you like?",
				toolData: {
					tool: "ask_followup_question",
					question: "What color would you like?",
				},
			}

			const { lastFrame } = render(<ChatHistoryItem message={message} />)
			const output = lastFrame()

			// CompletionTool renders the question content directly without icon or header
			expect(output).toContain("What color would you like?")
		})
	})
})
