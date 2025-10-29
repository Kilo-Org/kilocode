import { describe, it, expect, vi, beforeEach, Mock } from "vitest"
import * as path from "path"
import { spawnSync } from "child_process"
import { GitExtensionService } from "../GitExtensionService"

vi.mock("child_process")
vi.mock("vscode", () => ({
	window: { showInformationMessage: vi.fn() },
	workspace: {
		createFileSystemWatcher: vi.fn().mockReturnValue({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		}),
	},
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
}))

vi.mock("../../core/ignore/RooIgnoreController", () => {
	const mockInstance = {
		initialize: vi.fn(),
		dispose: vi.fn(),
		validateAccess: vi.fn().mockReturnValue(true),
	}
	return {
		RooIgnoreController: vi.fn().mockImplementation(() => mockInstance),
	}
})

const mockSpawnSync = spawnSync as Mock

describe("Progress Reporting", () => {
	let service: GitExtensionService
	const mockWorkspaceRoot = "/test/workspace"

	beforeEach(() => {
		service = new GitExtensionService(mockWorkspaceRoot)
		mockSpawnSync.mockClear()
	})

	it("should report progress during getCommitContext", async () => {
		const progressCallback = vi.fn()
		const mockChanges = [
			{ filePath: path.join(mockWorkspaceRoot, "file1.ts"), status: "M" as const, staged: true },
			{ filePath: path.join(mockWorkspaceRoot, "file2.ts"), status: "A" as const, staged: true },
		]

		// Mock git calls for context generation (no progress callback in public API)
		mockSpawnSync.mockReturnValue({ status: 0, stdout: "diff content", stderr: "", error: null })

		const result = await service.getCommitContext(mockChanges, {
			staged: true,
			includeRepoContext: false,
			onProgress: progressCallback,
		})

		expect(result).toContain("## Git Context for Commit Message Generation")
		expect(result).toContain("Modified (staged): file1.ts")
		expect(result).toContain("Added (staged): file2.ts")
	})

	it("should handle progress reporting with no files", async () => {
		const progressCallback = vi.fn()

		const result = await service.getCommitContext([], {
			staged: true,
			includeRepoContext: false,
			onProgress: progressCallback,
		})

		expect(result).toContain("(No changes matched selection)")
	})

	it("should work without progress callback", async () => {
		const mockChanges = [{ filePath: path.join(mockWorkspaceRoot, "file1.ts"), status: "M" as const, staged: true }]

		// Mock git calls for diff generation
		mockSpawnSync.mockReturnValue({ status: 0, stdout: "diff content", stderr: "", error: null })

		const result = await service.getCommitContext(mockChanges, { staged: true, includeRepoContext: false })

		expect(result).toContain("Modified (staged): file1.ts")
	})
})
