import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code list_files Tool", function () {
	setDefaultSuiteTimeout(this)

	let workspaceDir: string
	let testFiles: {
		rootFile1: string
		rootFile2: string
		nestedDir: string
		nestedFile1: string
		nestedFile2: string
		deepNestedDir: string
		deepNestedFile: string
		hiddenFile: string
		configFile: string
		readmeFile: string
	}

	// Create test files and directories before all tests
	suiteSetup(async () => {
		// Get workspace directory
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (!workspaceFolders || workspaceFolders.length === 0) {
			throw new Error("No workspace folder found")
		}
		workspaceDir = workspaceFolders[0]!.uri.fsPath
		console.log("Workspace directory:", workspaceDir)

		// Create test directory structure
		const testDirName = `list-files-test-${Date.now()}`
		const testDir = path.join(workspaceDir, testDirName)
		const nestedDir = path.join(testDir, "nested")
		const deepNestedDir = path.join(nestedDir, "deep")

		testFiles = {
			rootFile1: path.join(testDir, "root-file-1.txt"),
			rootFile2: path.join(testDir, "root-file-2.js"),
			nestedDir: nestedDir,
			nestedFile1: path.join(nestedDir, "nested-file-1.md"),
			nestedFile2: path.join(nestedDir, "nested-file-2.json"),
			deepNestedDir: deepNestedDir,
			deepNestedFile: path.join(deepNestedDir, "deep-nested-file.ts"),
			hiddenFile: path.join(testDir, ".hidden-file"),
			configFile: path.join(testDir, "config.yaml"),
			readmeFile: path.join(testDir, "README.md"),
		}

		// Create directories
		await fs.mkdir(testDir, { recursive: true })
		await fs.mkdir(nestedDir, { recursive: true })
		await fs.mkdir(deepNestedDir, { recursive: true })

		// Create root level files
		await fs.writeFile(testFiles.rootFile1, "This is root file 1 content")
		await fs.writeFile(
			testFiles.rootFile2,
			`function testFunction() {
	console.log("Hello from root file 2");
}`,
		)

		// Create nested files
		await fs.writeFile(
			testFiles.nestedFile1,
			`# Nested File 1

This is a markdown file in the nested directory.`,
		)
		await fs.writeFile(
			testFiles.nestedFile2,
			`{
	"name": "nested-config",
	"version": "1.0.0",
	"description": "Test configuration file"
}`,
		)

		// Create deep nested file
		await fs.writeFile(
			testFiles.deepNestedFile,
			`interface TestInterface {
	id: number;
	name: string;
}`,
		)

		// Create hidden file
		await fs.writeFile(testFiles.hiddenFile, "Hidden file content")

		// Create config file
		await fs.writeFile(
			testFiles.configFile,
			`app:
  name: test-app
  version: 1.0.0
database:
  host: localhost
  port: 5432`,
		)

		// Create README file
		await fs.writeFile(
			testFiles.readmeFile,
			`# List Files Test Directory

This directory contains various files and subdirectories for testing the list_files tool functionality.

## Structure
- Root files (txt, js)
- Nested directory with files (md, json)
- Deep nested directory with TypeScript file
- Hidden file
- Configuration files (yaml)`,
		)

		console.log("Test directory structure created:", testDir)
		console.log("Test files:", testFiles)
	})

	// Clean up test files and directories after all tests
	suiteTeardown(async () => {
		// Cancel any running tasks before cleanup
		try {
			await globalThis.api.cancelCurrentTask()
		} catch {
			// Task might not be running
		}

		// Clean up test directory structure
		const testDirName = path.basename(path.dirname(testFiles.rootFile1))
		const testDir = path.join(workspaceDir, testDirName)

		try {
			await fs.rm(testDir, { recursive: true, force: true })
			console.log("Cleaned up test directory:", testDir)
		} catch (error) {
			console.log("Failed to clean up test directory:", error)
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

	test("Should list files in a directory (non-recursive)", async function () {
		this.timeout(90_000) // Increase timeout for this specific test
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
			// Start task to list files in test directory
			const testDirName = path.basename(path.dirname(testFiles.rootFile1))
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the list_files tool with path="${testDirName}" and recursive=false, then tell me what you found.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 90_000 })

			// Verify the list_files tool was executed
			assert.ok(toolExecuted, "The list_files tool should have been executed")

			// Verify the AI mentioned some expected files in its response
			const hasFiles = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("root-file") ||
						m.text?.includes("config") ||
						m.text?.includes("README") ||
						m.text?.includes("nested")),
			)
			assert.ok(hasFiles, "AI should have mentioned the files found in the directory")

			console.log("Test passed! Directory listing (non-recursive) executed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should list files in a directory (recursive)", async function () {
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
			// Start task to list files recursively in test directory
			const testDirName = path.basename(path.dirname(testFiles.rootFile1))
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the list_files tool to list ALL contents of the directory "${testDirName}" recursively (set recursive to true). Tell me what files and directories you find, including any nested content.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the list_files tool was executed
			assert.ok(toolExecuted, "The list_files tool should have been executed")

			// Verify the AI mentioned files/directories in its response
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("nested") || m.text?.includes("file") || m.text?.includes("directory")),
			)
			assert.ok(hasContent, "AI should have mentioned the directory contents")

			console.log("Test passed! Directory listing (recursive) executed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should list symlinked files and directories", async function () {
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
			// Create a symlink test directory
			const testDirName = `symlink-test-${Date.now()}`
			const testDir = path.join(workspaceDir, testDirName)
			await fs.mkdir(testDir, { recursive: true })

			// Create a source directory with content
			const sourceDir = path.join(testDir, "source")
			await fs.mkdir(sourceDir, { recursive: true })
			const sourceFile = path.join(sourceDir, "source-file.txt")
			await fs.writeFile(sourceFile, "Content from symlinked file")

			// Create symlinks to file and directory
			const symlinkFile = path.join(testDir, "link-to-file.txt")
			const symlinkDir = path.join(testDir, "link-to-dir")

			try {
				await fs.symlink(sourceFile, symlinkFile)
				await fs.symlink(sourceDir, symlinkDir)
				console.log("Created symlinks successfully")
			} catch (symlinkError) {
				console.log("Symlink creation failed (might be platform limitation):", symlinkError)
				// Skip test if symlinks can't be created
				console.log("Skipping symlink test - platform doesn't support symlinks")
				return
			}

			// Start task to list files in symlink test directory
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the list_files tool to list the contents of the directory "${testDirName}". Tell me what you find.`,
			})

			console.log("Symlink test Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the list_files tool was executed
			assert.ok(toolExecuted, "The list_files tool should have been executed")

			// Verify the AI mentioned files/directories in its response
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("link") || m.text?.includes("source") || m.text?.includes("file")),
			)
			assert.ok(hasContent, "AI should have mentioned the directory contents")

			console.log("Test passed! Symlinked files and directories listed successfully")

			// Cleanup
			await fs.rm(testDir, { recursive: true, force: true })
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should list files in workspace root directory", async function () {
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
			// Start task to list files in workspace root
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the list_files tool to list the contents of the current workspace directory (use "." as the path). Tell me what you find.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the list_files tool was executed
			assert.ok(toolExecuted, "The list_files tool should have been executed")

			// Verify the AI mentioned workspace contents in its response
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("directory") || m.text?.includes("file") || m.text?.includes("list")),
			)
			assert.ok(hasContent, "AI should have mentioned workspace contents")

			console.log("Test passed! Workspace root directory listing executed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})
})
