import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { VSCodeAPI } from "../api/VSCodeAPI"
import { FileSystemAdapter } from "../adapters/FileSystemAdapter"
import { UserInterfaceAdapter } from "../adapters/UserInterfaceAdapter"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("Commands API Tests", () => {
	let tempDir: string
	let vscodeAPI: VSCodeAPI
	let fileSystemAdapter: FileSystemAdapter
	let userInterfaceAdapter: UserInterfaceAdapter

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-commands-test-"))
		fileSystemAdapter = new FileSystemAdapter(tempDir)
		userInterfaceAdapter = new UserInterfaceAdapter()
		vscodeAPI = new VSCodeAPI(fileSystemAdapter, userInterfaceAdapter)
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("Command Execution", () => {
		it("should execute commands through commands.executeCommand", async () => {
			const result = await vscodeAPI.commands.executeCommand("test.command", "arg1", "arg2")

			// Commands API should handle execution gracefully
			expect(result).toBeUndefined() // Mock returns undefined for unknown commands
		})

		it("should handle command execution with various argument types", async () => {
			const stringResult = await vscodeAPI.commands.executeCommand("test.string", "hello")
			const numberResult = await vscodeAPI.commands.executeCommand("test.number", 42)
			const objectResult = await vscodeAPI.commands.executeCommand("test.object", { key: "value" })
			const arrayResult = await vscodeAPI.commands.executeCommand("test.array", [1, 2, 3])

			expect(stringResult).toBeUndefined()
			expect(numberResult).toBeUndefined()
			expect(objectResult).toBeUndefined()
			expect(arrayResult).toBeUndefined()
		})

		it("should handle commands with no arguments", async () => {
			const result = await vscodeAPI.commands.executeCommand("test.noargs")
			expect(result).toBeUndefined()
		})
	})

	describe("Environment API", () => {
		it("should provide environment information", () => {
			const env = vscodeAPI.env

			expect(env.machineId).toBe("cli-machine-id")
			expect(env.sessionId).toBe("cli-session-id")
			expect(env.language).toBe("en")
			expect(env.clipboard).toBeDefined()
			expect(typeof env.clipboard.writeText).toBe("function")
			expect(typeof env.clipboard.readText).toBe("function")
		})

		it("should handle clipboard operations", async () => {
			const env = vscodeAPI.env

			// Mock clipboard operations should not throw
			await expect(env.clipboard.writeText("test text")).resolves.toBeUndefined()
			await expect(env.clipboard.readText()).resolves.toBe("")
		})
	})

	describe("Extension Context", () => {
		it("should create extension context with required properties", () => {
			const context = vscodeAPI.createExtensionContext()

			expect(context.subscriptions).toEqual([])
			expect(context.workspaceState).toBeDefined()
			expect(context.globalState).toBeDefined()
			expect(context.extensionPath).toBe(tempDir)
			expect(context.storagePath).toContain(".kilo-cli-storage")
			expect(context.globalStoragePath).toContain(".kilo-cli-global-storage")
		})

		it("should handle workspace state operations", async () => {
			const context = vscodeAPI.createExtensionContext()

			// Test workspace state get/set
			const defaultValue = context.workspaceState.get("nonexistent", "default")
			expect(defaultValue).toBe("default")

			await context.workspaceState.update("testKey", "testValue")
			const retrievedValue = context.workspaceState.get("testKey")
			expect(retrievedValue).toBe("testValue")
		})

		it("should handle global state operations", async () => {
			const context = vscodeAPI.createExtensionContext()

			// Test global state get/set
			const defaultValue = context.globalState.get("nonexistent", 42)
			expect(defaultValue).toBe(42)

			await context.globalState.update("globalKey", { nested: "object" })
			const retrievedValue = context.globalState.get("globalKey")
			expect(retrievedValue).toEqual({ nested: "object" })
		})
	})

	describe("Static Classes", () => {
		it("should provide Uri class with static methods", () => {
			const fileUri = VSCodeAPI.Uri.file("/path/to/file.txt")

			expect(fileUri.scheme).toBe("file")
			expect(fileUri.fsPath).toBe("/path/to/file.txt")
			expect(fileUri.path).toBe("/path/to/file.txt")
			expect(fileUri.toString()).toBe("file:///path/to/file.txt")
		})

		it("should parse URIs correctly", () => {
			const parsedUri = VSCodeAPI.Uri.parse("file:///home/user/document.txt")

			expect(parsedUri.scheme).toBe("file")
			expect(parsedUri.fsPath).toBe("/home/user/document.txt")
		})

		it("should handle Disposable.from correctly", () => {
			const disposable1 = { dispose: vi.fn() }
			const disposable2 = { dispose: vi.fn() }
			const disposable3 = { dispose: vi.fn() }

			const combined = VSCodeAPI.Disposable.from(disposable1, disposable2, disposable3)

			expect(combined).toBeDefined()
			expect(typeof combined.dispose).toBe("function")

			combined.dispose()

			expect(disposable1.dispose).toHaveBeenCalledTimes(1)
			expect(disposable2.dispose).toHaveBeenCalledTimes(1)
			expect(disposable3.dispose).toHaveBeenCalledTimes(1)
		})

		it("should create RelativePattern instances", () => {
			const pattern = new VSCodeAPI.RelativePattern("/base/path", "**/*.ts")

			expect(pattern.base).toBe("/base/path")
			expect(pattern.pattern).toBe("**/*.ts")
		})
	})
})
