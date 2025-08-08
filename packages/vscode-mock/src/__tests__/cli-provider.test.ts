/**
 * CLI Provider Tests
 * Tests the CLIProvider class that orchestrates VS Code API mocking
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { CLIProvider } from "../providers/CLIProvider"
import path from "path"
import fs from "fs"
import os from "os"

describe("CLIProvider", () => {
	let tempDir: string

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-cli-provider-test-"))
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("initialization", () => {
		test("should create provider with working directory", () => {
			const provider = new CLIProvider(tempDir)

			expect(provider).toBeDefined()
		})

		test("should initialize without errors", () => {
			const provider = new CLIProvider(tempDir)

			expect(() => provider.initialize()).not.toThrow()
		})
	})

	describe("VS Code module creation", () => {
		test("should create VS Code module after initialization", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const vscodeModule = provider.createVSCodeModule()

			expect(vscodeModule).toBeDefined()
			expect(vscodeModule.workspace).toBeDefined()
			expect(vscodeModule.window).toBeDefined()
			expect(vscodeModule.commands).toBeDefined()
			expect(vscodeModule.env).toBeDefined()
		})

		test("should have all required VS Code namespaces", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const vscode = provider.createVSCodeModule()

			// Core namespaces
			expect(vscode.workspace).toBeDefined()
			expect(vscode.window).toBeDefined()
			expect(vscode.commands).toBeDefined()
			expect(vscode.env).toBeDefined()
			expect(vscode.languages).toBeDefined()
			expect(vscode.extensions).toBeDefined()

			// Utility classes
			expect(vscode.Uri).toBeDefined()
			expect(vscode.Range).toBeDefined()
			expect(vscode.Position).toBeDefined()
			expect(vscode.Selection).toBeDefined()
		})

		test("should have VS Code constants", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const vscode = provider.createVSCodeModule()

			expect(vscode.StatusBarAlignment).toBeDefined()
			expect(vscode.ViewColumn).toBeDefined()
			expect(vscode.ProgressLocation).toBeDefined()
			expect(vscode.FileType).toBeDefined()
			expect(vscode.DiagnosticSeverity).toBeDefined()
		})
	})

	describe("VS Code API access", () => {
		test("should provide VS Code API instance", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const api = provider.getVSCodeAPI()

			expect(api).toBeDefined()
			expect(api.workspace).toBeDefined()
			expect(api.window).toBeDefined()
			expect(api.commands).toBeDefined()
			expect(api.env).toBeDefined()
		})

		test("should create extension context", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const api = provider.getVSCodeAPI()
			const context = api.createExtensionContext()

			expect(context).toBeDefined()
			expect(context.subscriptions).toBeDefined()
			expect(context.workspaceState).toBeDefined()
			expect(context.globalState).toBeDefined()
			expect(context.extensionPath).toBe(tempDir)
		})
	})

	describe("file system integration", () => {
		test("should handle file operations through workspace.fs", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const vscode = provider.createVSCodeModule()
			const testFile = path.join(tempDir, "test.txt")
			const testContent = "Test content"

			// Write file
			const uri = { fsPath: testFile }
			await vscode.workspace.fs.writeFile(uri, Buffer.from(testContent))

			// Verify file exists
			expect(fs.existsSync(testFile)).toBe(true)

			// Read file back
			const content = await vscode.workspace.fs.readFile(uri)
			expect(Buffer.from(content).toString()).toBe(testContent)
		})

		test("should handle directory operations", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const vscode = provider.createVSCodeModule()
			const nestedFile = path.join(tempDir, "nested", "dir", "file.txt")

			// Write to nested path (should create directories)
			const uri = { fsPath: nestedFile }
			await vscode.workspace.fs.writeFile(uri, Buffer.from("nested content"))

			expect(fs.existsSync(nestedFile)).toBe(true)
			expect(fs.readFileSync(nestedFile, "utf8")).toBe("nested content")
		})
	})

	describe("configuration management", () => {
		test("should handle configuration get/set", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const vscode = provider.createVSCodeModule()
			const config = vscode.workspace.getConfiguration("test")

			// Set and get values
			await config.update("key1", "value1")
			expect(config.get("key1")).toBe("value1")

			// Test with defaults
			expect(config.get("nonexistent", "default")).toBe("default")
		})

		test("should maintain separate configuration sections", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const vscode = provider.createVSCodeModule()
			const config1 = vscode.workspace.getConfiguration("section1")
			const config2 = vscode.workspace.getConfiguration("section2")

			await config1.update("key", "value1")
			await config2.update("key", "value2")

			expect(config1.get("key")).toBe("value1")
			expect(config2.get("key")).toBe("value2")
		})
	})

	describe("workspace folder handling", () => {
		test("should set up workspace folder correctly", () => {
			const provider = new CLIProvider(tempDir)
			provider.initialize()

			const vscode = provider.createVSCodeModule()
			const folders = vscode.workspace.workspaceFolders

			expect(folders).toBeDefined()
			expect(folders!.length).toBe(1)
			expect(folders![0].uri.fsPath).toBe(tempDir)
			expect(folders![0].name).toMatch(/kilo-cli-provider-test-/)
			expect(folders![0].index).toBe(0)
		})
	})

	describe("error handling", () => {
		test("should handle invalid working directory gracefully", async () => {
			const invalidDir = "/nonexistent/directory"
			const provider = new CLIProvider(invalidDir)

			// Should not throw during construction
			expect(provider).toBeDefined()

			// May throw during initialization, but should be handled gracefully
			// This depends on the implementation
		})

		test("should handle file operation errors", async () => {
			const provider = new CLIProvider(tempDir)
			await provider.initialize()

			const vscode = provider.createVSCodeModule()
			const nonExistentFile = path.join(tempDir, "nonexistent.txt")
			const uri = { fsPath: nonExistentFile }

			// Reading non-existent file should throw
			await expect(vscode.workspace.fs.readFile(uri)).rejects.toThrow()
		})
	})

	describe("disposal and cleanup", () => {
		test("should handle multiple initializations", async () => {
			const provider = new CLIProvider(tempDir)

			await provider.initialize()
			await provider.initialize() // Second initialization should not throw

			const vscode = provider.createVSCodeModule()
			expect(vscode).toBeDefined()
		})
	})
})
