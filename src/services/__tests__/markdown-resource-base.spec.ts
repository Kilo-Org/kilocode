// kilocode_change - new file

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as path from "path"
import { Dirent } from "fs"
import {
	parseFrontmatter,
	getResourceNameFromFile,
	isMarkdownFile,
	scanResourceDirectory,
	resolveSymlink,
	resolveDirectoryEntry,
	tryResolveSymlink,
	tryLoadResource,
	MAX_DEPTH,
	type MarkdownResource,
	type ResourceFileInfo,
} from "../markdown-resource-base"

// Mock fs/promises
vi.mock("fs/promises", () => ({
	default: {
		stat: vi.fn(),
		lstat: vi.fn(),
		readdir: vi.fn(),
		readFile: vi.fn(),
		readlink: vi.fn(),
	},
}))

import fs from "fs/promises"

const mockFs = fs as unknown as {
	stat: ReturnType<typeof vi.fn>
	lstat: ReturnType<typeof vi.fn>
	readdir: ReturnType<typeof vi.fn>
	readFile: ReturnType<typeof vi.fn>
	readlink: ReturnType<typeof vi.fn>
}

describe("parseFrontmatter", () => {
	describe("valid frontmatter parsing", () => {
		it("should parse valid frontmatter with all fields", () => {
			const content = `---
description: Test description
arguments: file1, file2
argument-hint: Enter a filename
mode: code
---
# Test Content

This is the body content.`

			const result = parseFrontmatter(content)

			expect(result.content).toBe("# Test Content\n\nThis is the body content.")
			expect(result.description).toBe("Test description")
			expect(result.arguments).toBe("file1, file2")
			expect(result.argumentHint).toBe("Enter a filename")
			expect(result.mode).toBe("code")
		})

		it("should parse frontmatter with only description", () => {
			const content = `---
description: Just a description
---
Simple content`

			const result = parseFrontmatter(content)

			expect(result.content).toBe("Simple content")
			expect(result.description).toBe("Just a description")
			expect(result.arguments).toBeUndefined()
			expect(result.argumentHint).toBeUndefined()
			expect(result.mode).toBeUndefined()
		})

		it("should parse both 'arguments' and 'argument-hint' fields", () => {
			const content = `---
arguments: arg1, arg2
argument-hint: Provide arguments
---
Content here`

			const result = parseFrontmatter(content)

			expect(result.arguments).toBe("arg1, arg2")
			expect(result.argumentHint).toBe("Provide arguments")
		})
	})

	describe("missing frontmatter handling", () => {
		it("should handle missing frontmatter (return raw content)", () => {
			const content = `# No Frontmatter

Just plain markdown content without any frontmatter.`

			const result = parseFrontmatter(content)

			expect(result.content).toBe("# No Frontmatter\n\nJust plain markdown content without any frontmatter.")
			expect(result.description).toBeUndefined()
			expect(result.arguments).toBeUndefined()
			expect(result.argumentHint).toBeUndefined()
		})

		it("should handle empty content", () => {
			const result = parseFrontmatter("")

			expect(result.content).toBe("")
			expect(result.description).toBeUndefined()
		})
	})

	describe("malformed frontmatter handling", () => {
		it("should handle malformed frontmatter gracefully", () => {
			const content = `---
invalid yaml content: [unclosed
---
Content here`

			const result = parseFrontmatter(content)

			// Should return raw content when parsing fails
			expect(result.content).toContain("invalid yaml content")
		})

		it("should handle unclosed frontmatter", () => {
			const content = `---
description: Missing closing

Body content`

			const result = parseFrontmatter(content)

			// gray-matter handles this gracefully, treating it as content
			expect(result.content).toBeDefined()
		})
	})

	describe("whitespace handling", () => {
		it("should trim whitespace from content", () => {
			const content = `---
description: Test
---

   Content with leading/trailing spaces   

`

			const result = parseFrontmatter(content)

			expect(result.content).toBe("Content with leading/trailing spaces")
		})

		it("should trim whitespace from frontmatter values", () => {
			const content = `---
description:   Spaced description   
arguments:   arg1, arg2   
---
Content`

			const result = parseFrontmatter(content)

			expect(result.description).toBe("Spaced description")
			expect(result.arguments).toBe("arg1, arg2")
		})

		it("should return undefined for empty string values after trim", () => {
			const content = `---
description:    
arguments:   
---
Content`

			const result = parseFrontmatter(content)

			expect(result.description).toBeUndefined()
			expect(result.arguments).toBeUndefined()
		})
	})
})

