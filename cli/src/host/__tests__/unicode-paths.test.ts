import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { FileSystemAPI, Uri } from "../VSCode.js"

describe("Unicode path handling", () => {
	let tempDir: string
	let fileSystemAPI: FileSystemAPI

	beforeEach(() => {
		// Create a temp directory with Unicode characters in the path
		const baseTempDir = os.tmpdir()
		tempDir = path.join(baseTempDir, `kilocode-test-кириллица-中文-${Date.now()}`)
		fs.mkdirSync(tempDir, { recursive: true })
		fileSystemAPI = new FileSystemAPI()
	})

	afterEach(() => {
		// Clean up temp directory
		try {
			fs.rmSync(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("FileSystemAPI.writeFile", () => {
		it("should write content to a file with Cyrillic characters in path", async () => {
			const testContent = "Hello, World! Привет мир!"
			const filePath = path.join(tempDir, "тест.txt")
			const uri = Uri.file(filePath)

			await fileSystemAPI.writeFile(uri, Buffer.from(testContent, "utf-8"))

			const readContent = fs.readFileSync(filePath, "utf-8")
			expect(readContent).toBe(testContent)
		})

		it("should write content to a file with Chinese characters in path", async () => {
			const testContent = "Hello, World! 你好世界!"
			const filePath = path.join(tempDir, "测试.txt")
			const uri = Uri.file(filePath)

			await fileSystemAPI.writeFile(uri, Buffer.from(testContent, "utf-8"))

			const readContent = fs.readFileSync(filePath, "utf-8")
			expect(readContent).toBe(testContent)
		})

		it("should write content to a file with mixed Unicode characters in path", async () => {
			const testContent = "Mixed content: English, Русский, 日本語, العربية"
			const filePath = path.join(tempDir, "mixed-смешанный-混合.txt")
			const uri = Uri.file(filePath)

			await fileSystemAPI.writeFile(uri, Buffer.from(testContent, "utf-8"))

			const readContent = fs.readFileSync(filePath, "utf-8")
			expect(readContent).toBe(testContent)
		})

		it("should write binary content to a file with Unicode path", async () => {
			const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd])
			const filePath = path.join(tempDir, "бинарный.bin")
			const uri = Uri.file(filePath)

			await fileSystemAPI.writeFile(uri, new Uint8Array(binaryContent))

			const readContent = fs.readFileSync(filePath)
			expect(Buffer.compare(readContent, binaryContent)).toBe(0)
		})

		it("should write empty content to a file with Unicode path", async () => {
			const filePath = path.join(tempDir, "пустой.txt")
			const uri = Uri.file(filePath)

			await fileSystemAPI.writeFile(uri, Buffer.from("", "utf-8"))

			const readContent = fs.readFileSync(filePath, "utf-8")
			expect(readContent).toBe("")
		})

		it("should write content with special characters to a file with Unicode path", async () => {
			const testContent = "Special chars: \n\t\r\0 and emoji: 🎉🚀"
			const filePath = path.join(tempDir, "специальные-символы.txt")
			const uri = Uri.file(filePath)

			await fileSystemAPI.writeFile(uri, Buffer.from(testContent, "utf-8"))

			const readContent = fs.readFileSync(filePath, "utf-8")
			expect(readContent).toBe(testContent)
		})
	})

	describe("FileSystemAPI.readFile", () => {
		it("should read content from a file with Cyrillic characters in path", async () => {
			const testContent = "Hello, World! Привет мир!"
			const filePath = path.join(tempDir, "чтение.txt")
			fs.writeFileSync(filePath, testContent, "utf-8")

			const uri = Uri.file(filePath)
			const readContent = await fileSystemAPI.readFile(uri)

			expect(Buffer.from(readContent).toString("utf-8")).toBe(testContent)
		})

		it("should read content from a file with Chinese characters in path", async () => {
			const testContent = "Hello, World! 你好世界!"
			const filePath = path.join(tempDir, "读取.txt")
			fs.writeFileSync(filePath, testContent, "utf-8")

			const uri = Uri.file(filePath)
			const readContent = await fileSystemAPI.readFile(uri)

			expect(Buffer.from(readContent).toString("utf-8")).toBe(testContent)
		})
	})
})
