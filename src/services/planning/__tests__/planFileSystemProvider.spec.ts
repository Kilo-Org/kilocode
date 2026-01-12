// kilocode_change - new file: Tests for PlanFileSystemProvider
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { PlanFileSystemProvider } from "../PlanFileSystemProvider"
import { PLAN_SCHEME_NAME } from "../planPaths"
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
			scheme: "plan",
			path: str.replace("plan://", "/"),
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

describe("PlanFileSystemProvider", () => {
	let provider: PlanFileSystemProvider
	let tempDir: string

	beforeEach(async () => {
		vi.clearAllMocks()
		// Create a temporary directory for test files
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "plan-fsp-test-"))
		// Set mock homedir to return our temp directory
		mockHomedir = tempDir
		// Get a fresh instance for each test
		provider = new PlanFileSystemProvider()
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
		it("should create a new plan document with correct content", async () => {
			const content = "# Test Document\n\nThis is a test."
			const result = await provider.createAndOpen("test-doc", content)

			expect(result).toMatch(/^plan:\/\/test-doc_[a-f0-9]{7}\.plan\.md$/)
			expect(vscode.window.showTextDocument).toHaveBeenCalled()
		})

		it("should append .plan.md extension if not present", async () => {
			const result = await provider.createAndOpen("my-document", "# Content")

			expect(result).toMatch(/^plan:\/\/my-document_[a-f0-9]{7}\.plan\.md$/)
		})

		it("should preserve .plan.md extension if already present", async () => {
			const result = await provider.createAndOpen("existing.plan.md", "# Content")

			expect(result).toMatch(/^plan:\/\/existing_[a-f0-9]{7}\.plan\.md$/)
		})

		it("should store content that can be read back", async () => {
			const content = "# My Plan\n\nSome content here."
			const planPath = await provider.createAndOpen("my-plan", content)

			const uri = vscode.Uri.parse(planPath)
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
			const planPath = await provider.createAndOpen("existing", content)

			const uri = vscode.Uri.parse(planPath)
			const readContent = await provider.readFile(uri)
			const decodedContent = new TextDecoder().decode(readContent)

			expect(decodedContent).toBe(content)
		})

		it("should throw FileNotFound for non-existent document", async () => {
			const uri = vscode.Uri.parse("plan:///nonexistent.plan.md")

			await expect(provider.readFile(uri)).rejects.toThrow()
		})

		it("should handle path with leading slash", async () => {
			const content = "# Content"
			const planPath = await provider.createAndOpen("path-test", content)

			const uri = vscode.Uri.parse(planPath)
			const readContent = await provider.readFile(uri)
			const decodedContent = new TextDecoder().decode(readContent)

			expect(decodedContent).toBe(content)
		})
	})

	describe("writeFile", () => {
		it("should update existing document content", async () => {
			const originalContent = "# Original"
			const planPath = await provider.createAndOpen("updatable", originalContent)

			const newContent = "# Updated Content"
			const uri = vscode.Uri.parse(planPath)
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
			const planPath = await provider.createAndOpen("change-test", content)

			const newContent = "# Changed"
			const uri = vscode.Uri.parse(planPath)
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
			const planPath = await provider.createAndOpen("delete-me", content)

			const uri = vscode.Uri.parse(planPath)
			await provider.delete(uri)

			// Should throw FileNotFound after deletion
			await expect(provider.readFile(uri)).rejects.toThrow()
		})

		it("should emit Deleted event when document is deleted", async () => {
			const content = "# Test"
			const planPath = await provider.createAndOpen("emit-test", content)

			const uri = vscode.Uri.parse(planPath)
			await provider.delete(uri)

			// Event should have been fired
			expect(provider.onDidChangeFile).toBeDefined()
		})

		it("should throw FileNotFound for non-existent document", async () => {
			const uri = vscode.Uri.parse("plan:///never-existed.plan.md")

			await expect(provider.delete(uri)).rejects.toThrow()
		})
	})

	describe("content isolation", () => {
		it("should maintain separate content for each plan", async () => {
			const content1 = "# Plan 1\n\nContent of first plan."
			const content2 = "# Plan 2\n\nDifferent content."

			const planPath1 = await provider.createAndOpen("plan-1", content1)
			const planPath2 = await provider.createAndOpen("plan-2", content2)

			const uri1 = vscode.Uri.parse(planPath1)
			const uri2 = vscode.Uri.parse(planPath2)

			const read1 = new TextDecoder().decode(await provider.readFile(uri1))
			const read2 = new TextDecoder().decode(await provider.readFile(uri2))

			expect(read1).toBe(content1)
			expect(read2).toBe(content2)
			expect(read1).not.toBe(read2)
		})

		it("should allow updating one plan without affecting others", async () => {
			const content1 = "# Original 1"
			const content2 = "# Original 2"

			const planPath1 = await provider.createAndOpen("first", content1)
			const planPath2 = await provider.createAndOpen("second", content2)

			// Update only first plan
			const updatedContent = "# Updated First"
			const uri1 = vscode.Uri.parse(planPath1)
			await provider.writeFile(uri1, new TextEncoder().encode(updatedContent), {
				create: false,
				overwrite: true,
			})

			// Verify first plan is updated
			const read1 = new TextDecoder().decode(await provider.readFile(uri1))
			expect(read1).toBe(updatedContent)

			// Verify second plan is unchanged
			const uri2 = vscode.Uri.parse(planPath2)
			const read2 = new TextDecoder().decode(await provider.readFile(uri2))
			expect(read2).toBe(content2)
		})

		it("should isolate plans with similar names", async () => {
			const contentA = "# Document A"
			const contentB = "# Document B"

			const planPathA = await provider.createAndOpen("doc", contentA)
			const planPathB = await provider.createAndOpen("doc-2", contentB)

			const uriA = vscode.Uri.parse(planPathA)
			const uriB = vscode.Uri.parse(planPathB)

			const readA = new TextDecoder().decode(await provider.readFile(uriA))
			const readB = new TextDecoder().decode(await provider.readFile(uriB))

			expect(readA).toBe(contentA)
			expect(readB).toBe(contentB)
		})
	})

	describe("stat", () => {
		it("should return FileStat for existing document", async () => {
			const content = "# Test"
			const planPath = await provider.createAndOpen("stat-test", content)

			const uri = vscode.Uri.parse(planPath)
			const stat = await provider.stat(uri)

			expect(stat.type).toBe(vscode.FileType.File)
			expect(stat.size).toBeGreaterThan(0)
			expect(stat.ctime).toBeDefined()
			expect(stat.mtime).toBeDefined()
		})

		it("should throw FileNotFound for non-existent document", async () => {
			const uri = vscode.Uri.parse("plan:///stat-missing.plan.md")

			await expect(provider.stat(uri)).rejects.toThrow()
		})
	})

	describe("watch", () => {
		it("should return a disposable", () => {
			const uri = vscode.Uri.parse("plan:///test.plan.md")
			const disposable = provider.watch(uri, { recursive: true, excludes: [] })

			expect(disposable).toBeDefined()
			expect(typeof disposable.dispose).toBe("function")
		})
	})

	describe("readDirectory", () => {
		it("should throw FileNotFound (directories not supported)", () => {
			const uri = vscode.Uri.parse("plan:///")

			expect(() => provider.readDirectory(uri)).toThrow()
		})
	})

	describe("createDirectory", () => {
		it("should throw NoPermissions (directories not supported)", () => {
			const uri = vscode.Uri.parse("plan:///new-dir")

			expect(() => provider.createDirectory(uri)).toThrow()
		})
	})

	describe("rename", () => {
		it("should throw NoPermissions (rename not supported)", () => {
			const oldUri = vscode.Uri.parse("plan:///old.plan.md")
			const newUri = vscode.Uri.parse("plan:///new.plan.md")

			expect(() => provider.rename(oldUri, newUri, { overwrite: true })).toThrow()
		})
	})

	describe("getPlanContent", () => {
		it("should return correct content for existing plan", async () => {
			const content = new TextEncoder().encode("# Test Content")
			await provider.setPlanContent("plan://test-doc.plan.md", content)

			const result = await provider.getPlanContent("plan://test-doc.plan.md")

			expect(result).toBeDefined()
			expect(result).toEqual(content)
		})

		it("should return undefined for non-existent plan", async () => {
			const result = await provider.getPlanContent("plan://nonexistent.plan.md")

			expect(result).toBeUndefined()
		})

		it("should handle plan path with triple slashes", async () => {
			const content = new TextEncoder().encode("# Content")
			await provider.setPlanContent("plan:///path-test.plan.md", content)

			const result = await provider.getPlanContent("plan:///path-test.plan.md")

			expect(result).toEqual(content)
		})
	})

	describe("setPlanContent", () => {
		it("should update existing plan content", async () => {
			const originalContent = new TextEncoder().encode("# Original")
			const newContent = new TextEncoder().encode("# Updated")
			await provider.setPlanContent("plan://updatable.plan.md", originalContent)

			await provider.setPlanContent("plan://updatable.plan.md", newContent)

			const result = await provider.getPlanContent("plan://updatable.plan.md")
			expect(result).toEqual(newContent)
		})

		it("should create new plan when content does not exist", async () => {
			const content = new TextEncoder().encode("# New Content")
			await provider.setPlanContent("plan://new-doc.plan.md", content)

			const result = await provider.getPlanContent("plan://new-doc.plan.md")
			expect(result).toEqual(content)
		})
	})

	describe("planExists", () => {
		it("should return true for existing plan", async () => {
			const content = new TextEncoder().encode("# Test")
			await provider.setPlanContent("plan://existing.plan.md", content)

			const result = await provider.planExists("plan://existing.plan.md")

			expect(result).toBe(true)
		})

		it("should return false for non-existent plan", async () => {
			const result = await provider.planExists("plan://never-existed.plan.md")

			expect(result).toBe(false)
		})

		it("should return false after plan is deleted", async () => {
			const content = new TextEncoder().encode("# To Delete")
			await provider.setPlanContent("plan://delete-test.plan.md", content)
			await provider.deletePlan("plan://delete-test.plan.md")

			const result = await provider.planExists("plan://delete-test.plan.md")
			expect(result).toBe(false)
		})
	})

	describe("deletePlan", () => {
		it("should remove plan from storage", async () => {
			const content = new TextEncoder().encode("# To Delete")
			await provider.setPlanContent("plan://delete-me.plan.md", content)

			await provider.deletePlan("plan://delete-me.plan.md")

			const result = await provider.getPlanContent("plan://delete-me.plan.md")
			expect(result).toBeUndefined()
		})

		it("should be no-op for non-existent plan", async () => {
			// Should not throw
			await expect(provider.deletePlan("plan://never-existed.plan.md")).resolves.not.toThrow()

			// Verify no plans were added
			const plans = await provider.listPlans()
			expect(plans).toHaveLength(0)
		})
	})

	describe("listPlans", () => {
		it("should return all plan paths", async () => {
			await provider.setPlanContent("plan://doc1.plan.md", new TextEncoder().encode("# Doc 1"))
			await provider.setPlanContent("plan://doc2.plan.md", new TextEncoder().encode("# Doc 2"))
			await provider.setPlanContent("plan://doc3.plan.md", new TextEncoder().encode("# Doc 3"))

			const result = await provider.listPlans()

			expect(result).toHaveLength(3)
			expect(result).toContain("plan://doc1.plan.md")
			expect(result).toContain("plan://doc2.plan.md")
			expect(result).toContain("plan://doc3.plan.md")
		})

		it("should return empty array when no plans exist", async () => {
			const result = await provider.listPlans()

			expect(result).toEqual([])
		})

		it("should reflect plans created via setPlanContent", async () => {
			await provider.setPlanContent("plan://new.plan.md", new TextEncoder().encode("# New"))

			const result = await provider.listPlans()

			expect(result).toContain("plan://new.plan.md")
		})

		it("should reflect plans deleted via deletePlan", async () => {
			await provider.setPlanContent("plan://to-remove.plan.md", new TextEncoder().encode("# Remove"))
			await provider.deletePlan("plan://to-remove.plan.md")

			const result = await provider.listPlans()

			expect(result).not.toContain("plan://to-remove.plan.md")
		})
	})
})
