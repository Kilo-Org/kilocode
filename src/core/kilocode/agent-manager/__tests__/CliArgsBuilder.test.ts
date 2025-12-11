import { describe, it, expect } from "vitest"
import { buildCliArgs, type BuildCliArgsOptions } from "../CliArgsBuilder"

describe("CliArgsBuilder", () => {
	describe("buildCliArgs", () => {
		const workspace = "/path/to/workspace"
		const prompt = "Build a todo app"

		it("should build basic args with json-io and workspace", () => {
			const args = buildCliArgs(workspace, prompt)

			expect(args).toContain("--json-io")
			expect(args).toContain(`--workspace=${workspace}`)
			expect(args).toContain(prompt)
			expect(args).not.toContain("--parallel")
			expect(args).not.toContain("--auto")
		})

		it("should add --parallel flag when parallelMode is true", () => {
			const options: BuildCliArgsOptions = { parallelMode: true }
			const args = buildCliArgs(workspace, prompt, options)

			expect(args).toContain("--parallel")
			expect(args).toContain("--json-io")
			expect(args).toContain(`--workspace=${workspace}`)
		})

		it("should not add --parallel flag when parallelMode is false", () => {
			const options: BuildCliArgsOptions = { parallelMode: false }
			const args = buildCliArgs(workspace, prompt, options)

			expect(args).not.toContain("--parallel")
		})

		it("should add --session flag when sessionId is provided", () => {
			const options: BuildCliArgsOptions = { sessionId: "abc-123" }
			const args = buildCliArgs(workspace, prompt, options)

			expect(args).toContain("--session=abc-123")
		})

		it("should add --auto flag when autoMode is true", () => {
			const options: BuildCliArgsOptions = { autoMode: true }
			const args = buildCliArgs(workspace, prompt, options)

			expect(args).toContain("--auto")
			expect(args).toContain("--json-io")
		})

		it("should not add --auto flag when autoMode is false", () => {
			const options: BuildCliArgsOptions = { autoMode: false }
			const args = buildCliArgs(workspace, prompt, options)

			expect(args).not.toContain("--auto")
		})

		it("should not add --auto flag when autoMode is undefined", () => {
			const options: BuildCliArgsOptions = {}
			const args = buildCliArgs(workspace, prompt, options)

			expect(args).not.toContain("--auto")
		})

		it("should combine --parallel and --auto flags for multi-version mode", () => {
			const options: BuildCliArgsOptions = {
				parallelMode: true,
				autoMode: true,
			}
			const args = buildCliArgs(workspace, prompt, options)

			expect(args).toContain("--parallel")
			expect(args).toContain("--auto")
			expect(args).toContain("--json-io")
			expect(args).toContain(`--workspace=${workspace}`)
			expect(args).toContain(prompt)
		})

		it("should place prompt as the last argument", () => {
			const options: BuildCliArgsOptions = {
				parallelMode: true,
				autoMode: true,
				sessionId: "session-123",
			}
			const args = buildCliArgs(workspace, prompt, options)

			expect(args[args.length - 1]).toBe(prompt)
		})

		it("should handle empty options object", () => {
			const args = buildCliArgs(workspace, prompt, {})

			expect(args).toContain("--json-io")
			expect(args).toContain(`--workspace=${workspace}`)
			expect(args).toContain(prompt)
			expect(args).not.toContain("--parallel")
			expect(args).not.toContain("--auto")
		})

		it("should handle undefined options", () => {
			const args = buildCliArgs(workspace, prompt, undefined)

			expect(args).toContain("--json-io")
			expect(args).toContain(`--workspace=${workspace}`)
			expect(args).toContain(prompt)
		})
	})
})
