import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { ExtensionHost } from "../ExtensionHost.js"
import * as path from "path"
import * as fs from "fs"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

describe("Webview Async Resolution", () => {
	let extensionHost: ExtensionHost
	let tempDir: string

	beforeEach(() => {
		// Create a temporary directory for the test
		tempDir = path.join(__dirname, "..", "..", "..", "test-temp", `test-${Date.now()}`)
		fs.mkdirSync(tempDir, { recursive: true })

		// Create a mock extension bundle
		const mockExtensionPath = path.join(tempDir, "extension.js")
		fs.writeFileSync(
			mockExtensionPath,
			`
			module.exports = {
				activate: function(context) {
					return {
						getState: () => null,
						sendMessage: () => {},
					}
				},
				deactivate: function() {}
			}
		`,
		)

		extensionHost = new ExtensionHost({
			workspacePath: tempDir,
			extensionBundlePath: mockExtensionPath,
			extensionRootPath: tempDir,
		})
	})

	afterEach(async () => {
		await extensionHost.deactivate()
		// Clean up temp directory
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	it("should await async resolveWebviewView before marking ready", async () => {
		const resolutionOrder: string[] = []
		let resolvePromise: () => void

		// Create a promise that we control
		const asyncResolution = new Promise<void>((resolve) => {
			resolvePromise = resolve
		})

		// Mock provider with async resolveWebviewView
		const mockProvider = {
			resolveWebviewView: vi.fn(async () => {
				resolutionOrder.push("resolveWebviewView-start")
				await asyncResolution
				resolutionOrder.push("resolveWebviewView-end")
			}),
		}

		// Activate extension
		await extensionHost.activate()

		// Register the provider (simulating what VSCode API does)
		extensionHost.registerWebviewProvider("test-provider", mockProvider)

		// Simulate the webview registration flow
		const vscode = (
			global as {
				vscode?: { window?: { registerWebviewViewProvider: (viewId: string, provider: unknown) => void } }
			}
		).vscode
		if (vscode && vscode.window) {
			// This will trigger resolveWebviewView
			vscode.window.registerWebviewViewProvider("test-provider", mockProvider)
		}

		// Wait a bit to ensure resolveWebviewView is called
		await new Promise((resolve) => setTimeout(resolve, 50))

		// At this point, resolveWebviewView should be running but not complete
		expect(resolutionOrder).toContain("resolveWebviewView-start")
		expect(resolutionOrder).not.toContain("resolveWebviewView-end")

		// Webview should NOT be ready yet
		expect(extensionHost.isWebviewReady()).toBe(false)

		// Now complete the async resolution
		resolvePromise!()

		// Wait for the resolution to complete
		await new Promise((resolve) => setTimeout(resolve, 50))

		// Now it should be complete
		expect(resolutionOrder).toContain("resolveWebviewView-end")

		// And webview should be ready
		expect(extensionHost.isWebviewReady()).toBe(true)
	})

	it("should handle synchronous resolveWebviewView correctly", async () => {
		const mockProvider = {
			resolveWebviewView: vi.fn(() => {
				// Synchronous - no promise returned
			}),
		}

		// Activate extension
		await extensionHost.activate()

		// Register the provider
		extensionHost.registerWebviewProvider("test-provider", mockProvider)

		// Simulate the webview registration flow
		const vscode = (
			global as {
				vscode?: { window?: { registerWebviewViewProvider: (viewId: string, provider: unknown) => void } }
			}
		).vscode
		if (vscode && vscode.window) {
			vscode.window.registerWebviewViewProvider("test-provider", mockProvider)
		}

		// Wait for registration to complete
		await new Promise((resolve) => setTimeout(resolve, 50))

		// Webview should be ready
		expect(extensionHost.isWebviewReady()).toBe(true)
	})

	it("should queue messages until async resolution completes", async () => {
		let resolvePromise: () => void
		const asyncResolution = new Promise<void>((resolve) => {
			resolvePromise = resolve
		})

		const receivedMessages: Array<{ type: string }> = []
		const mockProvider = {
			resolveWebviewView: vi.fn(async () => {
				await asyncResolution
			}),
			handleCLIMessage: vi.fn(async (message: { type: string }) => {
				receivedMessages.push(message)
			}),
		}

		// Activate extension
		await extensionHost.activate()

		// Register the provider
		extensionHost.registerWebviewProvider("kilo-code.SidebarProvider", mockProvider)

		// Simulate the webview registration flow
		const vscode = (
			global as {
				vscode?: { window?: { registerWebviewViewProvider: (viewId: string, provider: unknown) => void } }
			}
		).vscode
		if (vscode && vscode.window) {
			vscode.window.registerWebviewViewProvider("kilo-code.SidebarProvider", mockProvider)
		}

		// Send messages before resolution completes
		await extensionHost.sendWebviewMessage({ type: "test1" })
		await extensionHost.sendWebviewMessage({ type: "test2" })

		// Messages should be queued, not received yet
		expect(receivedMessages).toHaveLength(0)
		expect(extensionHost.isWebviewReady()).toBe(false)

		// Complete the async resolution
		resolvePromise!()
		await new Promise((resolve) => setTimeout(resolve, 100))

		// Now webview should be ready and messages should be flushed
		expect(extensionHost.isWebviewReady()).toBe(true)
		expect(receivedMessages).toHaveLength(2)
		expect(receivedMessages[0].type).toBe("test1")
		expect(receivedMessages[1].type).toBe("test2")
	})
})
