// npx vitest core/ignore/__tests__/RooIgnoreController.spec.ts

import type { Mock } from "vitest"

import { RooIgnoreController, LOCK_TEXT_SYMBOL } from "../RooIgnoreController"
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"
import * as fsSync from "fs"
import { fileExistsAtPath } from "../../../utils/fs"

// Mock dependencies
vi.mock("fs/promises")
vi.mock("fs")
vi.mock("../../../utils/fs")

// Mock vscode
vi.mock("vscode", () => {
	const mockDisposable = { dispose: vi.fn() }
	const mockEventEmitter = {
		event: vi.fn(),
		fire: vi.fn(),
	}

	return {
		workspace: {
			createFileSystemWatcher: vi.fn(() => ({
				onDidCreate: vi.fn(() => mockDisposable),
				onDidChange: vi.fn(() => mockDisposable),
				onDidDelete: vi.fn(() => mockDisposable),
				dispose: vi.fn(),
			})),
		},
		RelativePattern: vi.fn().mockImplementation((base, pattern) => ({
			base,
			pattern,
		})),
		EventEmitter: vi.fn().mockImplementation(() => mockEventEmitter),
		Disposable: {
			from: vi.fn(),
		},
	}
})

describe("RooIgnoreController", () => {
	const TEST_CWD = "/test/path"
	let controller: RooIgnoreController
	let mockFileExists: Mock<typeof fileExistsAtPath>
	let mockReadFile: Mock<typeof fs.readFile>
	let mockWatcher: any

	beforeEach(() => {
		// Reset mocks
		vi.clearAllMocks()

		// Setup mock file watcher
		mockWatcher = {
			onDidCreate: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			onDidDelete: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			dispose: vi.fn(),
		}

		// @ts-expect-error - Mocking
		vscode.workspace.createFileSystemWatcher.mockReturnValue(mockWatcher)

		// Setup fs mocks
		mockFileExists = fileExistsAtPath as Mock<typeof fileExistsAtPath>
		mockReadFile = fs.readFile as Mock<typeof fs.readFile>

		// Setup fsSync mocks with default behavior (return path as-is, like regular files)
		const mockRealpathSync = vi.mocked(fsSync.realpathSync)
		mockRealpathSync.mockImplementation((filePath) => filePath.toString())

		// Create controller
		controller = new RooIgnoreController(TEST_CWD)
	})

	describe("initialization", () => {
		/**
		 * Tests the controller initialization when .kilocodeignore exists
		 */
		it("should load .kilocodeignore patterns on initialization when file exists", async () => {
			// Setup mocks to simulate existing .kilocodeignore file
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets.json")

			// Initialize controller
			await controller.initialize()

			// Verify file was checked and read
			expect(mockFileExists).toHaveBeenCalledWith(path.join(TEST_CWD, ".kilocodeignore"))
			expect(mockReadFile).toHaveBeenCalledWith(path.join(TEST_CWD, ".kilocodeignore"), "utf8")

			// Verify content was stored
			expect(controller.rooIgnoreContent).toBe("node_modules\n.git\nsecrets.json")

			// Test that ignore patterns were applied
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess("src/app.ts")).toBe(true)
			expect(controller.validateAccess(".git/config")).toBe(false)
			expect(controller.validateAccess("secrets.json")).toBe(false)
		})

		/**
		 * Tests the controller behavior when .kilocodeignore doesn't exist
		 */
		it("should allow all access when .kilocodeignore doesn't exist", async () => {
			// Setup mocks to simulate missing .kilocodeignore file
			mockFileExists.mockResolvedValue(false)

			// Initialize controller
			await controller.initialize()

			// Verify no content was stored
			expect(controller.rooIgnoreContent).toBeUndefined()

			// All files should be accessible
			expect(controller.validateAccess("node_modules/package.json")).toBe(true)
			expect(controller.validateAccess("secrets.json")).toBe(true)
		})

		/**
		 * Tests the file watcher setup
		 */
		it("should set up file watcher for .kilocodeignore changes", async () => {
			// Check that watcher was created with correct pattern
			expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledWith(
				expect.objectContaining({
					base: TEST_CWD,
					pattern: ".kilocodeignore",
				}),
			)

			// Verify event handlers were registered
			expect(mockWatcher.onDidCreate).toHaveBeenCalled()
			expect(mockWatcher.onDidChange).toHaveBeenCalled()
			expect(mockWatcher.onDidDelete).toHaveBeenCalled()
		})

		/**
		 * Tests error handling during initialization
		 */
		it("should handle errors when loading .kilocodeignore", async () => {
			// Setup mocks to simulate error
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockRejectedValue(new Error("Test file read error"))

			// Spy on console.error
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Initialize controller - shouldn't throw
			await controller.initialize()

			// Verify error was logged
			expect(consoleSpy).toHaveBeenCalledWith("Unexpected error loading .kilocodeignore:", expect.any(Error))

			// Cleanup
			consoleSpy.mockRestore()
		})
	})

	describe("validateAccess", () => {
		beforeEach(async () => {
			// Setup .kilocodeignore content
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets/**\n*.log")
			await controller.initialize()
		})

		/**
		 * Tests basic path validation
		 */
		it("should correctly validate file access based on ignore patterns", () => {
			// Test different path patterns
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess("node_modules")).toBe(false)
			expect(controller.validateAccess("src/node_modules/file.js")).toBe(false)
			expect(controller.validateAccess(".git/HEAD")).toBe(false)
			expect(controller.validateAccess("secrets/api-keys.json")).toBe(false)
			expect(controller.validateAccess("logs/app.log")).toBe(false)

			// These should be allowed
			expect(controller.validateAccess("src/app.ts")).toBe(true)
			expect(controller.validateAccess("package.json")).toBe(true)
			expect(controller.validateAccess("secret-file.json")).toBe(true)
		})

		/**
		 * Tests handling of absolute paths
		 */
		it("should handle absolute paths correctly", () => {
			// Test with absolute paths
			const absolutePath = path.join(TEST_CWD, "node_modules/package.json")
			expect(controller.validateAccess(absolutePath)).toBe(false)

			const allowedAbsolutePath = path.join(TEST_CWD, "src/app.ts")
			expect(controller.validateAccess(allowedAbsolutePath)).toBe(true)
		})

		/**
		 * Tests handling of paths outside cwd
		 */
		it("should allow access to paths outside cwd", () => {
			// Path traversal outside cwd
			expect(controller.validateAccess("../outside-project/file.txt")).toBe(true)

			// Completely different path
			expect(controller.validateAccess("/etc/hosts")).toBe(true)
		})

		/**
		 * Tests the default behavior when no .kilocodeignore exists
		 */
		it("should allow all access when no .kilocodeignore content", async () => {
			// Create a new controller with no .kilocodeignore
			mockFileExists.mockResolvedValue(false)
			const emptyController = new RooIgnoreController(TEST_CWD)
			await emptyController.initialize()

			// All paths should be allowed
			expect(emptyController.validateAccess("node_modules/package.json")).toBe(true)
			expect(emptyController.validateAccess("secrets/api-keys.json")).toBe(true)
			expect(emptyController.validateAccess(".git/HEAD")).toBe(true)
		})

		/**
		 * Tests symlink resolution
		 */
		it("should block symlinks pointing to ignored files", () => {
			// Mock fsSync.realpathSync to simulate symlink resolution
			const mockRealpathSync = vi.mocked(fsSync.realpathSync)
			mockRealpathSync.mockImplementation((filePath) => {
				// Simulate "config.json" being a symlink to "node_modules/package.json"
				if (filePath.toString().endsWith("config.json")) {
					return path.join(TEST_CWD, "node_modules/package.json")
				}
				return filePath.toString()
			})

			// Direct access to ignored file should be blocked
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)

			// Symlink to ignored file should also be blocked
			expect(controller.validateAccess("config.json")).toBe(false)
		})
	})

	describe("validateCommand", () => {
		beforeEach(async () => {
			// Setup .kilocodeignore content
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets/**\n*.log")
			await controller.initialize()
		})

		/**
		 * Tests validation of file reading commands
		 */
		it("should block file reading commands accessing ignored files", () => {
			// Cat command accessing ignored file
			expect(controller.validateCommand("cat node_modules/package.json")).toBe("node_modules/package.json")

			// Grep command accessing ignored file
			expect(controller.validateCommand("grep pattern .git/config")).toBe(".git/config")

			// Commands accessing allowed files should return undefined
			expect(controller.validateCommand("cat src/app.ts")).toBeUndefined()
			expect(controller.validateCommand("less README.md")).toBeUndefined()
		})

		/**
		 * Tests commands with various arguments and flags
		 */
		it("should handle command arguments and flags correctly", () => {
			// Command with flags
			expect(controller.validateCommand("cat -n node_modules/package.json")).toBe("node_modules/package.json")

			// Command with multiple files (only first ignored file is returned)
			expect(controller.validateCommand("grep pattern src/app.ts node_modules/index.js")).toBe(
				"node_modules/index.js",
			)

			// Command with PowerShell parameter style
			expect(controller.validateCommand("Get-Content -Path secrets/api-keys.json")).toBe("secrets/api-keys.json")

			// Arguments with colons are skipped due to the implementation
			// Adjust test to match actual implementation which skips arguments with colons
			expect(controller.validateCommand("Select-String -Path secrets/api-keys.json -Pattern key")).toBe(
				"secrets/api-keys.json",
			)
		})

		/**
		 * Tests validation of non-file-reading commands
		 */
		it("should allow non-file-reading commands", () => {
			// Commands that don't access files directly
			expect(controller.validateCommand("ls -la")).toBeUndefined()
			expect(controller.validateCommand("echo 'Hello'")).toBeUndefined()
			expect(controller.validateCommand("cd node_modules")).toBeUndefined()
			expect(controller.validateCommand("npm install")).toBeUndefined()
		})

		/**
		 * Tests behavior when no .kilocodeignore exists
		 */
		it("should allow all commands when no .kilocodeignore exists", async () => {
			// Create a new controller with no .kilocodeignore
			mockFileExists.mockResolvedValue(false)
			const emptyController = new RooIgnoreController(TEST_CWD)
			await emptyController.initialize()

			// All commands should be allowed
			expect(emptyController.validateCommand("cat node_modules/package.json")).toBeUndefined()
			expect(emptyController.validateCommand("grep pattern .git/config")).toBeUndefined()
		})
	})

	describe("filterPaths", () => {
		beforeEach(async () => {
			// Setup .kilocodeignore content
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets/**\n*.log")
			await controller.initialize()
		})

		/**
		 * Tests filtering an array of paths
		 */
		it("should filter out ignored paths from an array", () => {
			const paths = [
				"src/app.ts",
				"node_modules/package.json",
				"README.md",
				".git/HEAD",
				"secrets/keys.json",
				"build/app.js",
				"logs/error.log",
			]

			const filtered = controller.filterPaths(paths)

			// Expected filtered result
			expect(filtered).toEqual(["src/app.ts", "README.md", "build/app.js"])

			// Length should be reduced
			expect(filtered.length).toBe(3)
		})

		/**
		 * Tests error handling in filterPaths
		 */
		it("should handle errors in filterPaths and fail closed", () => {
			// Mock validateAccess to throw an error
			vi.spyOn(controller, "validateAccess").mockImplementation(() => {
				throw new Error("Test error")
			})

			// Spy on console.error
			const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

			// Should return empty array on error (fail closed)
			const result = controller.filterPaths(["file1.txt", "file2.txt"])
			expect(result).toEqual([])

			// Verify error was logged
			expect(consoleSpy).toHaveBeenCalledWith("Error filtering paths:", expect.any(Error))

			// Cleanup
			consoleSpy.mockRestore()
		})

		/**
		 * Tests empty array handling
		 */
		it("should handle empty arrays", () => {
			const result = controller.filterPaths([])
			expect(result).toEqual([])
		})
	})

	describe("getInstructions", () => {
		/**
		 * Tests instructions generation with .kilocodeignore
		 */
		it("should generate formatted instructions when .kilocodeignore exists", async () => {
			// Setup .kilocodeignore content
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules\n.git\nsecrets/**")
			await controller.initialize()

			const instructions = controller.getInstructions()

			// Verify instruction format
			expect(instructions).toContain("# .kilocodeignore")
			expect(instructions).toContain(LOCK_TEXT_SYMBOL)
			expect(instructions).toContain("node_modules")
			expect(instructions).toContain(".git")
			expect(instructions).toContain("secrets/**")
		})

		/**
		 * Tests behavior when no .kilocodeignore exists
		 */
		it("should return undefined when no .kilocodeignore exists", async () => {
			// Setup no .kilocodeignore
			mockFileExists.mockResolvedValue(false)
			await controller.initialize()

			const instructions = controller.getInstructions()
			expect(instructions).toBeUndefined()
		})
	})

	describe("dispose", () => {
		/**
		 * Tests proper cleanup of resources
		 */
		it("should dispose all registered disposables", () => {
			// Create spy for dispose methods
			const disposeSpy = vi.fn()

			// Manually add disposables to test
			controller["disposables"] = [{ dispose: disposeSpy }, { dispose: disposeSpy }, { dispose: disposeSpy }]

			// Call dispose
			controller.dispose()

			// Verify all disposables were disposed
			expect(disposeSpy).toHaveBeenCalledTimes(3)

			// Verify disposables array was cleared
			expect(controller["disposables"]).toEqual([])
		})
	})

	describe("file watcher", () => {
		/**
		 * Tests behavior when .kilocodeignore is created
		 */
		it("should reload .kilocodeignore when file is created", async () => {
			// Setup initial state without .kilocodeignore
			mockFileExists.mockResolvedValue(false)
			await controller.initialize()

			// Verify initial state
			expect(controller.rooIgnoreContent).toBeUndefined()
			expect(controller.validateAccess("node_modules/package.json")).toBe(true)

			// Setup for the test
			mockFileExists.mockResolvedValue(false) // Initially no file exists

			// Create and initialize controller with no .kilocodeignore
			controller = new RooIgnoreController(TEST_CWD)
			await controller.initialize()

			// Initial state check
			expect(controller.rooIgnoreContent).toBeUndefined()

			// Now simulate file creation
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules")

			// Force reload of .kilocodeignore content manually
			await controller.initialize()

			// Now verify content was updated
			expect(controller.rooIgnoreContent).toBe("node_modules")

			// Verify access validation changed
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
		})

		/**
		 * Tests behavior when .kilocodeignore is changed
		 */
		it("should reload .kilocodeignore when file is changed", async () => {
			// Setup initial state with .kilocodeignore
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules")
			await controller.initialize()

			// Verify initial state
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess(".git/config")).toBe(true)

			// Simulate file change
			mockReadFile.mockResolvedValue("node_modules\n.git")

			// Instead of relying on the onChange handler, manually reload
			// This is because the mock watcher doesn't actually trigger the reload in tests
			await controller.initialize()

			// Verify content was updated
			expect(controller.rooIgnoreContent).toBe("node_modules\n.git")

			// Verify access validation changed
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)
			expect(controller.validateAccess(".git/config")).toBe(false)
		})

		/**
		 * Tests behavior when .kilocodeignore is deleted
		 */
		it("should reset when .kilocodeignore is deleted", async () => {
			// Setup initial state with .kilocodeignore
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules")
			await controller.initialize()

			// Verify initial state
			expect(controller.validateAccess("node_modules/package.json")).toBe(false)

			// Simulate file deletion
			mockFileExists.mockResolvedValue(false)

			// Find and trigger the onDelete handler
			const onDeleteHandler = mockWatcher.onDidDelete.mock.calls[0][0]
			await onDeleteHandler()

			// Verify content was reset
			expect(controller.rooIgnoreContent).toBeUndefined()

			// Verify access validation changed
			expect(controller.validateAccess("node_modules/package.json")).toBe(true)
		})
	})

	describe("global ignore patterns", () => {  // kilocode_change start
		/**
		 * Tests that global patterns work without .kilocodeignore
		 */
		it("should block globally ignored files even without .kilocodeignore", async () => {
			// Setup global patterns but no .kilocodeignore
			// Note: Use .env* (with wildcard) to match .env.production, .env.local, etc.
			const globalPatterns = [".env*", "*.key", "id_rsa"]
			const controllerWithGlobal = new RooIgnoreController(TEST_CWD, globalPatterns)

			mockFileExists.mockResolvedValue(false) // No .kilocodeignore
			await controllerWithGlobal.initialize()

			// Verify no .kilocodeignore content
			expect(controllerWithGlobal.rooIgnoreContent).toBeUndefined()

			// Global patterns should still block access
			expect(controllerWithGlobal.validateAccess(".env")).toBe(false)
			expect(controllerWithGlobal.validateAccess(".env.production")).toBe(false)
			expect(controllerWithGlobal.validateAccess(".env.local")).toBe(false)
			expect(controllerWithGlobal.validateAccess("config.key")).toBe(false)
			expect(controllerWithGlobal.validateAccess("id_rsa")).toBe(false)

			// Non-matching files should be allowed
			expect(controllerWithGlobal.validateAccess("src/app.ts")).toBe(true)
			expect(controllerWithGlobal.validateAccess("README.md")).toBe(true)
			expect(controllerWithGlobal.validateAccess("environment.ts")).toBe(true) // Should not match .env*
		})

		/**
		 * Tests that global patterns take priority over .kilocodeignore
		 */
		it("should give priority to global patterns over .kilocodeignore", async () => {
			// Setup global patterns with wildcard
			const globalPatterns = [".env*", "*.key"]
			const controllerWithGlobal = new RooIgnoreController(TEST_CWD, globalPatterns)

			// Setup .kilocodeignore that tries to allow .env but blocks other files
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules\n!.env*") // Negation pattern to try to allow .env
			await controllerWithGlobal.initialize()

			// Global pattern should take priority - .env files should still be blocked
			expect(controllerWithGlobal.validateAccess(".env")).toBe(false)
			expect(controllerWithGlobal.validateAccess(".env.local")).toBe(false)

			// Global patterns should block regardless of .kilocodeignore
			expect(controllerWithGlobal.validateAccess("config.key")).toBe(false)

			// .kilocodeignore patterns should still work
			expect(controllerWithGlobal.validateAccess("node_modules/package.json")).toBe(false)
		})

		/**
		 * Tests updateGlobalIgnorePatterns method
		 */
		it("should update global patterns dynamically", async () => {
			// Start with some patterns
			const controllerWithGlobal = new RooIgnoreController(TEST_CWD, [".env*"])
			mockFileExists.mockResolvedValue(false)
			await controllerWithGlobal.initialize()

			// Verify initial pattern works
			expect(controllerWithGlobal.validateAccess(".env")).toBe(false)
			expect(controllerWithGlobal.validateAccess(".env.local")).toBe(false)
			expect(controllerWithGlobal.validateAccess("config.key")).toBe(true)

			// Update patterns
			controllerWithGlobal.updateGlobalIgnorePatterns([".env*", "*.key", "*.pem"])

			// Verify updated patterns work
			expect(controllerWithGlobal.validateAccess(".env")).toBe(false)
			expect(controllerWithGlobal.validateAccess(".env.production")).toBe(false)
			expect(controllerWithGlobal.validateAccess("config.key")).toBe(false)
			expect(controllerWithGlobal.validateAccess("cert.pem")).toBe(false)
			expect(controllerWithGlobal.validateAccess("src/app.ts")).toBe(true)
		})

		/**
		 * Tests clearing global patterns
		 */
		it("should allow clearing all global patterns", async () => {
			// Start with patterns
			const controllerWithGlobal = new RooIgnoreController(TEST_CWD, [".env*", "*.key"])
			mockFileExists.mockResolvedValue(false)
			await controllerWithGlobal.initialize()

			// Verify patterns work
			expect(controllerWithGlobal.validateAccess(".env")).toBe(false)
			expect(controllerWithGlobal.validateAccess(".env.local")).toBe(false)
			expect(controllerWithGlobal.validateAccess("config.key")).toBe(false)

			// Clear patterns
			controllerWithGlobal.updateGlobalIgnorePatterns([])

			// Verify patterns no longer block
			expect(controllerWithGlobal.validateAccess(".env")).toBe(true)
			expect(controllerWithGlobal.validateAccess(".env.local")).toBe(true)
			expect(controllerWithGlobal.validateAccess("config.key")).toBe(true)
		})

		/**
		 * Tests complex glob patterns in global ignore
		 */
		it("should support complex glob patterns", async () => {
			const globalPatterns = [
				".env*", // Wildcard suffix
				"*.pem", // Wildcard prefix
				"secrets/**", // Directory glob
				"id_*", // Partial wildcard
			]
			const controllerWithGlobal = new RooIgnoreController(TEST_CWD, globalPatterns)
			mockFileExists.mockResolvedValue(false)
			await controllerWithGlobal.initialize()

			// Test wildcard suffix
			expect(controllerWithGlobal.validateAccess(".env")).toBe(false)
			expect(controllerWithGlobal.validateAccess(".env.local")).toBe(false)
			expect(controllerWithGlobal.validateAccess(".env.production")).toBe(false)

			// Test wildcard prefix
			expect(controllerWithGlobal.validateAccess("cert.pem")).toBe(false)
			expect(controllerWithGlobal.validateAccess("key.pem")).toBe(false)

			// Test directory glob
			expect(controllerWithGlobal.validateAccess("secrets/api-key.txt")).toBe(false)
			expect(controllerWithGlobal.validateAccess("secrets/nested/file.txt")).toBe(false)

			// Test partial wildcard
			expect(controllerWithGlobal.validateAccess("id_rsa")).toBe(false)
			expect(controllerWithGlobal.validateAccess("id_dsa")).toBe(false)
			expect(controllerWithGlobal.validateAccess("id_ecdsa")).toBe(false)

			// Non-matching should be allowed
			expect(controllerWithGlobal.validateAccess("environment.ts")).toBe(true)
			expect(controllerWithGlobal.validateAccess("config.json")).toBe(true)
		})

		/**
		 * Tests that both global and .kilocodeignore patterns work together
		 */
		it("should enforce both global and .kilocodeignore patterns", async () => {
			// Setup global patterns with wildcards
			const globalPatterns = [".env*", "*.key"]
			const controllerWithGlobal = new RooIgnoreController(TEST_CWD, globalPatterns)

			// Setup .kilocodeignore with different patterns
			mockFileExists.mockResolvedValue(true)
			mockReadFile.mockResolvedValue("node_modules\n*.log")
			await controllerWithGlobal.initialize()

			// Global patterns should block
			expect(controllerWithGlobal.validateAccess(".env")).toBe(false)
			expect(controllerWithGlobal.validateAccess(".env.local")).toBe(false)
			expect(controllerWithGlobal.validateAccess("config.key")).toBe(false)

			// .kilocodeignore patterns should also block
			expect(controllerWithGlobal.validateAccess("node_modules/package.json")).toBe(false)
			expect(controllerWithGlobal.validateAccess("app.log")).toBe(false)

			// Files not matching either should be allowed
			expect(controllerWithGlobal.validateAccess("src/app.ts")).toBe(true)
			expect(controllerWithGlobal.validateAccess("config.json")).toBe(true)
		})

		/**
		 * Tests default globally ignored files from DEFAULT_GLOBALLY_IGNORED_FILES
		 */
		it("should work with DEFAULT_GLOBALLY_IGNORED_FILES patterns", async () => {
			// Import the defaults
			const { DEFAULT_GLOBALLY_IGNORED_FILES } = await import("@roo-code/types")

			const controllerWithDefaults = new RooIgnoreController(TEST_CWD, DEFAULT_GLOBALLY_IGNORED_FILES)
			mockFileExists.mockResolvedValue(false)
			await controllerWithDefaults.initialize()

			// Test common sensitive files from defaults
			expect(controllerWithDefaults.validateAccess(".env")).toBe(false)
			expect(controllerWithDefaults.validateAccess(".env.local")).toBe(false)
			expect(controllerWithDefaults.validateAccess("private.key")).toBe(false)
			expect(controllerWithDefaults.validateAccess("cert.pem")).toBe(false)
			expect(controllerWithDefaults.validateAccess("id_rsa")).toBe(false)
			expect(controllerWithDefaults.validateAccess("id_ed25519")).toBe(false)
			expect(controllerWithDefaults.validateAccess("key.gpg")).toBe(false)

			// Regular files should be allowed
			expect(controllerWithDefaults.validateAccess("src/config.ts")).toBe(true)
			expect(controllerWithDefaults.validateAccess("README.md")).toBe(true)
		})
	})
}) // kilocode_change end