describe("getResourceNameFromFile", () => {
	it("should strip .md extension", () => {
		expect(getResourceNameFromFile("workflow.md")).toBe("workflow")
		expect(getResourceNameFromFile("command.md")).toBe("command")
		expect(getResourceNameFromFile("my-workflow.md")).toBe("my-workflow")
	})

	it("should handle filenames without .md extension", () => {
		expect(getResourceNameFromFile("workflow")).toBe("workflow")
		expect(getResourceNameFromFile("workflow.txt")).toBe("workflow.txt")
		expect(getResourceNameFromFile("workflow.markdown")).toBe("workflow.markdown")
	})

	it("should be case-insensitive for .md extension", () => {
		expect(getResourceNameFromFile("workflow.MD")).toBe("workflow")
		expect(getResourceNameFromFile("workflow.Md")).toBe("workflow")
		expect(getResourceNameFromFile("WORKFLOW.md")).toBe("WORKFLOW")
	})

	it("should handle complex filenames", () => {
		expect(getResourceNameFromFile("my.complex.workflow.md")).toBe("my.complex.workflow")
		expect(getResourceNameFromFile("v1.2.3.md")).toBe("v1.2.3")
		expect(getResourceNameFromFile(".hidden.md")).toBe(".hidden")
	})

	it("should handle edge cases", () => {
		expect(getResourceNameFromFile(".")).toBe(".")
		expect(getResourceNameFromFile("..")).toBe("..")
		expect(getResourceNameFromFile("")).toBe("")
	})
})

describe("isMarkdownFile", () => {
	it("should return true for .md files", () => {
		expect(isMarkdownFile("workflow.md")).toBe(true)
		expect(isMarkdownFile("test.md")).toBe(true)
		expect(isMarkdownFile("my-file.md")).toBe(true)
	})

	it("should be case-insensitive", () => {
		expect(isMarkdownFile("workflow.MD")).toBe(true)
		expect(isMarkdownFile("workflow.Md")).toBe(true)
		expect(isMarkdownFile("WORKFLOW.MD")).toBe(true)
	})

	it("should return false for non-markdown files", () => {
		expect(isMarkdownFile("workflow.txt")).toBe(false)
		expect(isMarkdownFile("workflow.markdown")).toBe(false)
		expect(isMarkdownFile("workflow")).toBe(false)
		expect(isMarkdownFile("workflow.json")).toBe(false)
		expect(isMarkdownFile("")).toBe(false)
	})
})

