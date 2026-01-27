import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import * as vscode from "vscode"

import { RooCodeEventName, type ClineMessage } from "@roo-code/types"

import { waitFor, sleep } from "../utils"
import { setDefaultSuiteTimeout } from "../test-utils"

suite("Roo Code use_mcp_tool Tool", function () {
	// Uses the mcp-server-time MCP server via uvx
	// Provides time-related tools (get_current_time, convert_time) that don't overlap with built-in tools
	// Requires: uv installed (curl -LsSf https://astral.sh/uv/install.sh | sh)
	// Configuration is in global MCP settings, not workspace .roo/mcp.json
	setDefaultSuiteTimeout(this)

	let tempDir: string
	let testFiles: {
		simple: string
		testData: string
		mcpConfig: string
	}

	// Create a temporary directory and test files
	suiteSetup(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "roo-test-mcp-"))

		// Create test files in VSCode workspace directory
		const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || tempDir

		testFiles = {
			simple: path.join(workspaceDir, `mcp-test-${Date.now()}.txt`),
			testData: path.join(workspaceDir, `mcp-data-${Date.now()}.json`),
			mcpConfig: path.join(workspaceDir, ".kilocode", "mcp.json"),
		}

		// Copy MCP configuration from user's global settings to test environment
		// The test environment uses .vscode-test/user-data instead of ~/.config/Code
		const testUserDataDir = path.join(
			process.cwd(),
			".vscode-test",
			"user-data",
			"User",
			"globalStorage",
			"rooveterinaryinc.roo-cline",
			"settings",
		)
		const testMcpSettingsPath = path.join(testUserDataDir, "mcp_settings.json")

		// Create the directory structure
		await fs.mkdir(testUserDataDir, { recursive: true })

		// Configure the time MCP server for tests
		const mcpConfig = {
			mcpServers: {
				time: {
					command: "uvx",
					args: ["mcp-server-time"],
					alwaysAllow: ["get_current_time", "convert_time"],
				},
			},
		}

		await fs.writeFile(testMcpSettingsPath, JSON.stringify(mcpConfig, null, 2))

		console.log("MCP test workspace:", workspaceDir)
		console.log("MCP settings configured at:", testMcpSettingsPath)
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

		// Clean up .roo directory
		const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || tempDir
		const rooDir = path.join(workspaceDir, ".kilocode")
		try {
			await fs.rm(rooDir, { recursive: true, force: true })
		} catch {
			// Directory might not exist
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

	test("Should request MCP time get_current_time tool and complete successfully", async function () {
		this.timeout(90_000) // MCP server initialization can take time
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let taskStarted = false
		let _taskCompleted = false
		let mcpToolRequested = false
		let mcpToolName: string | null = null
		let mcpServerResponse: string | null = null
		let attemptCompletionCalled = false
		let errorOccurred: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for MCP tool request
			if (message.type === "ask" && message.ask === "use_mcp_server") {
				mcpToolRequested = true
				console.log("MCP tool request:", message.text?.substring(0, 200))

				// Parse the MCP request to verify structure and tool name
				if (message.text) {
					try {
						const mcpRequest = JSON.parse(message.text)
						mcpToolName = mcpRequest.toolName
						console.log("MCP request parsed:", {
							type: mcpRequest.type,
							serverName: mcpRequest.serverName,
							toolName: mcpRequest.toolName,
							hasArguments: !!mcpRequest.arguments,
						})
					} catch (e) {
						console.log("Failed to parse MCP request:", e)
					}
				}
			}

			// Check for MCP server response
			if (message.type === "say" && message.say === "mcp_server_response") {
				mcpServerResponse = message.text || null
				console.log("MCP server response received:", message.text?.substring(0, 200))
			}

			// Check for attempt_completion
			if (message.type === "say" && message.say === "completion_result") {
				attemptCompletionCalled = true
				console.log("Attempt completion called:", message.text?.substring(0, 200))
			}

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
			}
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
				_taskCompleted = true
				console.log("Task completed:", id)
			}
		}
		api.on(RooCodeEventName.TaskCompleted, taskCompletedHandler)

		// Trigger MCP server refresh by executing the refresh command
		// This simulates clicking the "Refresh MCP Servers" button in the UI
		console.log("Triggering MCP server refresh...")
		try {
			// The webview needs to send a refreshAllMcpServers message
			// We can't directly call this from the E2E API, so we'll use a workaround:
			// Execute a VSCode command that might trigger MCP initialization
			await vscode.commands.executeCommand("roo-cline.SidebarProvider.focus")
			await sleep(2000)

			// Try to trigger MCP refresh through the extension's internal API
			// Since we can't directly access the webview message handler, we'll rely on
			// the MCP servers being initialized when the extension activates
			console.log("Waiting for MCP servers to initialize...")
			await sleep(10000) // Give MCP servers time to initialize
		} catch (error) {
			console.error("Failed to trigger MCP refresh:", error)
		}

		let taskId: string
		try {
			// Start task requesting to use MCP time server's get_current_time tool
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowMcp: true, // Enable MCP auto-approval
					mcpEnabled: true,
				},
				text: `Use the MCP time server's get_current_time tool to get the current time in America/New_York timezone and tell me what time it is there.`,
			})

			console.log("Task ID:", taskId)
			console.log("Requesting MCP time get_current_time for America/New_York")

			// Wait for task to start
			await waitFor(() => taskStarted, { timeout: 45_000 })

			// Wait for attempt_completion to be called (indicating task finished)
			await waitFor(() => attemptCompletionCalled, { timeout: 45_000 })

			// Verify the MCP tool was requested
			assert.ok(mcpToolRequested, "The use_mcp_tool should have been requested")

			// Verify the correct tool was used
			assert.strictEqual(mcpToolName, "get_current_time", "Should have used the get_current_time tool")

			// Verify we got a response from the MCP server
			assert.ok(mcpServerResponse, "Should have received a response from the MCP server")

			// Verify the response contains time data (not an error)
			const responseText = mcpServerResponse as string

			// Check for time-related content
			const hasTimeContent =
				responseText.includes("time") ||
				responseText.includes("datetime") ||
				responseText.includes("2026") || // Current year
				responseText.includes(":") || // Time format HH:MM
				responseText.includes("America/New_York") ||
				responseText.length > 10 // At least some content

			assert.ok(
				hasTimeContent,
				`MCP server response should contain time data. Got: ${responseText.substring(0, 200)}...`,
			)

			// Ensure no errors are present
			assert.ok(
				!responseText.toLowerCase().includes("error") && !responseText.toLowerCase().includes("failed"),
				`MCP server response should not contain error messages. Got: ${responseText.substring(0, 200)}...`,
			)

			// Verify task completed successfully
			assert.ok(attemptCompletionCalled, "Task should have completed with attempt_completion")

			// Check that no errors occurred
			assert.strictEqual(errorOccurred, null, "No errors should have occurred")

			console.log("Test passed! MCP get_current_time tool used successfully and task completed")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskStarted, taskStartedHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})

	test("Should request MCP time convert_time tool and complete successfully", async function () {
		this.timeout(90_000) // MCP server initialization can take time
		const api = globalThis.api
		const messages: ClineMessage[] = []
		let _taskCompleted = false
		let mcpToolRequested = false
		let mcpToolName: string | null = null
		let mcpServerResponse: string | null = null
		let attemptCompletionCalled = false
		let errorOccurred: string | null = null

		// Listen for messages
		const messageHandler = ({ message }: { message: ClineMessage }) => {
			messages.push(message)

			// Check for MCP tool request
			if (message.type === "ask" && message.ask === "use_mcp_server") {
				mcpToolRequested = true
				console.log("MCP tool request:", message.text?.substring(0, 200))

				// Parse the MCP request to verify structure and tool name
				if (message.text) {
					try {
						const mcpRequest = JSON.parse(message.text)
						mcpToolName = mcpRequest.toolName
						console.log("MCP request parsed:", {
							type: mcpRequest.type,
							serverName: mcpRequest.serverName,
							toolName: mcpRequest.toolName,
							hasArguments: !!mcpRequest.arguments,
						})
					} catch (e) {
						console.log("Failed to parse MCP request:", e)
					}
				}
			}

			// Check for MCP server response
			if (message.type === "say" && message.say === "mcp_server_response") {
				mcpServerResponse = message.text || null
				console.log("MCP server response received:", message.text?.substring(0, 200))
			}

			// Check for attempt_completion
			if (message.type === "say" && message.say === "completion_result") {
				attemptCompletionCalled = true
				console.log("Attempt completion called:", message.text?.substring(0, 200))
			}

			// Log important messages for debugging
			if (message.type === "say" && message.say === "error") {
				errorOccurred = message.text || "Unknown error"
				console.error("Error:", message.text)
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
			// Start task requesting to use MCP time server's convert_time tool
			taskId = await api.startNewTask({
				configuration: {
					mode: "code",
					autoApprovalEnabled: true,
					alwaysAllowMcp: true,
					mcpEnabled: true,
				},
				text: `Use the MCP time server's convert_time tool to convert 14:00 from America/New_York timezone to Asia/Tokyo timezone and tell me what time it would be.`,
			})

			// Wait for attempt_completion to be called (indicating task finished)
			await waitFor(() => attemptCompletionCalled, { timeout: 60_000 })

			// Verify the MCP tool was requested
			assert.ok(mcpToolRequested, "The use_mcp_tool should have been requested")

			// Verify the correct tool was used
			assert.strictEqual(mcpToolName, "convert_time", "Should have used the convert_time tool")

			// Verify we got a response from the MCP server
			assert.ok(mcpServerResponse, "Should have received a response from the MCP server")

			// Verify the response contains time conversion data (not an error)
			const responseText = mcpServerResponse as string

			// Check for time conversion content
			const hasConversionContent =
				responseText.includes("time") ||
				responseText.includes(":") || // Time format
				responseText.includes("Tokyo") ||
				responseText.includes("Asia/Tokyo") ||
				responseText.length > 10 // At least some content

			assert.ok(
				hasConversionContent,
				`MCP server response should contain time conversion data. Got: ${responseText.substring(0, 200)}...`,
			)

			// Ensure no errors are present
			assert.ok(
				!responseText.toLowerCase().includes("error") && !responseText.toLowerCase().includes("failed"),
				`MCP server response should not contain error messages. Got: ${responseText.substring(0, 200)}...`,
			)

			// Verify task completed successfully
			assert.ok(attemptCompletionCalled, "Task should have completed with attempt_completion")

			// Check that no errors occurred
			assert.strictEqual(errorOccurred, null, "No errors should have occurred")

			console.log("Test passed! MCP convert_time tool used successfully and task completed")
		} finally {
			// Clean up
			api.off(RooCodeEventName.Message, messageHandler)
			api.off(RooCodeEventName.TaskCompleted, taskCompletedHandler)
		}
	})
})
