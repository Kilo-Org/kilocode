import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"

import { FileSystemAPI } from "../api/FileSystemAPI.js"
import { Uri } from "../classes/Uri.js"

describe("FileSystemAPI", () => {
	let tempDir: string
	let fsAPI: FileSystemAPI

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "fs-api-test-"))
		fsAPI = new FileSystemAPI()
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true })
		}
	})

	describe("stat()", () => {
		it("should stat a file", async () => {
			const filePath = path.join(tempDir, "test.txt")
			fs.writeFileSync(filePath, "test content")

			const uri = Uri.file(filePath)
			const stat = await fsAPI.stat(uri)

			expect(stat.type).toBe(1) // File
			expect(stat.size).toBeGreaterThan(0)
			expect(stat.mtime).toBeGreaterThan(0)
			expect(stat.ctime).toBeGreaterThan(0)
		})

		it("should stat a directory", async () => {
			const uri = Uri.file(tempDir)
			const stat = await fsAPI.stat(uri)

			expect(stat.type).toBe(2) // Directory
		})

		it("should return default stat for non-existent file", async () => {
			const uri = Uri.file(path.join(tempDir, "nonexistent.txt"))
			const stat = await fsAPI.stat(uri)

			expect(stat.type).toBe(1) // File (default)
			expect(stat.size).toBe(0)
		})
	})

	describe("readFile()", () => {
		it("should read file content", async () => {
			const filePath = path.join(tempDir, "test.txt")
			fs.writeFileSync(filePath, "Hello, world!")

			const uri = Uri.file(filePath)
			const content = await fsAPI.readFile(uri)

			expect(Buffer.from(content).toString()).toBe("Hello, world!")
		})

		it("should throw FileSystemError for non-existent file", async () => {
			const uri = Uri.file(path.join(tempDir, "nonexistent.txt"))

			await expect(fsAPI.readFile(uri)).rejects.toThrow()
		})
	})

	describe("writeFile()", () => {
		it("should write file content", async () => {
			const filePath = path.join(tempDir, "output.txt")
			const uri = Uri.file(filePath)

			await fsAPI.writeFile(uri, new TextEncoder().encode("Written content"))

			expect(fs.readFileSync(filePath, "utf-8")).toBe("Written content")
		})

		it("should create parent directories if they don't exist", async () => {
			const filePath = path.join(tempDir, "subdir", "nested", "file.txt")
			const uri = Uri.file(filePath)

			await fsAPI.writeFile(uri, new TextEncoder().encode("Nested content"))

			expect(fs.readFileSync(filePath, "utf-8")).toBe("Nested content")
		})
	})

	describe("delete()", () => {
		it("should delete a file", async () => {
			const filePath = path.join(tempDir, "to-delete.txt")
			fs.writeFileSync(filePath, "delete me")

			const uri = Uri.file(filePath)
			await fsAPI.delete(uri)

			expect(fs.existsSync(filePath)).toBe(false)
		})

		it("should throw error for non-existent file", async () => {
			const uri = Uri.file(path.join(tempDir, "nonexistent.txt"))

			await expect(fsAPI.delete(uri)).rejects.toThrow()
		})
	})

	describe("createDirectory()", () => {
		it("should create a directory", async () => {
			const dirPath = path.join(tempDir, "new-dir")
			const uri = Uri.file(dirPath)

			await fsAPI.createDirectory(uri)

			expect(fs.existsSync(dirPath)).toBe(true)
			expect(fs.statSync(dirPath).isDirectory()).toBe(true)
		})

		it("should create nested directories", async () => {
			const dirPath = path.join(tempDir, "a", "b", "c")
			const uri = Uri.file(dirPath)

			await fsAPI.createDirectory(uri)

			expect(fs.existsSync(dirPath)).toBe(true)
		})
	})
})