describe("resolveSymlink", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should resolve symlink to file", async () => {
		const fileInfo: ResourceFileInfo[] = []
		const symlinkPath = "/path/to/symlink.md"
		// When readlink returns "../target.md", path.resolve resolves it relative to the symlink's directory
		// /path/to/../target.md normalizes to /path/target.md
		const resolvedPath = "/path/target.md"

		mockFs.readlink.mockResolvedValueOnce("../target.md")
		mockFs.lstat.mockResolvedValueOnce({
			isFile: () => true,
			isDirectory: () => false,
			isSymbolicLink: () => false,
		})

		await resolveSymlink(symlinkPath, fileInfo, 0)

		expect(fileInfo).toHaveLength(1)
		expect(fileInfo[0].originalPath).toBe(symlinkPath)
		expect(fileInfo[0].resolvedPath).toBe(resolvedPath)
	})

	it("should not include non-markdown files", async () => {
		const fileInfo: ResourceFileInfo[] = []
		const symlinkPath = "/path/to/symlink.txt"

		mockFs.readlink.mockResolvedValueOnce("../target.txt")
		mockFs.lstat.mockResolvedValueOnce({
			isFile: () => true,
			isDirectory: () => false,
			isSymbolicLink: () => false,
		})

		await resolveSymlink(symlinkPath, fileInfo, 0)

		expect(fileInfo).toHaveLength(0)
	})

	it("should stop at MAX_DEPTH to prevent cyclic loops", async () => {
		const fileInfo: ResourceFileInfo[] = []

		// This should not process because depth > MAX_DEPTH
		await resolveSymlink("/path/to/symlink.md", fileInfo, MAX_DEPTH + 1)

		expect(mockFs.readlink).not.toHaveBeenCalled()
		expect(fileInfo).toHaveLength(0)
	})

	it("should handle invalid symlinks gracefully", async () => {
		const fileInfo: ResourceFileInfo[] = []

		mockFs.readlink.mockRejectedValueOnce(new Error("Invalid symlink"))

		// Should not throw
		await resolveSymlink("/path/to/invalid.md", fileInfo, 0)

		expect(fileInfo).toHaveLength(0)
	})

	it("should resolve symlink to directory and process entries", async () => {
		const fileInfo: ResourceFileInfo[] = []
		const symlinkPath = "/path/to/symlink-dir"
		const resolvedPath = "/path/to/target-dir"

		mockFs.readlink.mockResolvedValueOnce("../target-dir")
		mockFs.lstat.mockResolvedValueOnce({
			isFile: () => false,
			isDirectory: () => true,
			isSymbolicLink: () => false,
		})
		mockFs.readdir.mockResolvedValueOnce([
			Object.assign(new Dirent(), {
				name: "file1.md",
				isFile: () => true,
				isDirectory: () => false,
				isSymbolicLink: () => false,
				parentPath: resolvedPath,
			}),
		])

		await resolveSymlink(symlinkPath, fileInfo, 0)

		expect(fileInfo).toHaveLength(1)
		expect(fileInfo[0].resolvedPath).toBe(path.join(resolvedPath, "file1.md"))
	})
})

describe("resolveDirectoryEntry", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should process regular markdown files", async () => {
		const fileInfo: ResourceFileInfo[] = []
		const entry = Object.assign(new Dirent(), {
			name: "workflow.md",
			isFile: () => true,
			isDirectory: () => false,
			isSymbolicLink: () => false,
			parentPath: "/path/to/dir",
		})

		await resolveDirectoryEntry(entry, "/path/to/dir", fileInfo, 0)

		expect(fileInfo).toHaveLength(1)
		expect(fileInfo[0].originalPath).toBe(path.resolve("/path/to/dir", "workflow.md"))
		expect(fileInfo[0].resolvedPath).toBe(path.resolve("/path/to/dir", "workflow.md"))
	})

	it("should skip non-markdown files", async () => {
		const fileInfo: ResourceFileInfo[] = []
		const entry = Object.assign(new Dirent(), {
			name: "file.txt",
			isFile: () => true,
			isDirectory: () => false,
			isSymbolicLink: () => false,
			parentPath: "/path/to/dir",
		})

		await resolveDirectoryEntry(entry, "/path/to/dir", fileInfo, 0)

		expect(fileInfo).toHaveLength(0)
	})

	it("should stop at MAX_DEPTH", async () => {
		const fileInfo: ResourceFileInfo[] = []
		const entry = Object.assign(new Dirent(), {
			name: "workflow.md",
			isFile: () => true,
			parentPath: "/path/to/dir",
		})

		await resolveDirectoryEntry(entry, "/path/to/dir", fileInfo, MAX_DEPTH + 1)

		expect(fileInfo).toHaveLength(0)
	})
})

