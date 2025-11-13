// kilocode_change - new file
import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { startIndexing } from "../indexer"
import { scanDirectory } from "../scanner"
import { ManagedIndexingConfig } from "../types"

// Mock dependencies
vi.mock("../scanner")
vi.mock("../watcher", () => ({
	createFileWatcher: vi.fn(() => ({
		dispose: vi.fn(),
	})),
}))
vi.mock("../git-watcher", () => ({
	createGitWatcher: vi.fn(() => ({
		dispose: vi.fn(),
	})),
}))
vi.mock("../git-utils", () => ({
	isGitRepository: vi.fn(() => Promise.resolve(true)),
	getCurrentBranch: vi.fn(() => Promise.resolve("main")),
	isDetachedHead: vi.fn(() => Promise.resolve(false)),
}))
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))
vi.mock("../../../utils/logging", () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
	},
}))

describe("Managed Indexing Error Handling", () => {
	let mockContext: vscode.ExtensionContext
	let config: ManagedIndexingConfig

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = {
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
		} as any

		config = {
			organizationId: "test-org",
			projectId: "test-project",
			kilocodeToken: "test-token",
			workspacePath: "/test/workspace",
			chunker: {
				maxChunkChars: 1000,
				minChunkChars: 200,
				overlapLines: 5,
			},
			batchSize: 60,
			autoSync: true,
		}
	})

	it("should provide detailed error messages when scan fails", async () => {
		// Mock scanDirectory to return errors
		const mockErrors = [
			new Error("Failed to process file1.ts: Network error"),
			new Error("Failed to process file2.ts: Permission denied"),
			new Error("Failed to process file3.ts: Invalid syntax"),
		]

		vi.mocked(scanDirectory).mockResolvedValue({
			success: false,
			filesProcessed: 0,
			filesSkipped: 0,
			chunksIndexed: 0,
			errors: mockErrors,
		})

		// Attempt to start indexing
		await expect(startIndexing(config, mockContext)).rejects.toThrow(/Scan failed with 3 errors/)
	})

	it("should include error details in thrown error message", async () => {
		const mockErrors = [new Error("Error 1"), new Error("Error 2"), new Error("Error 3")]

		vi.mocked(scanDirectory).mockResolvedValue({
			success: false,
			filesProcessed: 0,
			filesSkipped: 0,
			chunksIndexed: 0,
			errors: mockErrors,
		})

		try {
			await startIndexing(config, mockContext)
			expect.fail("Should have thrown an error")
		} catch (error) {
			expect(error).toBeInstanceOf(Error)
			const err = error as Error
			expect(err.message).toContain("Error 1")
			expect(err.message).toContain("Error 2")
			expect(err.message).toContain("Error 3")
		}
	})

	it("should truncate error list when there are many errors", async () => {
		const mockErrors = Array.from({ length: 25 }, (_, i) => new Error(`Error ${i + 1}`))

		vi.mocked(scanDirectory).mockResolvedValue({
			success: false,
			filesProcessed: 0,
			filesSkipped: 0,
			chunksIndexed: 0,
			errors: mockErrors,
		})

		try {
			await startIndexing(config, mockContext)
			expect.fail("Should have thrown an error")
		} catch (error) {
			expect(error).toBeInstanceOf(Error)
			const err = error as Error
			expect(err.message).toContain("Scan failed with 25 errors")
			expect(err.message).toContain("and 20 more")
			// Should only include first 5 errors in message
			expect(err.message).toContain("Error 1")
			expect(err.message).toContain("Error 5")
			expect(err.message).not.toContain("Error 6")
		}
	})

	it("should call state change callback with error state", async () => {
		const mockErrors = [new Error("Test error")]
		const onStateChange = vi.fn()

		vi.mocked(scanDirectory).mockResolvedValue({
			success: false,
			filesProcessed: 0,
			filesSkipped: 0,
			chunksIndexed: 0,
			errors: mockErrors,
		})

		try {
			await startIndexing(config, mockContext, onStateChange)
		} catch {
			// Expected to throw
		}

		// Should have called with error state
		expect(onStateChange).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "error",
				message: expect.stringContaining("Failed to start indexing"),
			}),
		)
	})
})
