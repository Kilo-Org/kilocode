import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code apply_diff Tool", function () {
	// Testing with more capable AI model to see if it can handle apply_diff complexity
	setDefaultSuiteTimeout(this)

	let workspaceDir: string

	// Pre-created test files that will be used across tests
	const testFiles = {
		simpleModify: {
			name: `test-file-simple-${Date.now()}.txt`,
			content: "Hello World\nThis is a test file\nWith multiple lines",
			path: "",
		},
		multipleReplace: {
			name: `test-func-multiple-${Date.now()}.js`,
			content: `function calculate(x, y) {
	const sum = x + y
	const product = x * y
	return { sum: sum, product: product }
}`,
			path: "",
		},
		lineNumbers: {
			name: `test-lines-${Date.now()}.js`,
			content: `// Header comment
function oldFunction() {
	console.log("Old implementation")
}

// Another function
function keepThis() {
	console.log("Keep this")
}

// Footer comment`,
			path: "",
		},
		errorHandling: {
			name: `test-error-${Date.now()}.txt`,
			content: "Original content",
			path: "",
		},
		multiSearchReplace: {
			name: `test-multi-search-${Date.now()}.js`,
			content: `function processData(data) {
	console.log("Processing data")
	return data.map(item => item * 2)
}

// Some other code in between
const config = {
	timeout: 5000,
	retries: 3
}

function validateInput(input) {
	console.log("Validating input")
	if (!input) {
		throw new Error("Invalid input")
	}
	return true
}`,
			path: "",
		},
	}

	// Get the actual workspace directory that VSCode is using and create all test files
	suiteSetup(async function () {
		// Get the workspace folder from VSCode
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error("No workspace folder found")
		}
		workspaceDir = workspaceFolders[0]!.uri.fsPath
		console.log("Using workspace directory:", workspaceDir)

		// Create all test files before any tests run
		console.log("Creating test files in workspace...")
		for (const [key, file] of Object.entries(testFiles)) {
			file.path = path.join(workspaceDir, file.name)
			await fs.writeFile(file.path, file.content)
			console.log(`Created ${key} test file at:`, file.path)
		}

		// Verify all files exist
		for (const [key, file] of Object.entries(testFiles)) {
			const exists = await fs
				.access(file.path)
				.then(() => true)
				.catch(() => false)
			if (!exists) {
				throw new Error(`Failed to create ${key} test file at ${file.path}`)
			}
		}
	})

	// Clean up after all tests
	suiteTeardown(async () => {
		// Cancel any running tasks before cleanup
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Clean up all test files
		console.log("Cleaning up test files...")
		for (const [key, file] of Object.entries(testFiles)) {
			try {
				await fs.unlink(file.path)
				console.log(`Cleaned up ${key} test file`)
			} catch (error) {
				console.log(`Failed to clean up ${key} test file:`, error)
			}
		}
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

	test("Should apply diff to modify existing file content", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.simpleModify
		const expectedContent = "Hello Universe\nThis is a test file\nWith multiple lines"
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested")
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
			// Start task - let AI read the file first, then apply diff
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `The file ${testFile.name} exists in the workspace. Use the apply_diff tool to change "Hello World" to "Hello Universe" in this file.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 90_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The apply_diff tool should have been executed")

			// Give time for file system operations
			await sleep(1000)

			// Verify file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"File content should be modified correctly",
			)

			console.log("Test passed! File modified successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should apply multiple search/replace blocks in single diff", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.multipleReplace
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested")
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
			// Start task - let AI read file first
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `The file ${testFile.name} exists in the workspace. Use the apply_diff tool to rename the function "calculate" to "compute" and rename the parameters "x, y" to "a, b". Also rename the variables "sum" to "total" and "product" to "result" throughout the function.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion with longer timeout
			await waitFor(() => taskCompleted, { timeout: 90_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The apply_diff tool should have been executed")

			// Give time for file system operations
			await sleep(1000)

			// Verify file was modified - check key changes were made
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			assert.ok(
				actualContent.includes("function compute(a, b)"),
				"Function should be renamed to compute with params a, b",
			)
			assert.ok(actualContent.includes("const total = a + b"), "Variable sum should be renamed to total")
			assert.ok(actualContent.includes("const result = a * b"), "Variable product should be renamed to result")
			// Note: We don't strictly require object keys to be renamed as that's a reasonable interpretation difference

			console.log("Test passed! Multiple replacements applied successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should handle apply_diff with line number hints", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.lineNumbers
		const expectedContent = `// Header comment
function newFunction() {
	console.log("New implementation")
}

// Another function
function keepThis() {
	console.log("Keep this")
}

// Footer comment`
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested")
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
			// Start task - let AI read file first
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `The file ${testFile.name} exists in the workspace. Use the apply_diff tool to change the function name "oldFunction" to "newFunction" and update its console.log message to "New implementation". Keep the rest of the file unchanged.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion with longer timeout
			await waitFor(() => taskCompleted, { timeout: 90_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The apply_diff tool should have been executed")

			// Give time for file system operations
			await sleep(1000)

			// Verify file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			assert.strictEqual(
				actualContent.trim(),
				expectedContent.trim(),
				"Only specified function should be modified",
			)

			console.log("Test passed! Targeted modification successful")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should handle apply_diff errors gracefully", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.errorHandling
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested")
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
			// Start task with invalid search content
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `The file ${testFile.name} exists in the workspace with content "Original content". Use the apply_diff tool to replace "This content does not exist" with "New content".

IMPORTANT: The search pattern "This content does not exist" is NOT in the file. When apply_diff cannot find the search pattern, it should fail gracefully. Do NOT try to use write_to_file or any other tool.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify tool was attempted
			assert.ok(toolExecuted, "The apply_diff tool should have been attempted")

			// Give time for file system operations
			await sleep(1000)

			// Verify file content remains unchanged
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			assert.strictEqual(
				actualContent.trim(),
				testFile.content.trim(),
				"File content should remain unchanged when search pattern not found",
			)

			console.log("Test passed! Error handled gracefully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should apply multiple search/replace blocks to edit two separate functions", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const testFile = testFiles.multiSearchReplace
		const expectedContent = `function transformData(data) {
	console.log("Transforming data")
	return data.map(item => item * 2)
}

// Some other code in between
const config = {
	timeout: 5000,
	retries: 3
}

function checkInput(input) {
	console.log("Checking input")
	if (!input) {
		throw new Error("Invalid input")
	}
	return true
}`
		let taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for tool request
			if (message.type === "ask" && message.ask === "tool") {
				toolExecuted = true
				console.log("Tool requested")
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
			// Start task to edit two separate functions
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the apply_diff tool on the file ${testFile.name} to make these changes using TWO SEPARATE search/replace blocks within a SINGLE apply_diff call:

FIRST search/replace block: Edit the processData function to rename it to "transformData" and change "Processing data" to "Transforming data"

SECOND search/replace block: Edit the validateInput function to rename it to "checkInput" and change "Validating input" to "Checking input"

Important: Use multiple SEARCH/REPLACE blocks in one apply_diff call, NOT multiple apply_diff calls.

The file already exists with this content:
${testFile.content}

Assume the file exists and you can modify it directly.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The apply_diff tool should have been executed")

			// Give time for file system operations
			await sleep(1000)

			// Verify file was modified correctly
			const actualContent = await fs.readFile(testFile.path, "utf-8")
			assert.strictEqual(actualContent.trim(), expectedContent.trim(), "Both functions should be modified")

			console.log("Test passed! Multiple search/replace blocks applied successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})
})