describe("tryResolveSymlink", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should return undefined for regular files", async () => {
		mockFs.lstat.mockResolvedValueOnce({
			isSymbolicLink: () => false,
		})

		const result = await tryResolveSymlink("/path/to/file.md")

		expect(result).toBeUndefined()
	})

	it("should resolve symlink to file path", async () => {
		mockFs.lstat.mockResolvedValueOnce({
			isSymbolicLink: () => true,
		})
		// When readlink returns "../target.md", path.resolve resolves it relative to the symlink's directory
		// /path/to/../target.md normalizes to /path/target.md
		mockFs.readlink.mockResolvedValueOnce("../target.md")
		mockFs.stat.mockResolvedValueOnce({
			isFile: () => true,
		})

		const result = await tryResolveSymlink("/path/to/symlink.md")

		expect(result).toBe("/path/target.md")
	})

	it("should return undefined for invalid symlinks", async () => {
		mockFs.lstat.mockRejectedValueOnce(new Error("File not found"))

		const result = await tryResolveSymlink("/path/to/invalid")

		expect(result).toBeUndefined()
	})
})

describe("scanResourceDirectory", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should return early if path is not a directory", async () => {
		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => false,
		})

		const resources = new Map<string, MarkdownResource>()
		await scanResourceDirectory("/path/to/file.md", "project", resources)

		expect(resources.size).toBe(0)
	})

	it("should return early if directory doesn't exist", async () => {
		mockFs.stat.mockRejectedValueOnce(new Error("Directory not found"))

		const resources = new Map<string, MarkdownResource>()
		await scanResourceDirectory("/nonexistent", "project", resources)

		expect(resources.size).toBe(0)
	})

	it("should find markdown files in directory", async () => {
		const dirPath = "/path/to/dir"
		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => true,
		})
		mockFs.readdir.mockResolvedValueOnce([
			Object.assign(new Dirent(), {
				name: "workflow1.md",
				isFile: () => true,
				isDirectory: () => false,
				isSymbolicLink: () => false,
				parentPath: dirPath,
			}),
			Object.assign(new Dirent(), {
				name: "workflow2.md",
				isFile: () => true,
				isDirectory: () => false,
				isSymbolicLink: () => false,
				parentPath: dirPath,
			}),
		])
		mockFs.readFile
			.mockResolvedValueOnce("---\ndescription: First workflow\n---\nContent 1")
			.mockResolvedValueOnce("---\ndescription: Second workflow\n---\nContent 2")

		const resources = new Map<string, MarkdownResource>()
		await scanResourceDirectory(dirPath, "project", resources)

		expect(resources.size).toBe(2)
		expect(resources.get("workflow1")).toBeDefined()
		expect(resources.get("workflow1")?.description).toBe("First workflow")
		expect(resources.get("workflow2")).toBeDefined()
		expect(resources.get("workflow2")?.description).toBe("Second workflow")
	})

	it("should respect priority order (project > global)", async () => {
		const dirPath = "/path/to/dir"
		const globalContent = "---\ndescription: Global version\n---\nGlobal content"
		const projectContent = "---\ndescription: Project version\n---\nProject content"

		// First scan global
		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => true,
		})
		mockFs.readdir.mockResolvedValueOnce([
			Object.assign(new Dirent(), {
				name: "workflow.md",
				isFile: () => true,
				isDirectory: () => false,
				isSymbolicLink: () => false,
				parentPath: "/global/dir",
			}),
		])
		mockFs.readFile.mockResolvedValueOnce(globalContent)

		const resources = new Map<string, MarkdownResource>()
		await scanResourceDirectory("/global/dir", "global", resources)

		expect(resources.get("workflow")?.description).toBe("Global version")

		// Then scan project - should override global
		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => true,
		})
		mockFs.readdir.mockResolvedValueOnce([
			Object.assign(new Dirent(), {
				name: "workflow.md",
				isFile: () => true,
				isDirectory: () => false,
				isSymbolicLink: () => false,
				parentPath: "/project/dir",
			}),
		])
		mockFs.readFile.mockResolvedValueOnce(projectContent)

		await scanResourceDirectory("/project/dir", "project", resources)

		expect(resources.get("workflow")?.description).toBe("Project version")
	})

	it("should not override project resources with global ones", async () => {
		const projectContent = "---\ndescription: Project version\n---\nProject content"
		const globalContent = "---\ndescription: Global version\n---\nGlobal content"

		const resources = new Map<string, MarkdownResource>()

		// First add a project resource
		resources.set("workflow", {
			name: "workflow",
			content: "Project content",
			source: "project",
			filePath: "/project/workflow.md",
			description: "Project version",
		})

		// Try to scan global directory
		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => true,
		})
		mockFs.readdir.mockResolvedValueOnce([
			Object.assign(new Dirent(), {
				name: "workflow.md",
				isFile: () => true,
				isDirectory: () => false,
				isSymbolicLink: () => false,
				parentPath: "/global/dir",
			}),
		])
		mockFs.readFile.mockResolvedValueOnce(globalContent)

		await scanResourceDirectory("/global/dir", "global", resources)

		// Project resource should remain
		expect(resources.get("workflow")?.source).toBe("project")
		expect(resources.get("workflow")?.description).toBe("Project version")
	})

	it("should handle unreadable files gracefully", async () => {
		const dirPath = "/path/to/dir"
		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => true,
		})
		mockFs.readdir.mockResolvedValueOnce([
			Object.assign(new Dirent(), {
				name: "workflow.md",
				isFile: () => true,
				isDirectory: () => false,
				isSymbolicLink: () => false,
				parentPath: dirPath,
			}),
		])
		mockFs.readFile.mockRejectedValueOnce(new Error("Permission denied"))

		const resources = new Map<string, MarkdownResource>()

		// Should not throw
		await scanResourceDirectory(dirPath, "project", resources)

		expect(resources.size).toBe(0)
	})
})

