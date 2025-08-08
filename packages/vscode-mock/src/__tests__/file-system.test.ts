/**
 * File System Operations Tests
 * Tests the VS Code workspace.fs API mocking for file editing operations
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { CLIProvider } from "../providers/CLIProvider"
import path from "path"
import fs from "fs"
import os from "os"

describe("VS Code File System API", () => {
	let cliProvider: CLIProvider
	let tempDir: string
	let vscodeModule: any

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-fs-test-"))
		cliProvider = new CLIProvider(tempDir)
		await cliProvider.initialize()
		vscodeModule = cliProvider.createVSCodeModule()
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("workspace.fs.readFile", () => {
		test("should read existing files", async () => {
			const testFile = path.join(tempDir, "test.txt")
			const testContent = "Hello World"
			fs.writeFileSync(testFile, testContent)

			const uri = { fsPath: testFile }
			const content = await vscodeModule.workspace.fs.readFile(uri)

			expect(content).toBeDefined()
			expect(Buffer.from(content).toString()).toBe(testContent)
		})

		test("should handle non-existent files", async () => {
			const nonExistentFile = path.join(tempDir, "nonexistent.txt")
			const uri = { fsPath: nonExistentFile }

			await expect(vscodeModule.workspace.fs.readFile(uri)).rejects.toThrow()
		})
	})

	describe("workspace.fs.writeFile", () => {
		test("should write files successfully", async () => {
			const testFile = path.join(tempDir, "write-test.txt")
			const testContent = "Written content"
			const uri = { fsPath: testFile }
			const contentBuffer = Buffer.from(testContent)

			await vscodeModule.workspace.fs.writeFile(uri, contentBuffer)

			expect(fs.existsSync(testFile)).toBe(true)
			expect(fs.readFileSync(testFile, "utf8")).toBe(testContent)
		})

		test("should create directories if needed", async () => {
			const nestedFile = path.join(tempDir, "nested", "dir", "test.txt")
			const testContent = "Nested content"
			const uri = { fsPath: nestedFile }
			const contentBuffer = Buffer.from(testContent)

			await vscodeModule.workspace.fs.writeFile(uri, contentBuffer)

			expect(fs.existsSync(nestedFile)).toBe(true)
			expect(fs.readFileSync(nestedFile, "utf8")).toBe(testContent)
		})
	})

	describe("workspace.fs.stat", () => {
		test("should return file stats", async () => {
			const testFile = path.join(tempDir, "stat-test.txt")
			fs.writeFileSync(testFile, "test content")

			const uri = { fsPath: testFile }
			const stats = await vscodeModule.workspace.fs.stat(uri)

			expect(stats).toBeDefined()
			expect(stats.type).toBeDefined()
			expect(stats.size).toBeGreaterThan(0)
		})
	})

	describe("workspace.fs.delete", () => {
		test("should delete files", async () => {
			const testFile = path.join(tempDir, "delete-test.txt")
			fs.writeFileSync(testFile, "to be deleted")
			expect(fs.existsSync(testFile)).toBe(true)

			const uri = { fsPath: testFile }
			await vscodeModule.workspace.fs.delete(uri)

			expect(fs.existsSync(testFile)).toBe(false)
		})
	})

	describe("workspace.findFiles", () => {
		test("should find files by pattern", async () => {
			// Create test files
			fs.writeFileSync(path.join(tempDir, "test1.ts"), "content1")
			fs.writeFileSync(path.join(tempDir, "test2.js"), "content2")
			fs.writeFileSync(path.join(tempDir, "test3.ts"), "content3")

			const tsFiles = await vscodeModule.workspace.findFiles("**/*.ts")

			expect(Array.isArray(tsFiles)).toBe(true)
			expect(tsFiles.length).toBe(2)
			expect(tsFiles.every((file: any) => file.fsPath.endsWith(".ts"))).toBe(true)
		})

		test("should handle empty results", async () => {
			const files = await vscodeModule.workspace.findFiles("**/*.nonexistent")

			expect(Array.isArray(files)).toBe(true)
			expect(files.length).toBe(0)
		})
	})

	describe("workspace.openTextDocument", () => {
		test("should open existing documents", async () => {
			const testFile = path.join(tempDir, "document-test.txt")
			const testContent = "Document content"
			fs.writeFileSync(testFile, testContent)

			const document = await vscodeModule.workspace.openTextDocument(testFile)

			expect(document).toBeDefined()
			expect(document.getText()).toBe(testContent)
			expect(document.fileName).toBe(testFile)
			expect(document.lineCount).toBe(1)
		})

		test("should handle multi-line documents", async () => {
			const testFile = path.join(tempDir, "multiline-test.txt")
			const testContent = "Line 1\nLine 2\nLine 3"
			fs.writeFileSync(testFile, testContent)

			const document = await vscodeModule.workspace.openTextDocument(testFile)

			expect(document.getText()).toBe(testContent)
			expect(document.lineCount).toBe(3)
		})
	})
})
