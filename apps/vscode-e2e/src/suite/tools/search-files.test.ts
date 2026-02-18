import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code search_files Tool", function () {
	setDefaultSuiteTimeout(this)

	let workspaceDir: string
	let testFiles: {
		jsFile: string
		tsFile: string
		jsonFile: string
		textFile: string
		nestedJsFile: string
		configFile: string
		readmeFile: string
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

		// Create test files with different content types
		testFiles = {
			jsFile: path.join(workspaceDir, `test-search-${Date.now()}.js`),
			tsFile: path.join(workspaceDir, `test-search-${Date.now()}.ts`),
			jsonFile: path.join(workspaceDir, `test-config-${Date.now()}.json`),
			textFile: path.join(workspaceDir, `test-readme-${Date.now()}.txt`),
			nestedJsFile: path.join(workspaceDir, "search-test", `nested-${Date.now()}.js`),
			configFile: path.join(workspaceDir, `app-config-${Date.now()}.yaml`),
			readmeFile: path.join(workspaceDir, `README-${Date.now()}.md`),
		}

		// Create JavaScript file with functions
		await fs.writeFile(
			testFiles.jsFile,
			`function calculateTotal(items) {
	return items.reduce((sum, item) => sum + item.price, 0)
}

function validateUser(user) {
	if (!user.email || !user.name) {
		throw new Error("Invalid user data")
	}
	return true
}

// TODO: Add more validation functions
const API_URL = "https://api.example.com"
export { calculateTotal, validateUser }`,
		)

		// Create TypeScript file with interfaces
		await fs.writeFile(
			testFiles.tsFile,
			`interface User {
	id: number
	name: string
	email: string
	isActive: boolean
}

interface Product {
	id: number
	title: string
	price: number
	category: string
}

class UserService {
	async getUser(id: number): Promise<User> {
		// TODO: Implement user fetching
		throw new Error("Not implemented")
	}
	
	async updateUser(user: User): Promise<void> {
		// Implementation here
	}
}

export { User, Product, UserService }`,
		)

		// Create JSON configuration file
		await fs.writeFile(
			testFiles.jsonFile,
			`{
	"name": "test-app",
	"version": "1.0.0",
	"description": "A test application for search functionality",
	"main": "index.js",
	"scripts": {
		"start": "node index.js",
		"test": "jest",
		"build": "webpack"
	},
	"dependencies": {
		"express": "^4.18.0",
		"lodash": "^4.17.21"
	},
	"devDependencies": {
		"jest": "^29.0.0",
		"webpack": "^5.0.0"
	}
}`,
		)

		// Create text file with documentation
		await fs.writeFile(
			testFiles.textFile,
			`# Project Documentation

This is a test project for demonstrating search functionality.

## Features
- User management
- Product catalog
- Order processing
- Payment integration

## Installation
1. Clone the repository
2. Run npm install
3. Configure environment variables
4. Start the application

## API Endpoints
- GET /users - List all users
- POST /users - Create new user
- PUT /users/:id - Update user
- DELETE /users/:id - Delete user

## TODO
- Add authentication
- Implement caching
- Add error handling
- Write more tests`,
		)

		// Create nested directory and file
		await fs.mkdir(path.dirname(testFiles.nestedJsFile), { recursive: true })
		await fs.writeFile(
			testFiles.nestedJsFile,
			`// Nested utility functions
function formatCurrency(amount) {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD'
	}).format(amount)
}

function debounce(func, wait) {
	let timeout
	return function executedFunction(...args) {
		const later = () => {
			clearTimeout(timeout)
			func(...args)
		}
		clearTimeout(timeout)
		timeout = setTimeout(later, wait)
	}
}

module.exports = { formatCurrency, debounce }`,
		)

		// Create YAML config file
		await fs.writeFile(
			testFiles.configFile,
			`# Application Configuration
app:
  name: "Test Application"
  version: "1.0.0"
  port: 3000
  
database:
  host: "localhost"
  port: 5432
  name: "testdb"
  user: "testuser"
  
redis:
  host: "localhost"
  port: 6379
  
logging:
  level: "info"
  file: "app.log"`,
		)

		// Create Markdown README
		await fs.writeFile(
			testFiles.readmeFile,
			`# Search Files Test Project

This project contains various file types for testing the search_files functionality.

## File Types Included

- **JavaScript files** (.js) - Contains functions and exports
- **TypeScript files** (.ts) - Contains interfaces and classes  
- **JSON files** (.json) - Configuration and package files
- **Text files** (.txt) - Documentation and notes
- **YAML files** (.yaml) - Configuration files
- **Markdown files** (.md) - Documentation

## Search Patterns to Test

1. Function definitions: \`function\\s+\\w+\`
2. TODO comments: \`TODO.*\`
3. Import/export statements: \`(import|export).*\`
4. Interface definitions: \`interface\\s+\\w+\`
5. Configuration keys: \`"\\w+":\\s*\`

## Expected Results

The search should find matches across different file types and provide context for each match.`,
		)

		console.log("Test files created successfully")
		console.log("Test files:", testFiles)
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
		for (const [key, filePath] of Object.entries(testFiles)) {
			try {
				await fs.unlink(filePath)
				console.log(`Cleaned up ${key} test file`)
			} catch (error) {
				console.log(`Failed to clean up ${key} test file:`, error)
			}
		}

		// Clean up nested directory
		try {
			const nestedDir = path.join(workspaceDir, "search-test")
			await fs.rmdir(nestedDir)
			console.log("Cleaned up nested directory")
		} catch (error) {
			console.log("Failed to clean up nested directory:", error)
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

	test("Should search for function definitions in JavaScript files", async function () {
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
			// Start task to search for function definitions
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the search_files tool with regex="function\\s+\\w+" to search for function declarations, then tell me what you found.`,
			})

			console.log("Task ID:", taskId)

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 90_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI found function definitions
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("function") || m.text?.includes("found") || m.text?.includes("search")),
			)
			assert.ok(hasContent, "AI should have mentioned search results")

			console.log("Test passed! Function definitions search completed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should search for TODO comments across multiple file types", async function () {
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
			// Start task to search for TODO comments
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the search_files tool with the regex pattern "TODO.*" to find all TODO items across all file types. Tell me what you find.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI mentioned search results
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("TODO") ||
						m.text?.toLowerCase().includes("found") ||
						m.text?.toLowerCase().includes("search")),
			)
			assert.ok(hasContent, "AI should have mentioned search results")

			console.log("Test passed! TODO comments search completed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should search with file pattern filter for TypeScript files", async function () {
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
			// Start task to search for interfaces in TypeScript files only
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the search_files tool with the regex pattern "interface\\s+\\w+" and file pattern "*.ts" to find interfaces only in TypeScript files. Tell me what you find.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI mentioned search results
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("interface") ||
						m.text?.toLowerCase().includes("found") ||
						m.text?.toLowerCase().includes("search")),
			)
			assert.ok(hasContent, "AI should have mentioned search results")

			console.log("Test passed! TypeScript interface search completed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should search for configuration keys in JSON files", async function () {
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
			// Start task to search for configuration keys in JSON files
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the search_files tool with the regex pattern '"\\w+":\\s*' and file pattern "*.json" to find all configuration keys in JSON files. Tell me what you find.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI mentioned search results
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.toLowerCase().includes("found") ||
						m.text?.toLowerCase().includes("search") ||
						m.text?.toLowerCase().includes("key")),
			)
			assert.ok(hasContent, "AI should have mentioned search results")

			console.log("Test passed! JSON configuration search completed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should search in nested directories", async function () {
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
			// Start task to search in nested directories
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the search_files tool with the regex pattern "function\\s+(format|debounce)" to find utility functions in the current directory and subdirectories. Tell me what you find.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI mentioned search results
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("function") ||
						m.text?.toLowerCase().includes("found") ||
						m.text?.toLowerCase().includes("search")),
			)
			assert.ok(hasContent, "AI should have mentioned search results")

			console.log("Test passed! Nested directory search completed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should handle complex regex patterns", async function () {
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
			// Start task to search with complex regex
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the search_files tool with the regex pattern "(import|export).*" and file pattern "*.{js,ts}" to find all import/export statements. Tell me what you find.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI mentioned search results
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("export") ||
						m.text?.includes("import") ||
						m.text?.toLowerCase().includes("found") ||
						m.text?.toLowerCase().includes("search")),
			)
			assert.ok(hasContent, "AI should have mentioned search results")

			console.log("Test passed! Complex regex search completed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should handle search with no matches", async function () {
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
			// Start task to search for something that doesn't exist
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the search_files tool with the regex pattern "nonExistentPattern12345" to search for something that won't be found. Tell me what you find.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI provided a response
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					m.text &&
					m.text.length > 10,
			)
			assert.ok(hasContent, "AI should have provided a response")

			console.log("Test passed! No-match scenario handled correctly")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should search for class definitions and methods", async function () {
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
			// Start task to search for class definitions and async methods
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowReadOnly: true,
					alwaysAllowReadOnlyOutsideWorkspace: true,
				},
				text: `Use the search_files tool with the regex pattern "(class\\s+\\w+|async\\s+\\w+)" and file pattern "*.ts" to find classes and async methods. Tell me what you find.`,
			})

			// Wait for task completion
			await waitFor(() => taskCompleted, { timeout: 60_000 })

			// Verify the search_files tool was executed
			assert.ok(toolExecuted, "The search_files tool should have been executed")

			// Verify the AI mentioned search results
			const hasContent = messages.some(
				(m) =>
					m.type === "say" &&
					(m.say === "completion_result" || m.say === "text") &&
					(m.text?.includes("class") ||
						m.text?.includes("async") ||
						m.text?.toLowerCase().includes("found") ||
						m.text?.toLowerCase().includes("search")),
			)
			assert.ok(hasContent, "AI should have mentioned search results")

			console.log("Test passed! Class and method search completed successfully")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})
})