describe("tryLoadResource", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should return undefined if directory doesn't exist", async () => {
		mockFs.stat.mockRejectedValueOnce(new Error("Directory not found"))

		const result = await tryLoadResource("/nonexistent", "workflow", "project")

		expect(result).toBeUndefined()
	})

	it("should return undefined if path is not a directory", async () => {
		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => false,
		})

		const result = await tryLoadResource("/path/to/file.txt", "workflow", "project")

		expect(result).toBeUndefined()
	})

	it("should load resource by name", async () => {
		const dirPath = "/path/to/dir"
		const content = "---\ndescription: Test workflow\nmode: code\n---\nWorkflow content"

		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => true,
		})
		mockFs.readFile.mockResolvedValueOnce(content)

		const result = await tryLoadResource(dirPath, "test-workflow", "project")

		expect(result).toBeDefined()
		expect(result?.name).toBe("test-workflow")
		expect(result?.description).toBe("Test workflow")
		expect(result?.mode).toBe("code")
		expect(result?.content).toBe("Workflow content")
		expect(result?.source).toBe("project")
	})

	it("should return undefined for non-existent resource", async () => {
		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => true,
		})
		mockFs.readFile.mockRejectedValueOnce(new Error("File not found"))
		mockFs.lstat.mockResolvedValueOnce({
			isSymbolicLink: () => false,
		})

		const result = await tryLoadResource("/path/to/dir", "nonexistent", "project")

		expect(result).toBeUndefined()
	})

	it("should resolve symlinks when loading", async () => {
		const dirPath = "/path/to/dir"
		const resolvedPath = "/path/to/target/test.md"
		const content = "---\ndescription: Symlinked\n---\nContent"

		mockFs.stat.mockResolvedValueOnce({
			isDirectory: () => true,
		})
		mockFs.readFile.mockRejectedValueOnce(new Error("Not a regular file"))
		mockFs.lstat.mockResolvedValueOnce({
			isSymbolicLink: () => true,
		})
		mockFs.readlink.mockResolvedValueOnce("../target/test.md")
		mockFs.stat.mockResolvedValueOnce({
			isFile: () => true,
		})
		mockFs.readFile.mockResolvedValueOnce(content)

		const result = await tryLoadResource(dirPath, "test", "global")

		expect(result).toBeDefined()
		expect(result?.filePath).toBe(resolvedPath)
		expect(result?.source).toBe("global")
	})
})
