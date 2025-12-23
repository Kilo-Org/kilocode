import { describe, it, expect } from "vitest"
import { buildCliArgs } from "../CliArgsBuilder"

describe("buildCliArgs", () => {
	it("always uses --json-io for bidirectional communication", () => {
		const args = buildCliArgs("/workspace", "hello world")

		expect(args).toContain("--json-io")
	})

	it("returns correct args for basic prompt (permission-aware mode by default)", () => {
		const args = buildCliArgs("/workspace", "hello world")

		// By default, --yolo is NOT included - runs in permission-aware mode
		expect(args).toEqual(["--json-io", "--workspace=/workspace", "hello world"])
	})

	it("preserves prompt with special characters", () => {
		const prompt = 'echo "$(whoami)"'
		const args = buildCliArgs("/tmp", prompt)

		expect(args).toHaveLength(3)
		expect(args[2]).toBe(prompt)
	})

	it("handles workspace paths with spaces", () => {
		const args = buildCliArgs("/path/with spaces/project", "test")

		expect(args[1]).toBe("--workspace=/path/with spaces/project")
	})

	it("omits empty prompt from args (used for resume without new prompt)", () => {
		const args = buildCliArgs("/workspace", "")

		// Empty prompt should not be added to args - this is used when resuming
		// a session with --session where we don't want to pass a new prompt
		expect(args).toEqual(["--json-io", "--workspace=/workspace"])
	})

	it("handles multiline prompts", () => {
		const prompt = "line1\nline2\nline3"
		const args = buildCliArgs("/workspace", prompt)

		expect(args[2]).toBe(prompt)
	})

	it("includes --parallel flag when parallelMode is true", () => {
		const args = buildCliArgs("/workspace", "prompt", { parallelMode: true })

		expect(args).toContain("--parallel")
	})

	it("includes --session flag when sessionId is provided", () => {
		const args = buildCliArgs("/workspace", "prompt", { sessionId: "abc123" })

		expect(args).toContain("--session=abc123")
	})

	it("combines all options correctly (without yolo by default)", () => {
		const args = buildCliArgs("/workspace", "prompt", {
			parallelMode: true,
			sessionId: "session-id",
		})

		expect(args).toEqual([
			"--json-io",
			"--workspace=/workspace",
			"--parallel",
			"--session=session-id",
			"prompt",
		])
	})

	it("combines all options correctly (with yolo when explicitly set)", () => {
		const args = buildCliArgs("/workspace", "prompt", {
			parallelMode: true,
			sessionId: "session-id",
			yolo: true,
		})

		expect(args).toEqual([
			"--json-io",
			"--workspace=/workspace",
			"--yolo",
			"--parallel",
			"--session=session-id",
			"prompt",
		])
	})

	it("uses --yolo for auto-approval when explicitly enabled", () => {
		const args = buildCliArgs("/workspace", "prompt", { yolo: true })

		expect(args).toContain("--yolo")
	})

	it("does NOT include --yolo by default (permission-aware mode)", () => {
		const args = buildCliArgs("/workspace", "prompt")

		expect(args).not.toContain("--yolo")
		expect(args).not.toContain("--auto")
	})
})
