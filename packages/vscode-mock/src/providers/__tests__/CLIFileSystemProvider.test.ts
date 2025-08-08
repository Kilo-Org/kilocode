import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { CLIFileSystemProvider } from "../CLIFileSystemProvider"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

describe("CLIFileSystemProvider", () => {
	let provider: CLIFileSystemProvider
	let tempDir: string

	beforeEach(async () => {
		provider = new CLIFileSystemProvider()
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cli-fs-test-"))
	})

	afterEach(async () => {
		// Clean up temp directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	describe("file operations", () => {
		it("should read and write files", async () => {
			const testFile = path.join(tempDir, "test.txt")
			const content = "Hello, World!"

			await provider.writeFile(testFile, content)
			expect(await provider.exists(testFile)).toBe(true)

			const readContent = await provider.readFile(testFile)
			expect(readContent).toBe(content)
		})

		it("should read files as buffer", async () => {
			const testFile = path.join(tempDir, "buffer-test.txt")
			const content = "Buffer test content"

			await provider.writeFile(testFile, content)
			const buffer = await provider.readFileBuffer(testFile)

			expect(buffer).toBeInstanceOf(Buffer)
			expect(buffer.toString()).toBe(content)
		})

		it("should write buffer content", async () => {
			const testFile = path.join(tempDir, "buffer-write.txt")
			const buffer = Buffer.from("Buffer content", "utf8")

			await provider.writeFile(testFile, buffer)
			const readContent = await provider.readFile(testFile)

			expect(readContent).toBe("Buffer content")
		})

		it("should append to files", async () => {
			const testFile = path.join(tempDir, "append-test.txt")
			const initialContent = "Initial content\n"
			const appendContent = "Appended content"

			await provider.writeFile(testFile, initialContent)
			await provider.appendFile(testFile, appendContent)

			const finalContent = await provider.readFile(testFile)
			expect(finalContent).toBe(initialContent + appendContent)
		})

		it("should handle different encodings", async () => {
			const testFile = path.join(tempDir, "encoding-test.txt")
			const content = "Encoding test: éñçødîñg"

			await provider.writeFile(testFile, content, "utf8")
			const readContent = await provider.readFile(testFile, "utf8")

			expect(readContent).toBe(content)
		})

		it("should throw error for non-existent files", async () => {
			const nonExistentFile = path.join(tempDir, "does-not-exist.txt")

			await expect(provider.readFile(nonExistentFile)).rejects.toThrow()
			await expect(provider.readFileBuffer(nonExistentFile)).rejects.toThrow()
		})
	})

	describe("directory operations", () => {
		it("should create directories", async () => {
			const testDir = path.join(tempDir, "test-dir")

			await provider.mkdir(testDir)
			expect(await provider.exists(testDir)).toBe(true)

			const stats = await provider.stat(testDir)
			expect(stats.isDirectory).toBe(true)
		})

		it("should create nested directories", async () => {
			const nestedDir = path.join(tempDir, "nested", "deep", "directory")

			await provider.mkdir(nestedDir, true)
			expect(await provider.exists(nestedDir)).toBe(true)
		})

		it("should list directory contents", async () => {
			const testDir = path.join(tempDir, "list-test")
			await provider.mkdir(testDir)

			// Create test files and directories
			await provider.writeFile(path.join(testDir, "file1.txt"), "content1")
			await provider.writeFile(path.join(testDir, "file2.txt"), "content2")
			await provider.mkdir(path.join(testDir, "subdir"))

			const entries = await provider.readdir(testDir)

			expect(entries).toHaveLength(3)
			expect(entries.map((e) => e.name).sort()).toEqual(["file1.txt", "file2.txt", "subdir"])

			const file1Entry = entries.find((e) => e.name === "file1.txt")
			const subdirEntry = entries.find((e) => e.name === "subdir")

			expect(file1Entry?.isFile).toBe(true)
			expect(file1Entry?.isDirectory).toBe(false)
			expect(subdirEntry?.isFile).toBe(false)
			expect(subdirEntry?.isDirectory).toBe(true)
		})

		it("should remove directories", async () => {
			const testDir = path.join(tempDir, "remove-test")
			await provider.mkdir(testDir)
			expect(await provider.exists(testDir)).toBe(true)

			await provider.rmdir(testDir)
			expect(await provider.exists(testDir)).toBe(false)
		})

		it("should remove directories recursively", async () => {
			const testDir = path.join(tempDir, "recursive-remove")
			const nestedDir = path.join(testDir, "nested")

			await provider.mkdir(nestedDir, true)
			await provider.writeFile(path.join(nestedDir, "file.txt"), "content")

			await provider.rmdir(testDir, true)
			expect(await provider.exists(testDir)).toBe(false)
		})
	})

	describe("file stats and metadata", () => {
		it("should get file stats", async () => {
			const testFile = path.join(tempDir, "stats-test.txt")
			const content = "Stats test content"

			await provider.writeFile(testFile, content)
			const stats = await provider.stat(testFile)

			expect(stats.isFile).toBe(true)
			expect(stats.isDirectory).toBe(false)
			expect(stats.isSymbolicLink).toBe(false)
			expect(stats.size).toBeGreaterThan(0)
			expect(stats.ctime).toBeInstanceOf(Date)
			expect(stats.mtime).toBeInstanceOf(Date)
			expect(stats.atime).toBeInstanceOf(Date)
		})

		it("should get directory stats", async () => {
			const testDir = path.join(tempDir, "dir-stats-test")
			await provider.mkdir(testDir)

			const stats = await provider.stat(testDir)

			expect(stats.isFile).toBe(false)
			expect(stats.isDirectory).toBe(true)
			expect(stats.isSymbolicLink).toBe(false)
		})

		it("should check file existence", async () => {
			const existingFile = path.join(tempDir, "exists.txt")
			const nonExistentFile = path.join(tempDir, "does-not-exist.txt")

			await provider.writeFile(existingFile, "content")

			expect(await provider.exists(existingFile)).toBe(true)
			expect(await provider.exists(nonExistentFile)).toBe(false)
		})
	})

	describe("file operations - copy and move", () => {
		it("should copy files", async () => {
			const sourceFile = path.join(tempDir, "source.txt")
			const destFile = path.join(tempDir, "destination.txt")
			const content = "Copy test content"

			await provider.writeFile(sourceFile, content)
			await provider.copy(sourceFile, destFile)

			expect(await provider.exists(destFile)).toBe(true)
			expect(await provider.readFile(destFile)).toBe(content)
			expect(await provider.exists(sourceFile)).toBe(true) // Original should still exist
		})

		it("should copy directories recursively", async () => {
			const sourceDir = path.join(tempDir, "source-dir")
			const destDir = path.join(tempDir, "dest-dir")

			await provider.mkdir(sourceDir)
			await provider.writeFile(path.join(sourceDir, "file.txt"), "content")
			await provider.mkdir(path.join(sourceDir, "subdir"))
			await provider.writeFile(path.join(sourceDir, "subdir", "nested.txt"), "nested content")

			await provider.copy(sourceDir, destDir, { recursive: true })

			expect(await provider.exists(destDir)).toBe(true)
			expect(await provider.exists(path.join(destDir, "file.txt"))).toBe(true)
			expect(await provider.exists(path.join(destDir, "subdir", "nested.txt"))).toBe(true)
			expect(await provider.readFile(path.join(destDir, "file.txt"))).toBe("content")
		})

		it("should move files", async () => {
			const sourceFile = path.join(tempDir, "move-source.txt")
			const destFile = path.join(tempDir, "move-dest.txt")
			const content = "Move test content"

			await provider.writeFile(sourceFile, content)
			await provider.move(sourceFile, destFile)

			expect(await provider.exists(destFile)).toBe(true)
			expect(await provider.exists(sourceFile)).toBe(false) // Original should be gone
			expect(await provider.readFile(destFile)).toBe(content)
		})

		it("should handle copy with overwrite option", async () => {
			const sourceFile = path.join(tempDir, "overwrite-source.txt")
			const destFile = path.join(tempDir, "overwrite-dest.txt")

			await provider.writeFile(sourceFile, "new content")
			await provider.writeFile(destFile, "old content")

			await provider.copy(sourceFile, destFile, { overwrite: true })
			expect(await provider.readFile(destFile)).toBe("new content")
		})
	})

	describe("file removal", () => {
		it("should remove files", async () => {
			const testFile = path.join(tempDir, "remove-file.txt")
			await provider.writeFile(testFile, "content")

			expect(await provider.exists(testFile)).toBe(true)
			await provider.unlink(testFile)
			expect(await provider.exists(testFile)).toBe(false)
		})

		it("should throw error when removing non-existent file", async () => {
			const nonExistentFile = path.join(tempDir, "does-not-exist.txt")
			await expect(provider.unlink(nonExistentFile)).rejects.toThrow()
		})
	})

	describe("path operations", () => {
		it("should resolve paths", () => {
			const relativePath = "test/file.txt"
			const basePath = tempDir
			const resolved = provider.resolvePath(relativePath, basePath)

			expect(path.isAbsolute(resolved)).toBe(true)
			expect(resolved).toContain("test/file.txt")
		})

		it("should get relative paths", () => {
			const from = path.join(tempDir, "from")
			const to = path.join(tempDir, "to", "file.txt")
			const relative = provider.relativePath(from, to)

			expect(relative).toBe(path.join("..", "to", "file.txt"))
		})

		it("should join paths", () => {
			const joined = provider.joinPath("path", "to", "file.txt")
			expect(joined).toBe(path.join("path", "to", "file.txt"))
		})

		it("should get directory name", () => {
			const filePath = path.join("path", "to", "file.txt")
			const dirname = provider.dirname(filePath)
			expect(dirname).toBe(path.join("path", "to"))
		})

		it("should get base name", () => {
			const filePath = path.join("path", "to", "file.txt")
			expect(provider.basename(filePath)).toBe("file.txt")
			expect(provider.basename(filePath, ".txt")).toBe("file")
		})

		it("should get extension", () => {
			const filePath = path.join("path", "to", "file.txt")
			expect(provider.extname(filePath)).toBe(".txt")
		})
	})

	describe("file watching", () => {
		it("should create file watcher", async () => {
			const testFile = path.join(tempDir, "watch-test.txt")
			let changeDetected = false
			let eventType: string | undefined
			let eventPath: string | undefined

			const watcher = provider.watch(testFile, (event) => {
				changeDetected = true
				eventType = event.type
				eventPath = event.path
			})

			expect(watcher).toBeDefined()
			expect(typeof watcher.dispose).toBe("function")

			// Create the file to trigger a change event
			await provider.writeFile(testFile, "initial content")

			// Give the watcher some time to detect the change
			await new Promise((resolve) => setTimeout(resolve, 100))

			watcher.dispose()

			// Note: File watching behavior can be platform-dependent and timing-sensitive
			// So we mainly test that the watcher can be created and disposed
		})

		it("should dispose file watcher", () => {
			const watcher = provider.watch(tempDir, () => {})
			expect(() => watcher.dispose()).not.toThrow()
		})
	})

	describe("error handling", () => {
		it("should handle permission errors gracefully", async () => {
			// This test might be platform-specific
			const restrictedPath = "/root/restricted-file.txt"

			// These operations should throw errors, not crash
			await expect(provider.readFile(restrictedPath)).rejects.toThrow()
			await expect(provider.writeFile(restrictedPath, "content")).rejects.toThrow()
		})

		it("should handle invalid paths", async () => {
			const invalidPath = "\0invalid\0path"

			await expect(provider.exists(invalidPath)).rejects.toThrow()
			await expect(provider.readFile(invalidPath)).rejects.toThrow()
		})
	})
})
