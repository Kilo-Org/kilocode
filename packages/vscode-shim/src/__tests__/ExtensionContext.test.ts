import { ExtensionContextImpl } from "../context/ExtensionContext.js"
import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"

describe("ExtensionContextImpl", () => {
	let tempDir: string
	let extensionPath: string
	let workspacePath: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "ext-context-test-"))
		extensionPath = path.join(tempDir, "extension")
		workspacePath = path.join(tempDir, "workspace")
		fs.mkdirSync(extensionPath, { recursive: true })
		fs.mkdirSync(workspacePath, { recursive: true })
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true })
		}
	})

	describe("constructor", () => {
		it("should create context with extension path", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
			})

			expect(context.extensionPath).toBe(extensionPath)
			expect(context.extensionUri.fsPath).toBe(extensionPath)
		})

		it("should use default extension mode (Production)", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
			})

			expect(context.extensionMode).toBe(1) // Production
		})

		it("should allow custom extension mode", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				extensionMode: 2, // Development
			})

			expect(context.extensionMode).toBe(2)
		})

		it("should initialize empty subscriptions array", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
			})

			expect(context.subscriptions).toEqual([])
		})

		it("should initialize environmentVariableCollection", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
			})

			expect(context.environmentVariableCollection).toEqual({})
		})
	})

	describe("storage paths", () => {
		it("should set up global storage path", () => {
			const customStorageDir = path.join(tempDir, "custom-storage")

			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir: customStorageDir,
			})

			expect(context.globalStoragePath).toContain("global-storage")
			expect(context.globalStorageUri.fsPath).toBe(context.globalStoragePath)
		})

		it("should set up workspace storage path with hash", () => {
			const customStorageDir = path.join(tempDir, "custom-storage")

			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir: customStorageDir,
			})

			expect(context.storagePath).toContain("workspace-storage")
			expect(context.storageUri?.fsPath).toBe(context.storagePath)
		})

		it("should set up log path", () => {
			const customStorageDir = path.join(tempDir, "custom-storage")

			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir: customStorageDir,
			})

			expect(context.logPath).toContain("logs")
			expect(context.logUri.fsPath).toBe(context.logPath)
		})

		it("should create storage directories", () => {
			const customStorageDir = path.join(tempDir, "custom-storage")

			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir: customStorageDir,
			})

			expect(fs.existsSync(context.globalStoragePath)).toBe(true)
			expect(fs.existsSync(context.storagePath!)).toBe(true)
			expect(fs.existsSync(context.logPath)).toBe(true)
		})

		it("should generate different workspace hashes for different paths", () => {
			const workspace1 = path.join(tempDir, "workspace1")
			const workspace2 = path.join(tempDir, "workspace2")
			fs.mkdirSync(workspace1, { recursive: true })
			fs.mkdirSync(workspace2, { recursive: true })

			const context1 = new ExtensionContextImpl({
				extensionPath,
				workspacePath: workspace1,
				storageDir: path.join(tempDir, "storage1"),
			})

			const context2 = new ExtensionContextImpl({
				extensionPath,
				workspacePath: workspace2,
				storageDir: path.join(tempDir, "storage2"),
			})

			// The hashes should be different
			const hash1 = path.basename(context1.storagePath!)
			const hash2 = path.basename(context2.storagePath!)
			expect(hash1).not.toBe(hash2)
		})
	})

	describe("workspaceState", () => {
		it("should provide workspaceState memento", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir: path.join(tempDir, "storage"),
			})

			expect(context.workspaceState).toBeDefined()
			expect(typeof context.workspaceState.get).toBe("function")
			expect(typeof context.workspaceState.update).toBe("function")
			expect(typeof context.workspaceState.keys).toBe("function")
		})

		it("should persist workspace state", async () => {
			const storageDir = path.join(tempDir, "storage")

			const context1 = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir,
			})

			await context1.workspaceState.update("testKey", "testValue")

			// Create new context with same storage
			const context2 = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir,
			})

			expect(context2.workspaceState.get("testKey")).toBe("testValue")
		})
	})

	describe("globalState", () => {
		it("should provide globalState memento", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir: path.join(tempDir, "storage"),
			})

			expect(context.globalState).toBeDefined()
			expect(typeof context.globalState.get).toBe("function")
			expect(typeof context.globalState.update).toBe("function")
			expect(typeof context.globalState.keys).toBe("function")
		})

		it("should have setKeysForSync method", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir: path.join(tempDir, "storage"),
			})

			expect(typeof context.globalState.setKeysForSync).toBe("function")
			// Should not throw
			expect(() => context.globalState.setKeysForSync(["key1", "key2"])).not.toThrow()
		})

		it("should persist global state", async () => {
			const storageDir = path.join(tempDir, "storage")

			const context1 = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir,
			})

			await context1.globalState.update("globalKey", "globalValue")

			// Create new context with same storage
			const context2 = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir,
			})

			expect(context2.globalState.get("globalKey")).toBe("globalValue")
		})
	})

	describe("secrets", () => {
		it("should provide secrets storage", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir: path.join(tempDir, "storage"),
			})

			expect(context.secrets).toBeDefined()
			expect(typeof context.secrets.get).toBe("function")
			expect(typeof context.secrets.store).toBe("function")
			expect(typeof context.secrets.delete).toBe("function")
		})

		it("should persist secrets", async () => {
			const storageDir = path.join(tempDir, "storage")

			const context1 = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir,
			})

			await context1.secrets.store("apiKey", "secret123")

			// Create new context with same storage
			const context2 = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
				storageDir,
			})

			const secret = await context2.secrets.get("apiKey")
			expect(secret).toBe("secret123")
		})
	})

	describe("dispose()", () => {
		it("should dispose all subscriptions", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
			})

			const disposable1 = { dispose: vi.fn() }
			const disposable2 = { dispose: vi.fn() }

			context.subscriptions.push(disposable1)
			context.subscriptions.push(disposable2)

			context.dispose()

			expect(disposable1.dispose).toHaveBeenCalledTimes(1)
			expect(disposable2.dispose).toHaveBeenCalledTimes(1)
		})

		it("should clear subscriptions array after dispose", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
			})

			context.subscriptions.push({ dispose: () => {} })
			context.subscriptions.push({ dispose: () => {} })

			context.dispose()

			expect(context.subscriptions).toEqual([])
		})

		it("should handle disposal errors gracefully", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
			})

			// Add a disposable that throws
			context.subscriptions.push({
				dispose: () => {
					throw new Error("Disposal error")
				},
			})

			// Add a normal disposable
			const normalDisposable = { dispose: vi.fn() }
			context.subscriptions.push(normalDisposable)

			// Should not throw
			expect(() => context.dispose()).not.toThrow()

			// Normal disposable should still be called
			expect(normalDisposable.dispose).toHaveBeenCalled()
		})
	})

	describe("default storage directory", () => {
		it("should use home directory based default when no storageDir provided", () => {
			const context = new ExtensionContextImpl({
				extensionPath,
				workspacePath,
			})

			// Should contain .vscode-mock in the path
			expect(context.globalStoragePath).toContain(".vscode-mock")
		})
	})
})
