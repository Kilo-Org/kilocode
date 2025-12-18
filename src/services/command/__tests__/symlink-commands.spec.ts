import fs from "fs/promises"
import * as path from "path"

import { getCommand, getCommands } from "../commands"

// Mock fs and path modules
vi.mock("fs/promises")
vi.mock("../roo-config", () => ({
	getGlobalRooDirectory: vi.fn(() => "/mock/global/.roo"),
	getProjectRooDirectoryForCwd: vi.fn(() => "/mock/project/.roo"),
}))
vi.mock("../built-in-commands", () => ({
	getBuiltInCommands: vi.fn(() => Promise.resolve([])),
	getBuiltInCommand: vi.fn(() => Promise.resolve(undefined)),
	getBuiltInCommandNames: vi.fn(() => Promise.resolve([])),
}))

const mockFs = vi.mocked(fs)

describe("Symlink command support", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("getCommand with symlinks", () => {
		it("should load command from a symlinked file", async () => {
			const commandContent = `---
description: Symlinked command
---

# Symlinked Command Content`

			// Mock stat to return directory for commands dir
			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })

			// Mock readFile to fail for direct path
			mockFs.readFile = vi.fn().mockRejectedValue(new Error("File not found"))

			// Mock lstat to indicate it's a symlink
			mockFs.lstat = vi.fn().mockResolvedValue({
				isSymbolicLink: () => true,
			})

			// Mock readlink to return symlink target
			mockFs.readlink = vi.fn().mockResolvedValue("../shared/symlinked-command.md")

			// Mock stat to return file for the resolved target
			mockFs.stat = vi.fn().mockImplementation((filePath: string) => {
				if (filePath.includes("commands")) {
					return Promise.resolve({ isDirectory: () => true })
				}
				return Promise.resolve({ isFile: () => true })
			})

			// Mock readFile to succeed for resolved path
			mockFs.readFile = vi.fn().mockImplementation((filePath: string) => {
				if (filePath.toString().includes("symlinked-command.md")) {
					return Promise.resolve(commandContent)
				}
				return Promise.reject(new Error("File not found"))
			})

			const result = await getCommand("/test/cwd", "setup")

			expect(result?.content).toContain("Symlinked Command Content")
			expect(result?.description).toBe("Symlinked command")
		})

		it("should use symlink name for command name, not target name", async () => {
			const commandContent = `# Target Command`

			// Setup mocks for a symlink scenario where symlink name differs from target
			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })
			mockFs.readFile = vi.fn().mockResolvedValue(commandContent)

			const result = await getCommand("/test/cwd", "my-alias")

			// Command name should be from the requested name (symlink name)
			expect(result?.name).toBe("my-alias")
		})
	})

	describe("getCommands with symlinks", () => {
		it("should discover commands from symlinked files", async () => {
			const regularContent = `# Regular Command`
			const symlinkedContent = `# Symlinked Command`

			mockFs.stat = vi.fn().mockResolvedValue({ isDirectory: () => true })

			// Mock readdir to return both regular file and symlink
			mockFs.readdir = vi.fn().mockResolvedValue([
				{
					name: "regular.md",
					isFile: () => true,
					isSymbolicLink: () => false,
					parentPath: "/mock/project/.roo/commands",
				},
				{
					name: "symlink.md",
					isFile: () => false,
					isSymbolicLink: () => true,
					parentPath: "/mock/project/.roo/commands",
				},
			])

			// Mock readlink for symlink resolution
			mockFs.readlink = vi.fn().mockResolvedValue("../shared/actual-command.md")

			// Mock lstat for symlink target type checking (lstat doesn't follow symlinks)
			mockFs.lstat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands")) {
					return Promise.resolve({ isDirectory: () => true })
				}
				// Return file stats for the resolved symlink target
				return Promise.resolve({
					isFile: () => true,
					isDirectory: () => false,
					isSymbolicLink: () => false,
				})
			})

			// Mock stat for directory checking
			mockFs.stat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands")) {
					return Promise.resolve({ isDirectory: () => true })
				}
				return Promise.resolve({
					isFile: () => true,
					isDirectory: () => false,
					isSymbolicLink: () => false,
				})
			})

			// Mock readFile for content
			mockFs.readFile = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath.includes("regular.md")) {
					return Promise.resolve(regularContent)
				}
				if (normalizedPath.includes("actual-command.md")) {
					return Promise.resolve(symlinkedContent)
				}
				return Promise.reject(new Error("File not found"))
			})

			const result = await getCommands("/test/cwd")

			expect(result.length).toBe(2)

			const regularCmd = result.find((c) => c.name === "regular")
			const symlinkCmd = result.find((c) => c.name === "symlink")

			expect(regularCmd?.content).toContain("Regular Command")
			expect(symlinkCmd?.content).toContain("Symlinked Command")
		})

		it.skipIf(process.platform === "win32")("should discover commands from symlinked directories", async () => {
			const nestedContent = `# Nested Command from Symlinked Dir`

			// Mock lstat for symlink target type checking (lstat doesn't follow symlinks)
			mockFs.lstat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands") || normalizedPath.includes("shared-commands")) {
					return Promise.resolve({
						isDirectory: () => true,
						isFile: () => false,
						isSymbolicLink: () => false,
					})
				}
				return Promise.resolve({
					isFile: () => true,
					isDirectory: () => false,
					isSymbolicLink: () => false,
				})
			})

			// First stat check for directory
			mockFs.stat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands") || normalizedPath.includes("shared-commands")) {
					return Promise.resolve({
						isDirectory: () => true,
						isFile: () => false,
						isSymbolicLink: () => false,
					})
				}
				return Promise.resolve({
					isFile: () => true,
					isDirectory: () => false,
					isSymbolicLink: () => false,
				})
			})

			// First readdir returns a symlink to directory
			mockFs.readdir = vi.fn().mockImplementation((dirPath: string) => {
				const normalizedPath = dirPath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands") && !normalizedPath.includes("shared")) {
					return Promise.resolve([
						{
							name: "linked-dir",
							isFile: () => false,
							isSymbolicLink: () => true,
							parentPath: "/mock/project/.roo/commands",
						},
					])
				}
				// Return files from the resolved symlink directory
				return Promise.resolve([
					{
						name: "nested.md",
						isFile: () => true,
						isSymbolicLink: () => false,
						parentPath: normalizedPath,
					},
				])
			})

			// Mock readlink for symlink to directory
			mockFs.readlink = vi.fn().mockResolvedValue("/mock/shared-commands")

			// Mock readFile for content
			mockFs.readFile = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath.includes("nested.md")) {
					return Promise.resolve(nestedContent)
				}
				return Promise.reject(new Error("File not found"))
			})

			const result = await getCommands("/test/cwd")

			// Find a command that was discovered from the symlinked directory
			const nestedCmd = result.find((c) => c.name === "nested")
			expect(nestedCmd).toBeDefined()
			expect(nestedCmd?.content).toContain("Nested Command from Symlinked Dir")
		})

		// Note: Nested symlinks (symlink -> symlink -> file) are automatically followed by fs.stat,
		// so they work transparently. The MAX_DEPTH protection prevents infinite loops.

		it("should handle cyclic symlinks gracefully (MAX_DEPTH protection)", async () => {
			// Create a cyclic symlink scenario
			// Mock lstat to return symlink for all targets (creating infinite loop)
			mockFs.lstat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands")) {
					return Promise.resolve({
						isDirectory: () => true,
						isFile: () => false,
						isSymbolicLink: () => false,
					})
				}
				// All symlink targets are symlinks (infinite loop)
				return Promise.resolve({
					isFile: () => false,
					isDirectory: () => false,
					isSymbolicLink: () => true,
				})
			})

			mockFs.stat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands")) {
					return Promise.resolve({
						isDirectory: () => true,
						isFile: () => false,
						isSymbolicLink: () => false,
					})
				}
				// All symlink targets are symlinks (infinite loop)
				return Promise.resolve({
					isFile: () => false,
					isDirectory: () => false,
					isSymbolicLink: () => true,
				})
			})

			mockFs.readdir = vi.fn().mockResolvedValue([
				{
					name: "cyclic.md",
					isFile: () => false,
					isSymbolicLink: () => true,
					parentPath: "/mock/project/.roo/commands",
				},
			])

			// Cyclic symlink - always points to another symlink
			mockFs.readlink = vi.fn().mockResolvedValue("../another-link.md")

			mockFs.readFile = vi.fn().mockRejectedValue(new Error("File not found"))

			// Should not throw, just gracefully handle the cyclic symlink
			const result = await getCommands("/test/cwd")

			// The cyclic command should not be included (it can't be resolved)
			expect(result.find((c) => c.name === "cyclic")).toBeUndefined()
		})

		it("should handle broken symlinks gracefully", async () => {
			const regularContent = `# Regular Command`

			// Mock lstat for symlink target type checking
			mockFs.lstat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands")) {
					return Promise.resolve({
						isDirectory: () => true,
						isFile: () => false,
						isSymbolicLink: () => false,
					})
				}
				if (normalizedPath.includes("nonexistent")) {
					return Promise.reject(new Error("ENOENT: no such file or directory"))
				}
				return Promise.resolve({
					isFile: () => true,
					isDirectory: () => false,
					isSymbolicLink: () => false,
				})
			})

			mockFs.stat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands")) {
					return Promise.resolve({
						isDirectory: () => true,
						isFile: () => false,
						isSymbolicLink: () => false,
					})
				}
				if (normalizedPath.includes("nonexistent")) {
					return Promise.reject(new Error("ENOENT: no such file or directory"))
				}
				return Promise.resolve({
					isFile: () => true,
					isDirectory: () => false,
					isSymbolicLink: () => false,
				})
			})

			mockFs.readdir = vi.fn().mockResolvedValue([
				{
					name: "regular.md",
					isFile: () => true,
					isSymbolicLink: () => false,
					parentPath: "/mock/project/.roo/commands",
				},
				{
					name: "broken.md",
					isFile: () => false,
					isSymbolicLink: () => true,
					parentPath: "/mock/project/.roo/commands",
				},
			])

			// Broken symlink points to nonexistent file
			mockFs.readlink = vi.fn().mockResolvedValue("../nonexistent.md")

			mockFs.readFile = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.toString().replace(/\\/g, "/")
				if (normalizedPath.includes("regular.md")) {
					return Promise.resolve(regularContent)
				}
				return Promise.reject(new Error("ENOENT: no such file or directory"))
			})

			// Should not throw, just skip the broken symlink
			const result = await getCommands("/test/cwd")

			expect(result.length).toBe(1)
			expect(result[0].name).toBe("regular")
		})

		it("should use symlink name for command name when symlink points to file", async () => {
			const targetContent = `# Target File Content`

			// Mock lstat for symlink target type checking (lstat doesn't follow symlinks)
			mockFs.lstat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands")) {
					return Promise.resolve({
						isDirectory: () => true,
						isFile: () => false,
						isSymbolicLink: () => false,
					})
				}
				// Return file stats for the resolved symlink target
				return Promise.resolve({
					isFile: () => true,
					isDirectory: () => false,
					isSymbolicLink: () => false,
				})
			})

			mockFs.stat = vi.fn().mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.includes("commands")) {
					return Promise.resolve({
						isDirectory: () => true,
						isFile: () => false,
						isSymbolicLink: () => false,
					})
				}
				return Promise.resolve({
					isFile: () => true,
					isDirectory: () => false,
					isSymbolicLink: () => false,
				})
			})

			mockFs.readdir = vi.fn().mockResolvedValue([
				{
					name: "my-alias.md", // Symlink name
					isFile: () => false,
					isSymbolicLink: () => true,
					parentPath: "/mock/project/.roo/commands",
				},
			])

			// Symlink points to file with different name
			mockFs.readlink = vi.fn().mockResolvedValue("../shared/actual-target-name.md")

			mockFs.readFile = vi.fn().mockResolvedValue(targetContent)

			const result = await getCommands("/test/cwd")

			expect(result.length).toBe(1)
			// Command name should be from symlink, not target
			expect(result[0].name).toBe("my-alias")
			expect(result[0].content).toContain("Target File Content")
		})
	})
})
