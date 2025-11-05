/**
 * Tests for gitignore filtering in file search
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { fileSearchService } from "../fileSearch.js"
import fs from "fs/promises"
import path from "path"
import os from "os"

describe("FileSearchService - Gitignore Support", () => {
	let tempDir: string

	beforeEach(async () => {
		// Create a temporary directory for testing
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fileSearch-test-"))

		// Create test files
		await fs.writeFile(path.join(tempDir, "included.txt"), "test")
		await fs.mkdir(path.join(tempDir, "dist"), { recursive: true })
		await fs.writeFile(path.join(tempDir, "dist", "excluded.js"), "test")
		await fs.mkdir(path.join(tempDir, "node_modules"), { recursive: true })
		await fs.writeFile(path.join(tempDir, "node_modules", "package.json"), "test")
		await fs.writeFile(path.join(tempDir, "visible.ts"), "test")

		// Create .gitignore file
		await fs.writeFile(path.join(tempDir, ".gitignore"), "dist\nnode_modules\n")

		// Clear cache
		fileSearchService.clearCache()
	})

	afterEach(async () => {
		// Clean up temp directory
		await fs.rm(tempDir, { recursive: true, force: true })
	})

	it("should exclude files from dist folder", async () => {
		const results = await fileSearchService.getAllFiles(tempDir)

		// Should not include files from dist
		const distFiles = results.filter((r) => r.path.startsWith("dist"))
		expect(distFiles.length).toBe(0)
	})

	it("should exclude files from node_modules folder", async () => {
		const results = await fileSearchService.getAllFiles(tempDir)

		// Should not include files from node_modules
		const nodeModulesFiles = results.filter((r) => r.path.startsWith("node_modules"))
		expect(nodeModulesFiles.length).toBe(0)
	})

	it("should include non-gitignored files", async () => {
		const results = await fileSearchService.getAllFiles(tempDir)

		// Should include these files
		const includedFile = results.find((r) => r.basename === "included.txt")
		const visibleFile = results.find((r) => r.basename === "visible.ts")

		expect(includedFile).toBeDefined()
		expect(visibleFile).toBeDefined()

		// Note: .gitignore itself won't be included because we have dot: false in fast-glob
		// which excludes hidden files (files starting with .)
	})

	it("should work correctly when no .gitignore exists", async () => {
		// Remove .gitignore
		await fs.unlink(path.join(tempDir, ".gitignore"))

		// Clear cache to force re-scan
		fileSearchService.clearCache(tempDir)

		const results = await fileSearchService.getAllFiles(tempDir)

		// Should now include everything (since no .gitignore)
		expect(results.length).toBeGreaterThan(0)
	})
})
