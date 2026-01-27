// npx vitest run services/review/__tests__/prompts.spec.ts

import { buildReviewPrompt } from "../prompts"
import type { ReviewSummary } from "../types"

describe("buildReviewPrompt", () => {
	describe("uncommitted scope", () => {
		it("builds prompt for uncommitted changes", () => {
			const summary: ReviewSummary = {
				scope: "uncommitted",
				currentBranch: "feature/test",
				files: [
					{ path: "src/file1.ts", status: "M" },
					{ path: "src/file2.ts", status: "A" },
					{ path: "src/file3.ts", status: "D" },
				],
				totalFiles: 3,
				hasChanges: true,
			}

			const prompt = buildReviewPrompt(summary)

			expect(prompt).toContain("**uncommitted changes**")
			expect(prompt).toContain("`feature/test`")
			expect(prompt).toContain("Changed Files (3)")
			expect(prompt).toContain("[modified] src/file1.ts")
			expect(prompt).toContain("[added] src/file2.ts")
			expect(prompt).toContain("[deleted] src/file3.ts")
			expect(prompt).toContain("git diff")
			expect(prompt).not.toContain("baseBranch")
		})

		it("includes git diff --cached suggestion", () => {
			const summary: ReviewSummary = {
				scope: "uncommitted",
				currentBranch: "main",
				files: [{ path: "file.ts", status: "M" }],
				totalFiles: 1,
				hasChanges: true,
			}

			const prompt = buildReviewPrompt(summary)

			expect(prompt).toContain("git diff --cached")
		})
	})

	describe("branch scope", () => {
		it("builds prompt for branch diff", () => {
			const summary: ReviewSummary = {
				scope: "branch",
				currentBranch: "feature/new-feature",
				baseBranch: "main",
				files: [
					{ path: "src/new.ts", status: "A" },
					{ path: "src/modified.ts", status: "M" },
				],
				totalFiles: 2,
				hasChanges: true,
			}

			const prompt = buildReviewPrompt(summary)

			expect(prompt).toContain("**branch diff**")
			expect(prompt).toContain("`feature/new-feature`")
			expect(prompt).toContain("`main`")
			expect(prompt).toContain("Changed Files (2)")
			expect(prompt).toContain("[added] src/new.ts")
			expect(prompt).toContain("[modified] src/modified.ts")
			expect(prompt).toContain("git diff main")
		})

		it("handles renamed files with arrow notation", () => {
			const summary: ReviewSummary = {
				scope: "branch",
				currentBranch: "feature/rename",
				baseBranch: "main",
				files: [{ path: "src/new-name.ts", status: "R", oldPath: "src/old-name.ts" }],
				totalFiles: 1,
				hasChanges: true,
			}

			const prompt = buildReviewPrompt(summary)

			expect(prompt).toContain("[renamed] src/old-name.ts → src/new-name.ts")
		})
	})

	describe("empty changes", () => {
		it("shows no files message when empty", () => {
			const summary: ReviewSummary = {
				scope: "uncommitted",
				currentBranch: "main",
				files: [],
				totalFiles: 0,
				hasChanges: false,
			}

			const prompt = buildReviewPrompt(summary)

			expect(prompt).toContain("Changed Files (0)")
			expect(prompt).toContain("No files changed.")
		})
	})

	describe("user input", () => {
		it("includes user instructions when provided", () => {
			const summary: ReviewSummary = {
				scope: "uncommitted",
				currentBranch: "main",
				files: [{ path: "file.ts", status: "M" }],
				totalFiles: 1,
				hasChanges: true,
			}

			const prompt = buildReviewPrompt(summary, "Focus on security issues only")

			expect(prompt).toContain("## Additional Instructions")
			expect(prompt).toContain("Focus on security issues only")
		})

		it("does not include additional instructions section when empty", () => {
			const summary: ReviewSummary = {
				scope: "uncommitted",
				currentBranch: "main",
				files: [{ path: "file.ts", status: "M" }],
				totalFiles: 1,
				hasChanges: true,
			}

			const prompt = buildReviewPrompt(summary, "")

			expect(prompt).not.toContain("## Additional Instructions")
		})

		it("trims whitespace from user input", () => {
			const summary: ReviewSummary = {
				scope: "uncommitted",
				currentBranch: "main",
				files: [{ path: "file.ts", status: "M" }],
				totalFiles: 1,
				hasChanges: true,
			}

			const prompt = buildReviewPrompt(summary, "   Check for bugs   ")

			expect(prompt).toContain("Check for bugs")
			expect(prompt).not.toContain("   Check for bugs   ")
		})
	})

	describe("file status labels", () => {
		it("maps all status codes to labels", () => {
			const summary: ReviewSummary = {
				scope: "uncommitted",
				currentBranch: "main",
				files: [
					{ path: "added.ts", status: "A" },
					{ path: "modified.ts", status: "M" },
					{ path: "deleted.ts", status: "D" },
					{ path: "renamed.ts", status: "R" },
					{ path: "copied.ts", status: "C" },
					{ path: "unmerged.ts", status: "U" },
					{ path: "untracked.ts", status: "?" },
				],
				totalFiles: 7,
				hasChanges: true,
			}

			const prompt = buildReviewPrompt(summary)

			expect(prompt).toContain("[added] added.ts")
			expect(prompt).toContain("[modified] modified.ts")
			expect(prompt).toContain("[deleted] deleted.ts")
			expect(prompt).toContain("[renamed] renamed.ts")
			expect(prompt).toContain("[copied] copied.ts")
			expect(prompt).toContain("[unmerged] unmerged.ts")
			expect(prompt).toContain("[untracked] untracked.ts")
		})
	})

	describe("tool instructions", () => {
		it("includes execute_command instructions", () => {
			const summary: ReviewSummary = {
				scope: "uncommitted",
				currentBranch: "main",
				files: [{ path: "file.ts", status: "M" }],
				totalFiles: 1,
				hasChanges: true,
			}

			const prompt = buildReviewPrompt(summary)

			expect(prompt).toContain("`execute_command`")
			expect(prompt).toContain("`read_file`")
			expect(prompt).toContain("`git log`")
			expect(prompt).toContain("`git blame`")
		})
	})
})
