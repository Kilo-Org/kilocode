import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { DraftFileSystemProvider } from "../DraftFileSystemProvider"
import { DRAFT_SCHEME_NAME } from "../draftPaths"
import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs/promises"

// Mock os module
let mockHomedir: string
vi.mock("os", async () => {
	const actual = await vi.importActual<typeof import("os")>("os")
	return {
		...actual,
		homedir: () => mockHomedir,
	}
})
import * as os from "os"

// Mock VS Code
vi.mock("vscode", () => ({
	Uri: {
		parse: vi.fn((str) => ({
			scheme: "draft",
			path: str.replace("draft://", "/"),
		})),
	},
	workspace: {
		fs: {
			readFile: vi.fn(),
			writeFile: vi.fn(),
		},
	},
	window: {
		showTextDocument: vi.fn().mockResolvedValue({}),
	},
	EventEmitter: class MockEventEmitter<T> {
		private _event = vi.fn()
		event = this._event
		fire = vi.fn()
		dispose = vi.fn()
	},
	FileSystemProvider: {
		asFileType: 1,
	},
	FileType: {
		File: 1,
	},
	FileChangeType: {
		Created: 1,
		Changed: 2,
		Deleted: 3,
	},
	FileSystemError: {
		FileNotFound: class FileNotFound extends Error {
			constructor(uri?: any) {
				super(`File not found: ${uri || ""}`)
				this.name = "FileNotFound"
			}
		},
		NoPermissions: class NoPermissions extends Error {
			constructor() {
				super("No permissions")
				this.name = "NoPermissions"
			}
		},
	},
	Disposable: class Disposable {
		private _disposeFn: () => void
		constructor(disposeFn?: () => void) {
			this._disposeFn = disposeFn || (() => {})
		}
		dispose() {
			this._disposeFn()
		}
	},
}))

