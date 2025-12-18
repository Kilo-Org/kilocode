import { describe, it, expect } from "vitest"
import { buildCliArgs } from "../CliArgsBuilder"

describe("CliArgsBuilder", () => {
	const workspace = "/path/to/workspace"
	const prompt = "Build a todo app"

	it("builds basic args with workspace and prompt", () => {
		const args = buildCliArgs(workspace, prompt)

		expect(args).toContain("--json-io")
		expect(args).toContain(`--workspace=${workspace}`)
		expect(args).toContain(prompt)
	})

	it("adds --parallel flag when parallelMode is true", () => {
		const args = buildCliArgs(workspace, prompt, { parallelMode: true })

		expect(args).toContain("--parallel")
	})

	it("adds --session flag when sessionId is provided", () => {
		const args = buildCliArgs(workspace, prompt, { sessionId: "abc123" })

		expect(args).toContain("--session=abc123")
	})

	it("omits prompt when empty (for session resume)", () => {
		const args = buildCliArgs(workspace, "", { sessionId: "abc123" })

		expect(args).not.toContain("")
		expect(args).toContain("--session=abc123")
	})

	describe("existingBranch", () => {
		it("adds --existing-branch flag when parallelMode and existingBranch are set", () => {
			const args = buildCliArgs(workspace, prompt, {
				parallelMode: true,
				existingBranch: "feature/my-branch",
			})

			expect(args).toContain("--parallel")
			expect(args).toContain("--existing-branch=feature/my-branch")
		})

		it("ignores existingBranch when parallelMode is false", () => {
			const args = buildCliArgs(workspace, prompt, {
				parallelMode: false,
				existingBranch: "feature/my-branch",
			})

			expect(args).not.toContain("--parallel")
			expect(args.some((arg) => arg.includes("--existing-branch"))).toBe(false)
		})

		it("handles branch names with special characters", () => {
			const args = buildCliArgs(workspace, prompt, {
				parallelMode: true,
				existingBranch: "feature/add-user-auth",
			})

			expect(args).toContain("--existing-branch=feature/add-user-auth")
		})
	})
})
