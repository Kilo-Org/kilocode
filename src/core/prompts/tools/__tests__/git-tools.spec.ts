import { getGitBranchDescription } from "../git-branch"
import { getGitCommitDescription } from "../git-commit"
import { getGitPushDescription } from "../git-push"
import { ToolArgs } from "../types"

describe("Git Tools Descriptions", () => {
	describe("getGitBranchDescription", () => {
		it("should include tool name and description", () => {
			const description = getGitBranchDescription()

			expect(description).toContain("## git_branch")
			expect(description).toContain("Create a new git branch")
			expect(description).toContain("Always ask for user approval")
		})

		it("should include branch_name parameter", () => {
			const description = getGitBranchDescription()

			expect(description).toContain("branch_name: (required)")
			expect(description).toContain("GitLab conventions")
		})

		it("should include usage examples", () => {
			const description = getGitBranchDescription()

			expect(description).toContain("<git_branch>")
			expect(description).toContain("</git_branch>")
			expect(description).toContain("feature/add-user-authentication")
			expect(description).toContain("fix/login-validation")
		})
	})

	describe("getGitCommitDescription", () => {
		it("should include tool name and description", () => {
			const description = getGitCommitDescription()

			expect(description).toContain("## git_commit")
			expect(description).toContain("Stage all changes and commit")
			expect(description).toContain("Always ask for user approval")
		})

		it("should include commit_message parameter", () => {
			const description = getGitCommitDescription()

			expect(description).toContain("commit_message: (required)")
			expect(description).toContain("descriptive commit message")
		})

		it("should include usage examples", () => {
			const description = getGitCommitDescription()

			expect(description).toContain("<git_commit>")
			expect(description).toContain("</git_commit>")
			expect(description).toContain("Add user authentication with JWT tokens")
			expect(description).toContain("Fix validation error in login form")
			expect(description).toContain("Update README with installation instructions")
		})
	})

	describe("getGitPushDescription", () => {
		it("should include tool name and description", () => {
			const description = getGitPushDescription()

			expect(description).toContain("## git_push")
			expect(description).toContain("Push the current branch to the remote repository")
			expect(description).toContain("Always ask for user approval")
		})

		it("should indicate no parameters required", () => {
			const description = getGitPushDescription()

			expect(description).toContain("No parameters required")
		})

		it("should include usage example", () => {
			const description = getGitPushDescription()

			expect(description).toContain("<git_push>")
			expect(description).toContain("</git_push>")
		})

		it("should include note about committing first", () => {
			const description = getGitPushDescription()

			expect(description).toContain("Make sure you have committed your changes before pushing")
		})
	})
})
