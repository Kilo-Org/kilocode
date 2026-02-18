import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code write_to_file Tool", function () {
	setDefaultSuiteTimeout(this)

	let tempDir: string
	let testFilePath: string

	// Create a temporary directory for test files
	suiteSetup(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-"))
	})

	// Clean up temporary directory after tests
	suiteTeardown(async () => {
		// Cancel any running tasks before cleanup
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	// Clean up test file before each test
	setup(async () => {
		// Cancel any previous task
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Generate unique file name for each test to avoid conflicts
		testFilePath = path.join(tempDir, `test-file-${Date.now()}.txt`)

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

		// Clean up the test file
		try {
			await fs.unlink(testFilePath)
		} catch {
			// File might not exist
		}

		// Small delay to ensure clean state
		await sleep(100)
	})

	test("Should create a new file with content", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const fileContent = "Hello, this is a test file!"
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
			// Start task with a simple prompt
			const baseFileName = path.basename(testFilePath)
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the write_to_file tool to create a file named "${baseFileName}" with the following content:\n${fileContent}`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the write_to_file tool was executed
			assert.ok(toolExecuted, "The write_to_file tool should have been executed")

			// Give time for file system operations
			await sleep(1000)

			// Check workspace directory for the file
			const workspaceDirs = await fs
				.readdir("/tmp")
				.then((files) => files.filter((f) => f.startsWith("roo-test-workspace-")))
				.catch(() => [])

			let fileFound = false
			let actualContent = ""

			for (const wsDir of workspaceDirs) {
				const wsFilePath = path.join("/tmp", wsDir, baseFileName)
				try {
					await fs.access(wsFilePath)
					actualContent = await fs.readFile(wsFilePath, "utf-8")
					fileFound = true
					console.log("File found in workspace:", wsFilePath)
					break
				} catch {
					// Continue checking
				}
			}

			assert.ok(fileFound, `File should have been created: ${baseFileName}`)
			assert.strictEqual(actualContent.trim(), fileContent, "File content should match")

			console.log("Test passed! File created successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should create nested directories when writing file", async function () {
		const api = globalThis.api
		const messages: ClineMessage[] = []
		const content = "File in nested directory"
		const fileName = `file-${Date.now()}.txt`
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
			// Start task to create file in nested directory
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowWrite: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the write_to_file tool to create a file at path "nested/deep/directory/${fileName}" with the following content:\n${content}`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the write_to_file tool was executed
			assert.ok(toolExecuted, "The write_to_file tool should have been executed")

			// Give time for file system operations
			await sleep(1000)

			// Check workspace directory for the file
			const workspaceDirs = await fs
				.readdir("/tmp")
				.then((files) => files.filter((f) => f.startsWith("roo-test-workspace-")))
				.catch(() => [])

			let fileFound = false
			let actualContent = ""

			for (const wsDir of workspaceDirs) {
				const wsNestedPath = path.join("/tmp", wsDir, "nested", "deep", "directory", fileName)
				try {
					await fs.access(wsNestedPath)
					actualContent = await fs.readFile(wsNestedPath, "utf-8")
					fileFound = true
					console.log("File found in nested directory:", wsNestedPath)
					break
				} catch {
					// Continue checking
				}
			}

			assert.ok(fileFound, `File should have been created in nested directory: ${fileName}`)
			assert.strictEqual(actualContent.trim(), content, "File content should match")

			console.log("Test passed! File created in nested directory successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})
})