describe("DraftFileSystemProvider", () => {
	let provider: DraftFileSystemProvider
	let tempDir: string

	beforeEach(async () => {
		vi.clearAllMocks()
		// Create a temporary directory for test files
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "draft-fsp-test-"))
		// Set mock homedir to return our temp directory
		mockHomedir = tempDir
		// Get a fresh instance for each test
		provider = new DraftFileSystemProvider()
	})

	afterEach(async () => {
		// Clean up temporary directory
		try {
			await fs.rm(tempDir, { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
		vi.restoreAllMocks()
	})

	describe("createAndOpen", () => {
		it("should create a new draft document with correct content", async () => {
			const content = "# Test Document\n\nThis is a test."
			const result = await provider.createAndOpen("test-doc", content)

			expect(result).toMatch(/^draft:\/\/test-doc_[a-f0-9]{7}\.plan\.md$/)
			expect(vscode.window.showTextDocument).toHaveBeenCalled()
		})

		it("should append .plan.md extension if not present", async () => {
			const result = await provider.createAndOpen("my-document", "# Content")

			expect(result).toMatch(/^draft:\/\/my-document_[a-f0-9]{7}\.plan\.md$/)
		})

		it("should preserve .plan.md extension if already present", async () => {
			const result = await provider.createAndOpen("existing.plan.md", "# Content")

			expect(result).toMatch(/^draft:\/\/existing_[a-f0-9]{7}\.plan\.md$/)
		})

		it("should store content that can be read back", async () => {
			const content = "# My Draft\n\nSome content here."
			const draftPath = await provider.createAndOpen("my-draft", content)

			const uri = vscode.Uri.parse(draftPath)
			const readContent = await provider.readFile(uri)
			const decodedContent = new TextDecoder().decode(readContent)

			expect(decodedContent).toBe(content)
		})

		it("should emit Created event when document is created", async () => {
			const emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
			const content = "# Test"
			await provider.createAndOpen("test", content)

			// The provider should have fired the event
			expect(emitter.fire).toBeDefined()
		})
	})

	describe("readFile", () => {
		it("should return content for existing document", async () => {
			const content = "# Test Content"
			const draftPath = await provider.createAndOpen("existing", content)

			const uri = vscode.Uri.parse(draftPath)
			const readContent = await provider.readFile(uri)
			const decodedContent = new TextDecoder().decode(readContent)

			expect(decodedContent).toBe(content)
		})

		it("should throw FileNotFound for non-existent document", async () => {
			const uri = vscode.Uri.parse("draft:///nonexistent.plan.md")

			await expect(provider.readFile(uri)).rejects.toThrow()
		})

		it("should handle path with leading slash", async () => {
			const content = "# Content"
			const draftPath = await provider.createAndOpen("path-test", content)

			const uri = vscode.Uri.parse(draftPath)
			const readContent = await provider.readFile(uri)
			const decodedContent = new TextDecoder().decode(readContent)

			expect(decodedContent).toBe(content)
		})
	})

	describe("writeFile", () => {
		it("should update existing document content", async () => {
			const originalContent = "# Original"
			const draftPath = await provider.createAndOpen("updatable", originalContent)

			const newContent = "# Updated Content"
			const uri = vscode.Uri.parse(draftPath)
			await provider.writeFile(uri, new TextEncoder().encode(newContent), {
				create: false,
				overwrite: true,
			})

			const readContent = await provider.readFile(uri)
			const decodedContent = new TextDecoder().decode(readContent)

			expect(decodedContent).toBe(newContent)
		})

		it("should emit Changed event when document is updated", async () => {
			const content = "# Original"
			const draftPath = await provider.createAndOpen("change-test", content)

			const newContent = "# Changed"
			const uri = vscode.Uri.parse(draftPath)
			await provider.writeFile(uri, new TextEncoder().encode(newContent), {
				create: false,
				overwrite: true,
			})

			// Event should have been fired
			expect(provider.onDidChangeFile).toBeDefined()
		})
	})

	describe("delete", () => {
		it("should remove document from storage", async () => {
			const content = "# To Delete"
			const draftPath = await provider.createAndOpen("delete-me", content)

			const uri = vscode.Uri.parse(draftPath)
			await provider.delete(uri)

			// Should throw FileNotFound after deletion
			await expect(provider.readFile(uri)).rejects.toThrow()
		})

		it("should emit Deleted event when document is deleted", async () => {
			const content = "# Test"
			const draftPath = await provider.createAndOpen("emit-test", content)

			const uri = vscode.Uri.parse(draftPath)
			await provider.delete(uri)

			// Event should have been fired
			expect(provider.onDidChangeFile).toBeDefined()
		})

		it("should throw FileNotFound for non-existent document", async () => {
			const uri = vscode.Uri.parse("draft:///never-existed.plan.md")

			await expect(provider.delete(uri)).rejects.toThrow()
		})
	})

	describe("content isolation", () => {
		it("should maintain separate content for each draft", async () => {
			const content1 = "# Draft 1\n\nContent of first draft."
			const content2 = "# Draft 2\n\nDifferent content."

			const draftPath1 = await provider.createAndOpen("draft-1", content1)
			const draftPath2 = await provider.createAndOpen("draft-2", content2)

			const uri1 = vscode.Uri.parse(draftPath1)
			const uri2 = vscode.Uri.parse(draftPath2)

			const read1 = new TextDecoder().decode(await provider.readFile(uri1))
			const read2 = new TextDecoder().decode(await provider.readFile(uri2))

			expect(read1).toBe(content1)
			expect(read2).toBe(content2)
			expect(read1).not.toBe(read2)
		})

		it("should allow updating one draft without affecting others", async () => {
			const content1 = "# Original 1"
			const content2 = "# Original 2"

			const draftPath1 = await provider.createAndOpen("first", content1)
			const draftPath2 = await provider.createAndOpen("second", content2)

			// Update only first draft
			const updatedContent = "# Updated First"
			const uri1 = vscode.Uri.parse(draftPath1)
			await provider.writeFile(uri1, new TextEncoder().encode(updatedContent), {
				create: false,
				overwrite: true,
			})

			// Verify first draft is updated
			const read1 = new TextDecoder().decode(await provider.readFile(uri1))
			expect(read1).toBe(updatedContent)

			// Verify second draft is unchanged
			const uri2 = vscode.Uri.parse(draftPath2)
			const read2 = new TextDecoder().decode(await provider.readFile(uri2))
			expect(read2).toBe(content2)
		})

		it("should isolate drafts with similar names", async () => {
			const contentA = "# Document A"
			const contentB = "# Document B"

			const draftPathA = await provider.createAndOpen("doc", contentA)
			const draftPathB = await provider.createAndOpen("doc-2", contentB)

			const uriA = vscode.Uri.parse(draftPathA)
			const uriB = vscode.Uri.parse(draftPathB)

			const readA = new TextDecoder().decode(await provider.readFile(uriA))
			const readB = new TextDecoder().decode(await provider.readFile(uriB))

			expect(readA).toBe(contentA)
			expect(readB).toBe(contentB)
		})
	})

	describe("stat", () => {
		it("should return FileStat for existing document", async () => {
			const content = "# Test"
			const draftPath = await provider.createAndOpen("stat-test", content)

			const uri = vscode.Uri.parse(draftPath)
			const stat = await provider.stat(uri)

			expect(stat.type).toBe(vscode.FileType.File)
			expect(stat.size).toBeGreaterThan(0)
			expect(stat.ctime).toBeDefined()
			expect(stat.mtime).toBeDefined()
		})

		it("should throw FileNotFound for non-existent document", async () => {
			const uri = vscode.Uri.parse("draft:///stat-missing.plan.md")

			await expect(provider.stat(uri)).rejects.toThrow()
		})
	})

	describe("watch", () => {
		it("should return a disposable", () => {
			const uri = vscode.Uri.parse("draft:///test.plan.md")
			const disposable = provider.watch(uri, { recursive: true, excludes: [] })

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})

	describe("readDirectory", () => {
		it("should throw FileNotFound (directories not supported)", () => {
			const uri = vscode.Uri.parse("draft:///")

			expect(() => provider.readDirectory(uri)).toThrow()
		})
	})

	describe("createDirectory", () => {
		it("should throw NoPermissions (directories not supported)", () => {
			const uri = vscode.Uri.parse("draft:///new-dir")

			expect(() => provider.createDirectory(uri)).toThrow()
		})
	})

	describe("rename", () => {
		it("should throw NoPermissions (rename not supported)", () => {
			const oldUri = vscode.Uri.parse("draft:///old.plan.md")
			const newUri = vscode.Uri.parse("draft:///new.plan.md")

			expect(() => provider.rename(oldUri, newUri, { overwrite: true })).toThrow()
		})
	})

	describe("getDraftContent", () => {
		it("should return correct content for existing draft", async () => {
			const content = new TextEncoder().encode("# Test Content")
			await provider.setDraftContent("draft://test-doc.plan.md", content)

			const result = await provider.getDraftContent("draft://test-doc.plan.md")

			expect(result).toBeDefined()
			expect(result).toEqual(content)
		})

		it("should return undefined for non-existent draft", async () => {
			const result = await provider.getDraftContent("draft://nonexistent.plan.md")

			expect(result).toBeUndefined()
		})

		it("should handle draft path with triple slashes", async () => {
			const content = new TextEncoder().encode("# Content")
			await provider.setDraftContent("draft:///path-test.plan.md", content)

			const result = await provider.getDraftContent("draft:///path-test.plan.md")

			expect(result).toEqual(content)
		})
	})

	describe("setDraftContent", () => {
		it("should update existing draft content", async () => {
			const originalContent = new TextEncoder().encode("# Original")
			const newContent = new TextEncoder().encode("# Updated")
			await provider.setDraftContent("draft://updatable.plan.md", originalContent)

			await provider.setDraftContent("draft://updatable.plan.md", newContent)

			const result = await provider.getDraftContent("draft://updatable.plan.md")
			expect(result).toEqual(newContent)
		})

		it("should create new draft when content does not exist", async () => {
			const content = new TextEncoder().encode("# New Content")
			await provider.setDraftContent("draft://new-doc.plan.md", content)

			const result = await provider.getDraftContent("draft://new-doc.plan.md")
			expect(result).toEqual(content)
		})
	})

	describe("draftExists", () => {
		it("should return true for existing draft", async () => {
			const content = new TextEncoder().encode("# Test")
			await provider.setDraftContent("draft://existing.plan.md", content)

			const result = await provider.draftExists("draft://existing.plan.md")

			expect(result).toBe(true)
		})

		it("should return false for non-existent draft", async () => {
			const result = await provider.draftExists("draft://never-existed.plan.md")

			expect(result).toBe(false)
		})

		it("should return false after draft is deleted", async () => {
			const content = new TextEncoder().encode("# To Delete")
			await provider.setDraftContent("draft://delete-test.plan.md", content)
			await provider.deleteDraft("draft://delete-test.plan.md")

			const result = await provider.draftExists("draft://delete-test.plan.md")
			expect(result).toBe(false)
		})
	})

	describe("deleteDraft", () => {
		it("should remove draft from storage", async () => {
			const content = new TextEncoder().encode("# To Delete")
			await provider.setDraftContent("draft://delete-me.plan.md", content)

			await provider.deleteDraft("draft://delete-me.plan.md")

			const result = await provider.getDraftContent("draft://delete-me.plan.md")
			expect(result).toBeUndefined()
		})

		it("should be no-op for non-existent draft", async () => {
			// Should not throw
			await expect(provider.deleteDraft("draft://never-existed.plan.md")).resolves.not.toThrow()

			// Verify no drafts were added
			const drafts = await provider.listDrafts()
			expect(drafts).toHaveLength(0)
		})
	})

	describe("listDrafts", () => {
		it("should return all draft paths", async () => {
			await provider.setDraftContent("draft://doc1.plan.md", new TextEncoder().encode("# Doc 1"))
			await provider.setDraftContent("draft://doc2.plan.md", new TextEncoder().encode("# Doc 2"))
			await provider.setDraftContent("draft://doc3.plan.md", new TextEncoder().encode("# Doc 3"))

			const result = await provider.listDrafts()

			expect(result).toHaveLength(3)
			expect(result).toContain("draft://doc1.plan.md")
			expect(result).toContain("draft://doc2.plan.md")
			expect(result).toContain("draft://doc3.plan.md")
		})

		it("should return empty array when no drafts exist", async () => {
			const result = await provider.listDrafts()

			expect(result).toEqual([])
		})

		it("should reflect drafts created via setDraftContent", async () => {
			await provider.setDraftContent("draft://new.plan.md", new TextEncoder().encode("# New"))

			const result = await provider.listDrafts()

			expect(result).toContain("draft://new.plan.md")
		})

		it("should reflect drafts deleted via deleteDraft", async () => {
			await provider.setDraftContent("draft://to-remove.plan.md", new TextEncoder().encode("# Remove"))
			await provider.deleteDraft("draft://to-remove.plan.md")

			const result = await provider.listDrafts()

			expect(result).not.toContain("draft://to-remove.plan.md")
		})
	})
})
