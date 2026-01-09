import { describe, it, expect } from "vitest"
import { buildCliArgs } from "../CliArgsBuilder"

describe("CliArgsBuilder", () => {
	const workspace = "/path/to/workspace"
	const prompt = "Build a todo app"

	it("builds basic args with workspace and prompt", () => {
		const args = buildCliArgs(workspace, prompt)

		expect(args).toContain("--json-io")
		expect(args).toContain("--yolo")
		expect(args).toContain(`--workspace=${workspace}`)
		expect(args).toContain(prompt)
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

	it("does not include --parallel flag (worktree is handled by extension)", () => {
		// CLI is now worktree-agnostic - extension creates worktree and passes path as workspace
		const args = buildCliArgs(workspace, prompt)

		expect(args).not.toContain("--parallel")
		expect(args.some((arg) => arg.includes("--existing-branch"))).toBe(false)
	})
})
