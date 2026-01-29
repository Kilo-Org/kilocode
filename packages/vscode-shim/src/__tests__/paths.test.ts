import * as fs from "fs"
import * as path from "path"
import { tmpdir } from "os"

import { VSCodeMockPaths } from "../utils/paths.js"

describe("VSCodeMockPaths", () => {
	let originalHome: string | undefined
	let tempDir: string

	beforeEach(() => {
		originalHome = process.env.HOME
		tempDir = fs.mkdtempSync(path.join(tmpdir(), "paths-test-"))
		process.env.HOME = tempDir
	})

	afterEach(() => {
		process.env.HOME = originalHome
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true })
		}
	})

	describe("getGlobalStorageDir()", () => {
		it("should return path containing .vscode-mock", () => {
			const globalDir = VSCodeMockPaths.getGlobalStorageDir()

			expect(globalDir).toContain(".vscode-mock")
		})

		it("should return path containing global-storage", () => {
			const globalDir = VSCodeMockPaths.getGlobalStorageDir()

			expect(globalDir).toContain("global-storage")
		})

		it("should use HOME environment variable", () => {
			const globalDir = VSCodeMockPaths.getGlobalStorageDir()

			expect(globalDir).toContain(tempDir)
		})

		it("should return consistent path on multiple calls", () => {
			const dir1 = VSCodeMockPaths.getGlobalStorageDir()
			const dir2 = VSCodeMockPaths.getGlobalStorageDir()

			expect(dir1).toBe(dir2)
		})
	})

	describe("getWorkspaceStorageDir()", () => {
		it("should return path containing .vscode-mock", () => {
			const workspaceDir = VSCodeMockPaths.getWorkspaceStorageDir("/test/workspace")

			expect(workspaceDir).toContain(".vscode-mock")
		})

		it("should return path containing workspace-storage", () => {
			const workspaceDir = VSCodeMockPaths.getWorkspaceStorageDir("/test/workspace")

			expect(workspaceDir).toContain("workspace-storage")
		})

		it("should include hashed workspace path", () => {
			const workspaceDir = VSCodeMockPaths.getWorkspaceStorageDir("/test/workspace")

			// Should end with a hash (hex string)
			const hash = path.basename(workspaceDir)
			expect(hash).toMatch(/^[a-f0-9]+$/)
		})

		it("should return different paths for different workspaces", () => {
			const dir1 = VSCodeMockPaths.getWorkspaceStorageDir("/workspace/one")
			const dir2 = VSCodeMockPaths.getWorkspaceStorageDir("/workspace/two")

			expect(dir1).not.toBe(dir2)
		})

		it("should return same path for same workspace", () => {
			const dir1 = VSCodeMockPaths.getWorkspaceStorageDir("/same/workspace")
			const dir2 = VSCodeMockPaths.getWorkspaceStorageDir("/same/workspace")

			expect(dir1).toBe(dir2)
		})

		it("should handle Windows-style paths", () => {
			const workspaceDir = VSCodeMockPaths.getWorkspaceStorageDir("C:\\Users\\test\\workspace")

			expect(workspaceDir).toContain("workspace-storage")
			// Should still produce a valid hash
			const hash = path.basename(workspaceDir)
			expect(hash).toMatch(/^[a-f0-9]+$/)
		})

		it("should handle empty workspace path", () => {
			const workspaceDir = VSCodeMockPaths.getWorkspaceStorageDir("")

			expect(workspaceDir).toContain("workspace-storage")
		})
	})

	describe("getLogsDir()", () => {
		it("should return path containing .vscode-mock", () => {
			const logsDir = VSCodeMockPaths.getLogsDir()

			expect(logsDir).toContain(".vscode-mock")
		})

		it("should return path containing logs", () => {
			const logsDir = VSCodeMockPaths.getLogsDir()

			expect(logsDir).toContain("logs")
		})

		it("should return consistent path on multiple calls", () => {
			const dir1 = VSCodeMockPaths.getLogsDir()
			const dir2 = VSCodeMockPaths.getLogsDir()

			expect(dir1).toBe(dir2)
		})
	})

	describe("initializeWorkspace()", () => {
		it("should create global storage directory", () => {
			VSCodeMockPaths.initializeWorkspace("/test/workspace")

			const globalDir = VSCodeMockPaths.getGlobalStorageDir()
			expect(fs.existsSync(globalDir)).toBe(true)
		})

		it("should create workspace storage directory", () => {
			const workspacePath = "/test/workspace"
			VSCodeMockPaths.initializeWorkspace(workspacePath)

			const workspaceDir = VSCodeMockPaths.getWorkspaceStorageDir(workspacePath)
			expect(fs.existsSync(workspaceDir)).toBe(true)
		})

		it("should create logs directory", () => {
			VSCodeMockPaths.initializeWorkspace("/test/workspace")

			const logsDir = VSCodeMockPaths.getLogsDir()
			expect(fs.existsSync(logsDir)).toBe(true)
		})

		it("should not fail if directories already exist", () => {
			// Initialize twice
			VSCodeMockPaths.initializeWorkspace("/test/workspace")

			expect(() => {
				VSCodeMockPaths.initializeWorkspace("/test/workspace")
			}).not.toThrow()
		})

		it("should create directories with correct structure", () => {
			VSCodeMockPaths.initializeWorkspace("/test/workspace")

			const baseDir = path.join(tempDir, ".vscode-mock")
			expect(fs.existsSync(baseDir)).toBe(true)
			expect(fs.existsSync(path.join(baseDir, "global-storage"))).toBe(true)
			expect(fs.existsSync(path.join(baseDir, "workspace-storage"))).toBe(true)
			expect(fs.existsSync(path.join(baseDir, "logs"))).toBe(true)
		})
	})

	describe("hash consistency", () => {
		it("should produce deterministic hashes", () => {
			// The same workspace path should always produce the same hash
			const workspace = "/project/my-project"

			const hash1 = path.basename(VSCodeMockPaths.getWorkspaceStorageDir(workspace))
			const hash2 = path.basename(VSCodeMockPaths.getWorkspaceStorageDir(workspace))
			const hash3 = path.basename(VSCodeMockPaths.getWorkspaceStorageDir(workspace))

			expect(hash1).toBe(hash2)
			expect(hash2).toBe(hash3)
		})

		it("should handle special characters in workspace path", () => {
			const workspaces = [
				"/path/with spaces/project",
				"/path/with-dashes/project",
				"/path/with_underscores/project",
				"/path/with.dots/project",
			]

			for (const workspace of workspaces) {
				const dir = VSCodeMockPaths.getWorkspaceStorageDir(workspace)
				// Should produce valid directory name
				expect(path.basename(dir)).toMatch(/^[a-f0-9]+$/)
			}
		})
	})

	describe("USERPROFILE fallback (Windows)", () => {
		it("should use USERPROFILE when HOME is not set", () => {
			delete process.env.HOME
			process.env.USERPROFILE = tempDir

			const globalDir = VSCodeMockPaths.getGlobalStorageDir()

			expect(globalDir).toContain(tempDir)

			// Restore for cleanup
			process.env.HOME = tempDir
		})
	})
})
