import { describe, it, expect } from "vitest"
import { buildCliArgs } from "../CliArgsBuilder"

describe("buildCliArgs", () => {
	it("always uses --json-io for bidirectional communication", () => {
		const args = buildCliArgs("/workspace", "hello world")

		expect(args[0]).toBe("--json-io")
	})

	it("returns correct args for basic prompt", () => {
		const args = buildCliArgs("/workspace", "hello world")

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

	it("combines all options correctly", () => {
		const args = buildCliArgs("/workspace", "prompt", {
			parallelMode: true,
			sessionId: "session-id",
		})

		expect(args).toEqual(["--json-io", "--workspace=/workspace", "--parallel", "--session=session-id", "prompt"])
	})

	it("includes --auto flag when autoMode is true", () => {
		const args = buildCliArgs("/workspace", "prompt", { autoMode: true })

		expect(args).toContain("--auto")
	})

	it("combines --auto and --parallel flags for multi-version mode", () => {
		const args = buildCliArgs("/workspace", "prompt", {
			parallelMode: true,
			autoMode: true,
		})

		expect(args).toContain("--parallel")
		expect(args).toContain("--auto")
		expect(args).toEqual(["--json-io", "--workspace=/workspace", "--auto", "--parallel", "prompt"])
	})
})
