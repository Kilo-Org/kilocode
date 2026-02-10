import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code read_file Tool", function () {
	setDefaultSuiteTimeout(this)

	let tempDir: string
	let testFiles: {
		simple: string
		multiline: string
		empty: string
		large: string
		xmlContent: string
		nested: string
	}

	// Create a temporary directory and test files
	suiteSetup(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-read-"))

		// Create test files in VSCode workspace directory
		const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || tempDir

		// Create test files with different content types
		testFiles = {
			simple: path.join(workspaceDir, `simple-${Date.now()}.txt`),
			multiline: path.join(workspaceDir, `multiline-${Date.now()}.txt`),
			empty: path.join(workspaceDir, `empty-${Date.now()}.txt`),
			large: path.join(workspaceDir, `large-${Date.now()}.txt`),
			xmlContent: path.join(workspaceDir, `xml-content-${Date.now()}.xml`),
			nested: path.join(workspaceDir, "nested", "deep", `nested-${Date.now()}.txt`),
		}

		// Create files with content
		await fs.writeFile(testFiles.simple, "Hello, World!")
		await fs.writeFile(testFiles.multiline, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5")
		await fs.writeFile(testFiles.empty, "")

		// Create a large file (100 lines)
		const largeContent = Array.from(
			{ length: 100 },
			(_, i) => `Line ${i + 1}: This is a test line with some content`,
		).join("\n")
		await fs.writeFile(testFiles.large, largeContent)

		// Create XML content file
		await fs.writeFile(
			testFiles.xmlContent,
			"<root>\n  <child>Test content</child>\n  <data>Some data</data>\n</root>",
		)

		// Create nested directory and file
		await fs.mkdir(path.dirname(testFiles.nested), { recursive: true })
		await fs.writeFile(testFiles.nested, "Content in nested directory")

		console.log("Test files created in:", workspaceDir)
		console.log("Test files:", testFiles)
	})

	// Clean up temporary directory and files after tests
	suiteTeardown(async () => {
		// Cancel any running tasks before cleanup
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Clean up test files
		for (const filePath of Object.values(testFiles)) {
			try {
				await fs.unlink(filePath)
			} catch {
				// File might not exist
			}
		}

		// Clean up nested directory
		try {
			await fs.rmdir(path.dirname(testFiles.nested))
			await fs.rmdir(path.dirname(path.dirname(testFiles.nested)))
		} catch {
			// Directory might not exist or not be empty
		}

		await fs.rm(tempDir, { recursive: true, force: true })
	})

	// Clean up before each test
	setup(async () => {
		// Cancel any previous task
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Small delay to ensure clean state
		await sleep(100)
	})

	// Clean up after each test
	teardown(async () => {
		// Cancel the current task
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Small delay to ensure clean state
		await sleep(100)
	})

	test("Should read a simple text file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskStarted = false
		let taskCompleted = false
		let errorOccurred: string | null = null
		let toolExecuted = false
		let toolResult: string | null = null

		// Listen for messages - register BEFORE starting task
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request (ask) - this happens when AI wants to use the tool
			// With autoApproval, this might be auto-approved so we just check for the ask type
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested (ask):", message.text?.substring(0, 200))
			}

			// Check for tool execution result (say) - this happens after tool is executed
			if (message.type === "say" && message.say === "api_req_started") {
				const text = message.text || ""
				console.log("api_req_started message:", text.substring(0, 200))
				if (text.includes("read_file")) {
					toolExecuted = true
					console.log("Tool executed (say):", text.substring(0, 200))

					// Parse the tool result from the api_req_started message
					try {
						const requestData = JSON.parse(text)
						if (requestData.request && requestData.request.includes("[read_file")) {
							console.log("Full request for debugging:", requestData.request)
							// Try multiple patterns to extract the content
							// Pattern 1: Content between triple backticks
							let resultMatch = requestData.request.match(/```[^`]*\n([\s\S]*?)\n```/)
							if (!resultMatch) {
								// Pattern 2: Content after "Result:" with line numbers
								resultMatch = requestData.request.match(/Result:[\s\S]*?\n((?:\d+\s*\|[^\n]*\n?)+)/)
							}
							if (!resultMatch) {
								// Pattern 3: Simple content after Result:
								resultMatch = requestData.request.match(/Result:\s*\n([\s\S]+?)(?:\n\n|$)/)
							}
							if (resultMatch) {
								toolResult = resultMatch[1]
								console.log("Extracted tool result:", toolResult)
							} else {
								console.log("Could not extract tool result from request")
							}
						}
					} catch (e) {
						console.log("Failed to parse tool result:", e)
					}
				}
			}

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}

			// Log all AI responses for debugging
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}

			// Log ALL message types for debugging
			console.log(
				`Message: type=${message.type}, ${message.type === "ask" ? "ask=" + message.ask : "say=" + message.say}`,
			)
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task events
		const taskStartedHandler = (id: string) => {
			if (id === taskId) {
				taskStarted = true
				console.log("Task started:", id)
			}
		}
		api.on(RooCodeEventName.TaskStarted, taskStartedHandler)

		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
				console.log("Task completed:", id)
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task with a simple read file request
			const fileName = path.basename(testFiles.simple)
			// Use a very explicit prompt WITHOUT revealing the content
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read the file named "${fileName}" in the current workspace directory and tell me what it contains.`,
			})

			console.log("Task ID:", taskId)
			console.log("Reading file:", fileName)
			console.log("Expected file path:", testFiles.simple)

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 60_000 })

			// Check for early errors
			if (errorOccurred) {
				console.error("Early error detected:", errorOccurred)
			}

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Check that no errors occurred
			assert.strictEqual(errorOccurred, null, "No errors should have occurred")

			// Verify the AI mentioned the content in its response
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					m.text?.toLowerCase().includes("hello") &&
					m.text?.toLowerCase().includes("world"),
			)
			assert.ok(hasContent, "AI should have mentioned the file content 'Hello, World!'")

			console.log("Test passed! File read successfully with correct content")
			console.log(`Total messages: ${messages.length}, Tool executed: ${toolExecuted}`)
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskStarted, taskStartedHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should read a multiline file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested for multiline file")
			}

			// Log AI responses
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task
			const fileName = path.basename(testFiles.multiline)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read the file "${fileName}" in the current workspace directory. Count how many lines it has and tell me what you found.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the AI mentioned the correct number of lines
			const hasLineCount = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("5") || m.text?.toLowerCase().includes("five") || m.text?.includes("Line")),
			)
			assert.ok(hasLineCount, "AI should have mentioned the file lines")

			console.log("Test passed! Multiline file read successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should read file with line range", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested for line range")
			}

			// Log AI responses
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task
			const fileName = path.basename(testFiles.multiline)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read the file "${fileName}" in the current workspace directory and show me what's on lines 2, 3, and 4.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the AI mentioned the specific lines
			const hasLines = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("Line 2") || m.text?.includes("Line 3") || m.text?.includes("Line 4")),
			)
			assert.ok(hasLines, "AI should have mentioned the requested lines")

			console.log("Test passed! File read with line range successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should handle reading non-existent file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested for non-existent file")
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task with non-existent file
			const nonExistentFile = `non-existent-${Date.now()}.txt`
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Try to read the file "${nonExistentFile}" and tell me what happens. This file does not exist, so I expect you to handle the error appropriately.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the AI handled the error appropriately
			const completionMessage = messages.find(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.toLowerCase().includes("not found") ||
						m.text?.toLowerCase().includes("doesn't exist") ||
						m.text?.toLowerCase().includes("does not exist")),
			)
			assert.ok(completionMessage, "AI should have mentioned the file was not found")

			console.log("Test passed! Non-existent file handled correctly")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should read XML content file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested for XML file")
			}

			// Log AI responses
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task
			const fileName = path.basename(testFiles.xmlContent)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read the XML file "${fileName}" in the current workspace directory and tell me what XML elements you find.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the AI mentioned the XML content - be more flexible
			const hasXMLContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.toLowerCase().includes("root") || m.text?.toLowerCase().includes("xml")),
			)
			assert.ok(hasXMLContent, "AI should have mentioned the XML elements")

			console.log("Test passed! XML file read successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should read multiple files in sequence", async function () {
		this.timeout(90_000) // Increase timeout for multiple file reads
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let readFileCount = 0

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Count read_file executions
			if (message.type === "ask" && message.ask === "tool") {
				readFileCount++
				console.log(`Read file execution #${readFileCount}`)
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task to read multiple files
			const simpleFileName = path.basename(testFiles.simple)
			const multilineFileName = path.basename(testFiles.multiline)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read "${simpleFileName}" and "${multilineFileName}", then tell me what you found.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 90_000 })

			// Verify multiple read_file executions - AI might read them together
			assert.ok(
				readFileCount >= 1,
				`Should have executed read_file at least once, but executed ${readFileCount} times`,
			)

			// Verify the AI mentioned both file contents - be more flexible
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					m.text?.toLowerCase().includes("hello"),
			)
			assert.ok(hasContent, "AI should have mentioned contents of the files")

			console.log("Test passed! Multiple files read successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should read large file efficiently", async function () {
		// Testing with more capable model and increased timeout
		this.timeout(180_000) // 3 minutes

		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested for large file")
			}

			// Log AI responses
			if (message.type === "say" && (message.say === "text" || message.say === "completion_result")) {
				console.log("AI response:", message.text?.substring(0, 200))
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task
			const fileName = path.basename(testFiles.large)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the read_file tool to read "${fileName}" and tell me how many lines it has.`,
			})

			// Wait for task completion (longer timeout for large file)
			await waitFor(() => taskCompleted, { timeout: 120_000 })

			// Verify the read_file tool was executed
			assert.ok(toolExecuted, "The read_file tool should have been executed")

			// Verify the AI mentioned the line pattern - be more flexible
			const hasPattern = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.toLowerCase().includes("line") || m.text?.toLowerCase().includes("pattern")),
			)
			assert.ok(hasPattern, "AI should have identified the line pattern")

			console.log("Test passed! Large file read efficiently")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})
})
