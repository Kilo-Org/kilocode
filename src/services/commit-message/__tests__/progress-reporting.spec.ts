// Test to verify progress reporting functionality
import { spawnSync } from "child_process"
import type { Mock } from "vitest"
import { GitExtensionService } from "../GitExtensionService"

vi.mock("child_process", () => ({
	spawnSync: vi.fn(),
}))

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(() => ({ dispose: vi.fn() })),
			onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
			onDidDelete: vi.fn(() => ({ dispose: vi.fn() })),
			dispose: vi.fn(),
		})),
	},
	extensions: {
		getExtension: vi.fn(() => ({
			isActive: true,
			exports: {
				getAPI: vi.fn(() => ({
					repositories: [
						{
							rootUri: { fsPath: "/test/workspace" },
							inputBox: { value: "" },
						},
					],
				})),
			},
		})),
	},
	env: {
		clipboard: { writeText: vi.fn() },
	},
	window: { showInformationMessage: vi.fn() },
	RelativePattern: vi.fn().mockImplementation((base, pattern) => ({ base, pattern })),
}))

const mockSpawnSync = spawnSync as Mock

describe("Progress Reporting", () => {
	let service: GitExtensionService
	const mockWorkspaceRoot = "/test/workspace"

	beforeEach(() => {
		service = new GitExtensionService(mockWorkspaceRoot)
		mockSpawnSync.mockClear()
	})

	it("should report progress during diff collection", async () => {
		const progressCallback = vi.fn()
		const stagedFiles = ["src/file1.ts", "src/file2.ts", "src/file3.ts"]
		const mockFileListOutput = stagedFiles.join("\n")

		// Mock git responses
		mockSpawnSync
			.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null })
			.mockReturnValueOnce({ status: 0, stdout: "diff1", stderr: "", error: null })
			.mockReturnValueOnce({ status: 0, stdout: "diff2", stderr: "", error: null })
			.mockReturnValueOnce({ status: 0, stdout: "diff3", stderr: "", error: null })

		const getDiffForChanges = (service as any).getDiffForChanges
		await getDiffForChanges.call(service, { staged: true, onProgress: progressCallback })

		// Verify progress was reported for each file
		expect(progressCallback).toHaveBeenCalledTimes(3)
		expect(progressCallback.mock.calls[0][0]).toBeCloseTo(33.33, 1) // After first file (1/3 * 100)
		expect(progressCallback.mock.calls[1][0]).toBeCloseTo(66.67, 1) // After second file (2/3 * 100)
		expect(progressCallback.mock.calls[2][0]).toBe(100) // After third file (3/3 * 100)
	})

	it("should handle progress reporting with no files", async () => {
		const progressCallback = vi.fn()
		mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: null })

		const getDiffForChanges = (service as any).getDiffForChanges
		await getDiffForChanges.call(service, { staged: true, onProgress: progressCallback })

		// No progress should be reported when there are no files
		expect(progressCallback).not.toHaveBeenCalled()
	})

	it("should work without progress callback", async () => {
		const stagedFiles = ["src/file1.ts"]
		const mockFileListOutput = stagedFiles.join("\n")

		mockSpawnSync
			.mockReturnValueOnce({ status: 0, stdout: mockFileListOutput, stderr: "", error: null })
			.mockReturnValueOnce({ status: 0, stdout: "diff1", stderr: "", error: null })

		const getDiffForChanges = (service as any).getDiffForChanges
		const result = await getDiffForChanges.call(service, { staged: true })

		expect(result).toBe("diff1")
		expect(mockSpawnSync).toHaveBeenCalledTimes(2)
	})
})
