// npx vitest run services/review/__tests__/ReviewService.spec.ts

// Use vi.hoisted to ensure mocks are available during hoisting
const {
	mockGetCurrentBranch,
	mockDetectBaseBranch,
	mockHasUncommittedChanges,
	mockGetUncommittedFiles,
	mockGetBranchFilesChanged,
	mockIsOnBaseBranch,
} = vi.hoisted(() => ({
	mockGetCurrentBranch: vi.fn(),
	mockDetectBaseBranch: vi.fn(),
	mockHasUncommittedChanges: vi.fn(),
	mockGetUncommittedFiles: vi.fn(),
	mockGetBranchFilesChanged: vi.fn(),
	mockIsOnBaseBranch: vi.fn(),
}))

vi.mock("../../../utils/git", () => ({
	getCurrentBranch: mockGetCurrentBranch,
	detectBaseBranch: mockDetectBaseBranch,
	hasUncommittedChanges: mockHasUncommittedChanges,
	getUncommittedFiles: mockGetUncommittedFiles,
	getBranchFilesChanged: mockGetBranchFilesChanged,
	isOnBaseBranch: mockIsOnBaseBranch,
}))

import { ReviewService } from "../ReviewService"

describe("ReviewService", () => {
	const cwd = "/test/project"
	let service: ReviewService

	beforeEach(() => {
		vi.clearAllMocks()
		service = new ReviewService({ cwd })
	})

	describe("getScopeInfo", () => {
		it("returns scope info when both uncommitted and branch changes are available", async () => {
			mockGetCurrentBranch.mockResolvedValue("feature/test")
			mockHasUncommittedChanges.mockResolvedValue(true)
			mockGetUncommittedFiles.mockResolvedValue([
				{ path: "src/file1.ts", status: "M" },
				{ path: "src/file2.ts", status: "A" },
			])
			mockIsOnBaseBranch.mockResolvedValue(false)
			mockDetectBaseBranch.mockResolvedValue("main")
			mockGetBranchFilesChanged.mockResolvedValue([
				{ path: "src/file1.ts", status: "M" },
				{ path: "src/file3.ts", status: "A" },
				{ path: "src/file4.ts", status: "D" },
			])

			const result = await service.getScopeInfo()

			expect(result.uncommitted.available).toBe(true)
			expect(result.uncommitted.fileCount).toBe(2)
			expect(result.uncommitted.filePreview).toEqual(["src/file1.ts", "src/file2.ts"])

			expect(result.branch.available).toBe(true)
			expect(result.branch.currentBranch).toBe("feature/test")
			expect(result.branch.baseBranch).toBe("main")
			expect(result.branch.fileCount).toBe(3)
			expect(result.branch.filePreview).toEqual(["src/file1.ts", "src/file3.ts", "src/file4.ts"])
		})

		it("returns unavailable uncommitted when no uncommitted changes", async () => {
			mockGetCurrentBranch.mockResolvedValue("feature/test")
			mockHasUncommittedChanges.mockResolvedValue(false)
			mockIsOnBaseBranch.mockResolvedValue(false)
			mockDetectBaseBranch.mockResolvedValue("main")
			mockGetBranchFilesChanged.mockResolvedValue([{ path: "src/file.ts", status: "M" }])

			const result = await service.getScopeInfo()

			expect(result.uncommitted.available).toBe(false)
			expect(result.uncommitted.fileCount).toBe(0)
			expect(result.branch.available).toBe(true)
		})

		it("returns unavailable branch when on base branch", async () => {
			mockGetCurrentBranch.mockResolvedValue("main")
			mockHasUncommittedChanges.mockResolvedValue(true)
			mockGetUncommittedFiles.mockResolvedValue([{ path: "src/file.ts", status: "M" }])
			mockIsOnBaseBranch.mockResolvedValue(true)
			mockDetectBaseBranch.mockResolvedValue("main")

			const result = await service.getScopeInfo()

			expect(result.uncommitted.available).toBe(true)
			expect(result.branch.available).toBe(false)
		})

		it("returns branch available even with zero file changes", async () => {
			mockGetCurrentBranch.mockResolvedValue("feature/test")
			mockHasUncommittedChanges.mockResolvedValue(false)
			mockIsOnBaseBranch.mockResolvedValue(false)
			mockDetectBaseBranch.mockResolvedValue("main")
			mockGetBranchFilesChanged.mockResolvedValue([])

			const result = await service.getScopeInfo()

			// Branch is available as long as not on base branch - agent will handle "no changes"
			expect(result.branch.available).toBe(true)
			expect(result.branch.fileCount).toBe(0)
		})

		it("handles errors gracefully", async () => {
			mockGetCurrentBranch.mockRejectedValue(new Error("Git not found"))

			const result = await service.getScopeInfo()

			expect(result.uncommitted.available).toBe(false)
			expect(result.branch.available).toBe(false)
			expect(result.error).toBe("Git not found")
		})

		it("limits file preview to 5 files", async () => {
			mockGetCurrentBranch.mockResolvedValue("feature/test")
			mockHasUncommittedChanges.mockResolvedValue(true)
			mockGetUncommittedFiles.mockResolvedValue([
				{ path: "src/file1.ts", status: "M" },
				{ path: "src/file2.ts", status: "M" },
				{ path: "src/file3.ts", status: "M" },
				{ path: "src/file4.ts", status: "M" },
				{ path: "src/file5.ts", status: "M" },
				{ path: "src/file6.ts", status: "M" },
				{ path: "src/file7.ts", status: "M" },
			])
			mockIsOnBaseBranch.mockResolvedValue(true)
			mockDetectBaseBranch.mockResolvedValue("main")

			const result = await service.getScopeInfo()

			expect(result.uncommitted.fileCount).toBe(7)
			expect(result.uncommitted.filePreview).toHaveLength(5)
		})
	})

	describe("getReviewSummary", () => {
		describe("uncommitted scope", () => {
			it("returns summary with changed files", async () => {
				mockGetCurrentBranch.mockResolvedValue("feature/test")
				mockGetUncommittedFiles.mockResolvedValue([
					{ path: "src/file1.ts", status: "M" },
					{ path: "src/file2.ts", status: "A" },
					{ path: "src/file3.ts", status: "D" },
				])

				const result = await service.getReviewSummary("uncommitted")

				expect(result.scope).toBe("uncommitted")
				expect(result.currentBranch).toBe("feature/test")
				expect(result.baseBranch).toBeUndefined()
				expect(result.totalFiles).toBe(3)
				expect(result.hasChanges).toBe(true)
				expect(result.files).toHaveLength(3)
				expect(result.files[0]).toEqual({ path: "src/file1.ts", status: "M", oldPath: undefined })
				expect(result.files[1]).toEqual({ path: "src/file2.ts", status: "A", oldPath: undefined })
				expect(result.files[2]).toEqual({ path: "src/file3.ts", status: "D", oldPath: undefined })
			})

			it("returns hasChanges=false when no uncommitted files", async () => {
				mockGetCurrentBranch.mockResolvedValue("main")
				mockGetUncommittedFiles.mockResolvedValue([])

				const result = await service.getReviewSummary("uncommitted")

				expect(result.hasChanges).toBe(false)
				expect(result.totalFiles).toBe(0)
				expect(result.files).toHaveLength(0)
			})

			it("converts untracked (?) to added (A) status", async () => {
				mockGetCurrentBranch.mockResolvedValue("main")
				mockGetUncommittedFiles.mockResolvedValue([{ path: "new-file.ts", status: "?" }])

				const result = await service.getReviewSummary("uncommitted")

				expect(result.files[0].status).toBe("A")
			})
		})

		describe("branch scope", () => {
			it("returns summary with branch comparison", async () => {
				mockGetCurrentBranch.mockResolvedValue("feature/test")
				mockDetectBaseBranch.mockResolvedValue("main")
				mockGetBranchFilesChanged.mockResolvedValue([
					{ path: "src/a.ts", status: "M" },
					{ path: "src/b.ts", status: "A" },
				])

				const result = await service.getReviewSummary("branch")

				expect(result.scope).toBe("branch")
				expect(result.currentBranch).toBe("feature/test")
				expect(result.baseBranch).toBe("main")
				expect(result.totalFiles).toBe(2)
				expect(result.hasChanges).toBe(true)
			})

			it("returns hasChanges=false when no branch diff", async () => {
				mockGetCurrentBranch.mockResolvedValue("main")
				mockDetectBaseBranch.mockResolvedValue("main")
				mockGetBranchFilesChanged.mockResolvedValue([])

				const result = await service.getReviewSummary("branch")

				expect(result.hasChanges).toBe(false)
				expect(result.totalFiles).toBe(0)
			})

			it("handles renamed files with oldPath", async () => {
				mockGetCurrentBranch.mockResolvedValue("feature/test")
				mockDetectBaseBranch.mockResolvedValue("main")
				mockGetBranchFilesChanged.mockResolvedValue([
					{ path: "src/new-name.ts", status: "R", oldPath: "src/old-name.ts" },
				])

				const result = await service.getReviewSummary("branch")

				expect(result.files[0]).toEqual({
					path: "src/new-name.ts",
					status: "R",
					oldPath: "src/old-name.ts",
				})
			})
		})

		it("handles errors gracefully", async () => {
			mockGetCurrentBranch.mockRejectedValue(new Error("Git failed"))

			const result = await service.getReviewSummary("uncommitted")

			expect(result.hasChanges).toBe(false)
			expect(result.error).toBe("Git failed")
		})
	})
})
