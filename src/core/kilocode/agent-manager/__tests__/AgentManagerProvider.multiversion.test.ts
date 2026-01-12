import { describe, it, expect } from "vitest"
import { extractSessionConfigs, type SessionConfig } from "../multiVersionUtils"

/**
 * Tests for multi-version session spawning logic in AgentManagerProvider.
 *
 * Since AgentManagerProvider is tightly coupled to VSCode APIs, we test the
 * extracted logic functions rather than the full class. The key behaviors to test:
 *
 * 1. Single version (count=1) should spawn once with the original prompt
 * 2. Multiple versions (count>1) should:
 *    - Always use parallelMode=true for isolated worktrees
 *    - Generate labels with (v1), (v2), etc. suffixes
 *    - Spawn sessions sequentially
 *
 * All sessions run with --auto flag since Agent Manager has no approval UI.
 */

describe("Multi-version session spawning", () => {
	describe("extractSessionConfigs", () => {
		const prompt = "Build a todo app with React"

		it("returns single config for version=1", () => {
			const configs = extractSessionConfigs({
				prompt,
				versions: 1,
			})

			expect(configs).toHaveLength(1)
			expect(configs[0]).toEqual({
				prompt,
				label: prompt.slice(0, 50),
				parallelMode: false,
			})
		})

		it("respects parallelMode for single version", () => {
			const configs = extractSessionConfigs({
				prompt,
				versions: 1,
				parallelMode: true,
			})

			expect(configs).toHaveLength(1)
			expect(configs[0].parallelMode).toBe(true)
		})

		it("returns multiple configs for version>1", () => {
			const configs = extractSessionConfigs({
				prompt,
				versions: 3,
			})

			expect(configs).toHaveLength(3)
		})

		it("forces parallelMode=true for multi-version", () => {
			const configs = extractSessionConfigs({
				prompt,
				versions: 2,
				parallelMode: false, // Should be overridden
			})

			expect(configs).toHaveLength(2)
			expect(configs[0].parallelMode).toBe(true)
			expect(configs[1].parallelMode).toBe(true)
		})

		it("uses provided labels for multi-version", () => {
			const labels = ["Version A", "Version B"]
			const configs = extractSessionConfigs({
				prompt,
				versions: 2,
				labels,
			})

			expect(configs).toHaveLength(2)
			expect(configs[0].label).toBe("Version A")
			expect(configs[1].label).toBe("Version B")
		})

		it("generates default labels with (v1), (v2) suffixes if not provided", () => {
			const configs = extractSessionConfigs({
				prompt,
				versions: 3,
			})

			expect(configs[0].label).toBe(`${prompt.slice(0, 50)} (v1)`)
			expect(configs[1].label).toBe(`${prompt.slice(0, 50)} (v2)`)
			expect(configs[2].label).toBe(`${prompt.slice(0, 50)} (v3)`)
		})

		it("all configs share the same prompt", () => {
			const configs = extractSessionConfigs({
				prompt,
				versions: 4,
			})

			expect(configs).toHaveLength(4)
			configs.forEach((config) => {
				expect(config.prompt).toBe(prompt)
			})
		})

		it("handles maximum version count of 4", () => {
			const configs = extractSessionConfigs({
				prompt,
				versions: 4,
				labels: ["A (v1)", "B (v2)", "C (v3)", "D (v4)"],
			})

			expect(configs).toHaveLength(4)
			configs.forEach((config) => {
				expect(config.parallelMode).toBe(true)
			})
		})

		it("defaults to version=1 if not provided", () => {
			const configs = extractSessionConfigs({
				prompt,
			})

			expect(configs).toHaveLength(1)
			expect(configs[0].parallelMode).toBe(false)
		})

		it("truncates label to 50 characters", () => {
			const longPrompt = "This is a very long prompt that exceeds fifty characters by quite a bit"
			const configs = extractSessionConfigs({
				prompt: longPrompt,
				versions: 1,
			})

			expect(configs[0].label).toHaveLength(50)
			expect(configs[0].label).toBe(longPrompt.slice(0, 50))
		})

		describe("existingBranch", () => {
			it("passes existingBranch through for single version", () => {
				const configs = extractSessionConfigs({
					prompt,
					versions: 1,
					parallelMode: true,
					existingBranch: "feature/my-branch",
				})

				expect(configs).toHaveLength(1)
				expect(configs[0].existingBranch).toBe("feature/my-branch")
			})

			it("excludes existingBranch in multi-version mode", () => {
				const configs = extractSessionConfigs({
					prompt,
					versions: 2,
					existingBranch: "feature/my-branch",
				})

				expect(configs).toHaveLength(2)
				expect(configs[0].existingBranch).toBeUndefined()
				expect(configs[1].existingBranch).toBeUndefined()
			})
		})
	})
})
