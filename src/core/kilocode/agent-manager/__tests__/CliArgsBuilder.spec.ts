import { describe, it, expect } from "vitest"
import { buildCliArgs } from "../CliArgsBuilder"

describe("buildCliArgs", () => {
	it("returns correct args for basic prompt", () => {
		const args = buildCliArgs("/workspace", "hello world")

		expect(args).toEqual(["--auto", "--json", "--workspace=/workspace", "hello world"])
	})

	it("preserves prompt with special characters", () => {
		const prompt = 'echo "$(whoami)"'
		const args = buildCliArgs("/tmp", prompt)

		expect(args).toHaveLength(4)
		expect(args[3]).toBe(prompt)
	})

	it("handles workspace paths with spaces", () => {
		const args = buildCliArgs("/path/with spaces/project", "test")

		expect(args[2]).toBe("--workspace=/path/with spaces/project")
	})

	it("handles empty prompt", () => {
		const args = buildCliArgs("/workspace", "")

		expect(args).toEqual(["--auto", "--json", "--workspace=/workspace", ""])
	})

	it("handles multiline prompts", () => {
		const prompt = "line1\nline2\nline3"
		const args = buildCliArgs("/workspace", prompt)

		expect(args[3]).toBe(prompt)
	})

	it("always includes --auto and --json flags", () => {
		const args = buildCliArgs("/any", "any prompt")

		expect(args[0]).toBe("--auto")
		expect(args[1]).toBe("--json")
	})
})
