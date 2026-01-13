import { describe, it, expect } from "vitest"
import {
	buildParallelModeWorktreePath,
	parseParallelModeBranch,
	parseParallelModeWorktreePath,
	isParallelModeCompletionMessage,
	parseParallelModeCompletionBranch,
} from "../parallelModeParser"

describe("parallelModeParser", () => {
	describe("parseParallelModeBranch", () => {
		it("parses branch from 'Creating worktree with branch:' message", () => {
			const message = "Creating worktree with branch: add-feature-1702734891234"
			expect(parseParallelModeBranch(message)).toBe("add-feature-1702734891234")
		})

		it("parses branch from 'Using existing branch:' message", () => {
			const message = "Using existing branch: my-existing-branch"
			expect(parseParallelModeBranch(message)).toBe("my-existing-branch")
		})

		it("returns undefined for unrelated messages", () => {
			expect(parseParallelModeBranch("Starting agent...")).toBeUndefined()
			expect(parseParallelModeBranch("Some other log")).toBeUndefined()
		})

		it("handles branch names with numbers and hyphens", () => {
			const message = "Creating worktree with branch: fix-bug-123-456"
			expect(parseParallelModeBranch(message)).toBe("fix-bug-123-456")
		})

		it("handles branch names with underscores", () => {
			const message = "Creating worktree with branch: feature_new_thing_123"
			expect(parseParallelModeBranch(message)).toBe("feature_new_thing_123")
		})

		it("handles branch names with slashes (feature branches)", () => {
			const message = "Creating worktree with branch: feature/add-auth-1702734891234"
			expect(parseParallelModeBranch(message)).toBe("feature/add-auth-1702734891234")
		})
	})

	describe("parseParallelModeWorktreePath", () => {
		it("parses path from 'Created worktree at:' message", () => {
			const message = "Created worktree at: /tmp/kilocode-worktree-add-feature"
			expect(parseParallelModeWorktreePath(message)).toBe("/tmp/kilocode-worktree-add-feature")
		})

		it("handles paths with spaces (edge case)", () => {
			const message = "Created worktree at: /var/folders/abc/kilocode-worktree-test"
			expect(parseParallelModeWorktreePath(message)).toBe("/var/folders/abc/kilocode-worktree-test")
		})

		it("returns undefined for unrelated messages", () => {
			expect(parseParallelModeWorktreePath("Starting agent...")).toBeUndefined()
			expect(parseParallelModeWorktreePath("worktree something else")).toBeUndefined()
		})

		it("handles Windows-style paths", () => {
			const message = "Created worktree at: C:\\Users\\test\\kilocode-worktree-feature"
			expect(parseParallelModeWorktreePath(message)).toBe("C:\\Users\\test\\kilocode-worktree-feature")
		})
	})

	describe("isParallelModeCompletionMessage", () => {
		it("detects 'Parallel mode complete' message", () => {
			const message = "✓ Parallel mode complete! Changes committed to: my-branch"
			expect(isParallelModeCompletionMessage(message)).toBe(true)
		})

		it("detects message with full completion output", () => {
			const message =
				"✓ Parallel mode complete! Changes committed to: my-branch\n\ngit diff ...my-branch\ngit merge my-branch"
			expect(isParallelModeCompletionMessage(message)).toBe(true)
		})

		it("returns false for unrelated messages", () => {
			expect(isParallelModeCompletionMessage("Starting agent...")).toBe(false)
			expect(isParallelModeCompletionMessage("Task completed")).toBe(false)
		})

		it("returns false for general git commands in agent output", () => {
			// Should NOT match general git commands that might appear in agent output
			expect(isParallelModeCompletionMessage("You should run git merge to combine changes")).toBe(false)
			expect(isParallelModeCompletionMessage("Run git diff to see changes")).toBe(false)
		})
	})

	describe("parseParallelModeCompletionBranch", () => {
		it("parses branch from completion message", () => {
			const message = "✓ Parallel mode complete! Changes committed to: create-a-simple-file-1764867583984"
			expect(parseParallelModeCompletionBranch(message)).toBe("create-a-simple-file-1764867583984")
		})

		it("parses branch from completion message with extra text", () => {
			const message =
				"✓ Parallel mode complete! Changes committed to: my-branch\n\nReview and merge changes:\n  git diff ...my-branch"
			expect(parseParallelModeCompletionBranch(message)).toBe("my-branch")
		})

		it("handles branch names with hyphens and numbers", () => {
			const message = "✓ Parallel mode complete! Changes committed to: hi-there-1764867050570"
			expect(parseParallelModeCompletionBranch(message)).toBe("hi-there-1764867050570")
		})

		it("returns undefined for unrelated messages", () => {
			expect(parseParallelModeCompletionBranch("Starting agent...")).toBeUndefined()
			expect(parseParallelModeCompletionBranch("Task completed")).toBeUndefined()
		})

		it("returns undefined for incomplete completion messages", () => {
			expect(parseParallelModeCompletionBranch("Parallel mode complete")).toBeUndefined()
			expect(parseParallelModeCompletionBranch("Parallel mode complete!")).toBeUndefined()
		})
	})

	describe("buildParallelModeWorktreePath", () => {
		it("uses the OS temp directory with the kilocode worktree prefix", () => {
			const branch = "feature-123"
			const result = buildParallelModeWorktreePath(branch)
			expect(result).toContain(`kilocode-worktree-${branch}`)
		})
	})
})
