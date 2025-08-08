import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { VSCodeAPI } from "../api/VSCodeAPI"
import { FileSystemAdapter } from "../adapters/FileSystemAdapter"
import { UserInterfaceAdapter } from "../adapters/UserInterfaceAdapter"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

describe("Performance and Memory Tests", () => {
	let tempDir: string
	let vscodeAPI: VSCodeAPI
	let fileSystemAdapter: FileSystemAdapter
	let userInterfaceAdapter: UserInterfaceAdapter

	beforeEach(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-mock-perf-test-"))
		fileSystemAdapter = new FileSystemAdapter(tempDir)
		userInterfaceAdapter = new UserInterfaceAdapter()
		vscodeAPI = new VSCodeAPI(fileSystemAdapter, userInterfaceAdapter)
	})

	afterEach(() => {
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe("File System Performance", () => {
		it("should handle multiple file operations efficiently", async () => {
			const startTime = Date.now()
			const fileCount = 50
			const operations: Promise<void>[] = []

			// Create multiple files concurrently
			for (let i = 0; i < fileCount; i++) {
				const uri = VSCodeAPI.Uri.file(path.join(tempDir, `test-file-${i}.txt`))
				const content = new TextEncoder().encode(`Content for file ${i}`)
				operations.push(vscodeAPI.workspace.fs.writeFile(uri, content))
			}

			await Promise.all(operations)

			// Read all files back
			const readOperations: Promise<Uint8Array>[] = []
			for (let i = 0; i < fileCount; i++) {
				const uri = VSCodeAPI.Uri.file(path.join(tempDir, `test-file-${i}.txt`))
				readOperations.push(vscodeAPI.workspace.fs.readFile(uri))
			}

			const results = await Promise.all(readOperations)
			const endTime = Date.now()

			expect(results).toHaveLength(fileCount)
			expect(endTime - startTime).toBeLessThan(5000) // Should complete within 5 seconds
		})

		it("should handle large file operations", async () => {
			const largeContent = "x".repeat(1024 * 1024) // 1MB of content
			const uri = VSCodeAPI.Uri.file(path.join(tempDir, "large-file.txt"))
			const encodedContent = new TextEncoder().encode(largeContent)

			const startTime = Date.now()

			// Write large file
			await vscodeAPI.workspace.fs.writeFile(uri, encodedContent)

			// Read large file back
			const readContent = await vscodeAPI.workspace.fs.readFile(uri)
			const decodedContent = new TextDecoder().decode(readContent)

			const endTime = Date.now()

			expect(decodedContent).toBe(largeContent)
			expect(endTime - startTime).toBeLessThan(2000) // Should complete within 2 seconds
		})

		it("should handle rapid stat operations", async () => {
			// Create test files
			const fileCount = 100
			const uris: any[] = []

			for (let i = 0; i < fileCount; i++) {
				const uri = VSCodeAPI.Uri.file(path.join(tempDir, `stat-test-${i}.txt`))
				uris.push(uri)
				await vscodeAPI.workspace.fs.writeFile(uri, new TextEncoder().encode(`File ${i}`))
			}

			const startTime = Date.now()

			// Perform rapid stat operations
			const statPromises = uris.map((uri) => vscodeAPI.workspace.fs.stat(uri))
			const stats = await Promise.all(statPromises)

			const endTime = Date.now()

			expect(stats).toHaveLength(fileCount)
			expect(stats.every((stat) => stat.type === 1)).toBe(true) // All should be files
			expect(endTime - startTime).toBeLessThan(3000) // Should complete within 3 seconds
		})
	})

	describe("Configuration Performance", () => {
		it("should handle rapid configuration operations", async () => {
			const config = vscodeAPI.workspace.getConfiguration("performance-test")
			const operationCount = 1000

			const startTime = Date.now()

			// Perform rapid get/set operations
			for (let i = 0; i < operationCount; i++) {
				await config.update(`key-${i}`, `value-${i}`)
				const value = config.get(`key-${i}`)
				expect(value).toBe(`value-${i}`)
			}

			const endTime = Date.now()
			expect(endTime - startTime).toBeLessThan(1000) // Should complete within 1 second
		})
	})

	describe("Event System Performance", () => {
		it("should handle multiple event listeners efficiently", () => {
			const listenerCount = 100
			const watchers: any[] = []
			const disposables: any[] = []

			const startTime = Date.now()

			// Create multiple file watchers with listeners
			for (let i = 0; i < listenerCount; i++) {
				const watcher = vscodeAPI.workspace.createFileSystemWatcher(`**/*-${i}.txt`)
				watchers.push(watcher)

				const createDisposable = watcher.onDidCreate(() => {})
				const changeDisposable = watcher.onDidChange(() => {})
				const deleteDisposable = watcher.onDidDelete(() => {})

				disposables.push(createDisposable, changeDisposable, deleteDisposable)
			}

			// Dispose all listeners
			disposables.forEach((disposable) => disposable.dispose())
			watchers.forEach((watcher) => watcher.dispose())

			const endTime = Date.now()

			expect(watchers).toHaveLength(listenerCount)
			expect(disposables).toHaveLength(listenerCount * 3)
			expect(endTime - startTime).toBeLessThan(500) // Should complete within 500ms
		})

		it("should handle rapid disposable creation and disposal", () => {
			const disposableCount = 1000
			const disposables: any[] = []

			const startTime = Date.now()

			// Create many disposables
			for (let i = 0; i < disposableCount; i++) {
				const disposable = { dispose: () => {} }
				disposables.push(disposable)
			}

			// Create combined disposable
			const combined = VSCodeAPI.Disposable.from(...disposables)
			combined.dispose()

			const endTime = Date.now()

			expect(endTime - startTime).toBeLessThan(100) // Should complete within 100ms
		})
	})

	describe("Memory Usage", () => {
		it("should not leak memory with repeated API calls", async () => {
			const initialMemory = process.memoryUsage().heapUsed
			const iterations = 100

			// Perform repeated operations that could potentially leak memory
			for (let i = 0; i < iterations; i++) {
				// Create and dispose extension contexts
				const context = vscodeAPI.createExtensionContext()
				await context.workspaceState.update(`test-${i}`, `value-${i}`)
				await context.globalState.update(`global-${i}`, `global-value-${i}`)

				// Create and dispose file watchers
				const watcher = vscodeAPI.workspace.createFileSystemWatcher("**/*")
				const disposable = watcher.onDidCreate(() => {})
				disposable.dispose()
				watcher.dispose()

				// Create and dispose decorations
				const decoration = vscodeAPI.window.createTextEditorDecorationType({
					backgroundColor: "red",
				})
				decoration.dispose()

				// Force garbage collection if available
				if (global.gc) {
					global.gc()
				}
			}

			const finalMemory = process.memoryUsage().heapUsed
			const memoryIncrease = finalMemory - initialMemory

			// Memory increase should be reasonable (less than 10MB)
			expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024)
		})

		it("should handle large configuration stores efficiently", async () => {
			const config = vscodeAPI.workspace.getConfiguration("memory-test")
			const keyCount = 10000

			const startTime = Date.now()
			const initialMemory = process.memoryUsage().heapUsed

			// Store many configuration values
			for (let i = 0; i < keyCount; i++) {
				await config.update(`large-key-${i}`, {
					data: `large-value-${i}`,
					timestamp: Date.now(),
					index: i,
					metadata: {
						created: new Date().toISOString(),
						type: "test-data",
					},
				})
			}

			// Retrieve all values
			for (let i = 0; i < keyCount; i++) {
				const value = config.get(`large-key-${i}`)
				expect(value).toBeDefined()
			}

			const endTime = Date.now()
			const finalMemory = process.memoryUsage().heapUsed
			const memoryIncrease = finalMemory - initialMemory

			expect(endTime - startTime).toBeLessThan(5000) // Should complete within 5 seconds
			expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024) // Should use less than 50MB
		})
	})

	describe("Concurrent Operations", () => {
		it("should handle concurrent file and configuration operations", async () => {
			const operationCount = 50
			const startTime = Date.now()

			const fileOperations: Promise<any>[] = []
			const configOperations: Promise<any>[] = []

			// Start concurrent file operations
			for (let i = 0; i < operationCount; i++) {
				const uri = VSCodeAPI.Uri.file(path.join(tempDir, `concurrent-${i}.txt`))
				const content = new TextEncoder().encode(`Concurrent content ${i}`)

				fileOperations.push(
					vscodeAPI.workspace.fs
						.writeFile(uri, content)
						.then(() => vscodeAPI.workspace.fs.readFile(uri))
						.then(() => vscodeAPI.workspace.fs.stat(uri)),
				)
			}

			// Start concurrent configuration operations
			const config = vscodeAPI.workspace.getConfiguration("concurrent-test")
			for (let i = 0; i < operationCount; i++) {
				configOperations.push(
					config
						.update(`concurrent-key-${i}`, `concurrent-value-${i}`)
						.then(() => config.get(`concurrent-key-${i}`)),
				)
			}

			// Wait for all operations to complete
			await Promise.all([...fileOperations, ...configOperations])

			const endTime = Date.now()
			expect(endTime - startTime).toBeLessThan(10000) // Should complete within 10 seconds
		})
	})
})
