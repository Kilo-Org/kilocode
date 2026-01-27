import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { sleep, waitUntilCompleted } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code execute_command Tool", function () {
	setDefaultSuiteTimeout(this)

	let workspaceDir: string

	// Pre-created test files that will be used across tests
	const testFiles = {
		simpleEcho: {
			name: `test-echo-${Date.now()}.txt`,
			content: "",
			path: "",
		},
		multiCommand: {
			name: `test-multi-${Date.now()}.txt`,
			content: "",
			path: "",
		},
		cwdTest: {
			name: `test-cwd-${Date.now()}.txt`,
			content: "",
			path: "",
		},
		longRunning: {
			name: `test-long-${Date.now()}.txt`,
			content: "",
			path: "",
		},
	}

	// Create test files before all tests
	suiteSetup(async () => {
		// Get workspace directory
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error("No workspace folder found")
		}
		workspaceDir = workspaceFolders[0]!.uri.fsPath
		console.log("Workspace directory:", workspaceDir)

		// Create test files
		for (const [key, file] of Object.entries(testFiles)) {
			file.path = path.join(workspaceDir, file.name)
			if (file.content) {
				await fs.writeFile(file.path, file.content)
				console.log(`Created ${key} test file at:`, file.path)
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

		// Clean up subdirectory if created
		try {
			const subDir = path.join(workspaceDir, "test-subdir")
			await fs.rmdir(subDir)
		} catch {
			// Directory might not exist
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

	test("Should execute pwd command to get current directory", async function () {
		this.timeout(90_000)
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for command request (execute_command uses "command" not "tool")
			if (message.type === "ask" && message.ask === "command") {
				toolExecuted = true
				console.log("✓ execute_command requested!")
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				_taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task - pwd can only be done with execute_command
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					terminalShellIntegrationDisabled: true,
				},
				text: `Use the execute_command tool to run the "pwd" command and tell me what the current working directory is.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitUntilCompleted({ api, taskId, timeout: 90_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The execute_command tool should have been executed")

			// Verify AI mentioned a directory path
			const hasPath = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("/tmp/roo-test-workspace") || m.text?.includes("directory")),
			)
			assert.ok(hasPath, "AI should have mentioned the working directory")

			console.log("Test passed! pwd command executed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should execute date command to get current timestamp", async function () {
		this.timeout(90_000)
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for command request (execute_command uses "command" not "tool")
			if (message.type === "ask" && message.ask === "command") {
				toolExecuted = true
				console.log("✓ execute_command requested!")
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				_taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task - date command can only be done with execute_command
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					terminalShellIntegrationDisabled: true,
				},
				text: `Use the execute_command tool to run the "date" command and tell me what the current date and time is.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitUntilCompleted({ api, taskId, timeout: 90_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The execute_command tool should have been executed")

			// Verify AI mentioned date/time information
			const hasDateTime = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.match(/\d{4}/) ||
						m.text?.toLowerCase().includes("202") ||
						m.text?.toLowerCase().includes("time")),
			)
			assert.ok(hasDateTime, "AI should have mentioned date/time information")

			console.log("Test passed! date command executed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should execute ls command to list directory contents", async function () {
		this.timeout(90_000)
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for command request (execute_command uses "command" not "tool")
			if (message.type === "ask" && message.ask === "command") {
				toolExecuted = true
				console.log("✓ execute_command requested!")
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				_taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task - ls can only be done with execute_command
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					terminalShellIntegrationDisabled: true,
				},
				text: `Use the execute_command tool to run "ls -la" and tell me what files and directories you see.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitUntilCompleted({ api, taskId, timeout: 90_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The execute_command tool should have been executed")

			// Verify AI mentioned directory contents
			const hasListing = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("file") || m.text?.includes("directory") || m.text?.includes("drwx")),
			)
			assert.ok(hasListing, "AI should have mentioned directory listing")

			console.log("Test passed! ls command executed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should execute whoami command to get current user", async function () {
		this.timeout(90_000)
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let toolExecuted = false

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for command request (execute_command uses "command" not "tool")
			if (message.type === "ask" && message.ask === "command") {
				toolExecuted = true
				console.log("✓ execute_command requested!")
			}
		}
		api.on(RooCodeEventName.Message, messageHandler)

		// Listen for task completion
		const taskCompletedHandler = (id: string) => {
			if (id === taskId) {
				_taskCompleted = true
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		let taskId: string
		try {
			// Start task - whoami can only be done with execute_command
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowExecute: true,
					allowedCommands: ["*"],
					terminalShellIntegrationDisabled: true,
				},
				text: `Use the execute_command tool to run "whoami" and tell me what user account is running.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitUntilCompleted({ api, taskId, timeout: 90_000 })

			// Verify tool was executed
			assert.ok(toolExecuted, "The execute_command tool should have been executed")

			// Verify AI mentioned a username
			const hasUser = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					m.text &&
					m.text.length > 5,
			)
			assert.ok(hasUser, "AI should have mentioned the username")

			console.log("Test passed! whoami command executed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})
})
