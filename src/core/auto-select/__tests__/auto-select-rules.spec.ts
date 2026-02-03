// kilocode_change whole file
import { autoSelectRules, AutoSelectResult } from "../auto-select-rules"
import { Task } from "../../task/Task"
import type { RuleMetadata } from "../../../shared/cline-rules"

// Mock dependencies
vi.mock("../../../api", () => ({
	buildApiHandler: vi.fn(),
}))

vi.mock("../../../utils/single-completion-handler", () => ({
	streamResponseFromHandler: vi.fn(),
}))

vi.mock("../../../shared/support-prompt", () => ({
	supportPrompt: {
		create: vi.fn().mockReturnValue("mock system prompt"),
	},
}))

import { buildApiHandler } from "../../../api"
import { streamResponseFromHandler } from "../../../utils/single-completion-handler"

describe("autoSelectRules", () => {
	const mockRules: RuleMetadata[] = [
		{ name: "Rule A", path: "/rules/a.md", description: "First rule", isGlobal: false },
		{ name: "Rule B", path: "/rules/b.md", description: "Second rule", isGlobal: true },
		{ name: "Rule C", path: "/rules/c.md", description: "Third rule", isGlobal: false },
	]

	const createMockTask = (stateOverrides = {}): Task => {
		const mockState = {
			autoSelectRulesApiConfigId: undefined,
			listApiConfigMeta: [{ id: "config-1", name: "Config 1" }],
			apiConfiguration: { apiProvider: "anthropic", apiKey: "test-key" },
			customSupportPrompts: undefined,
			...stateOverrides,
		}

		return {
			providerRef: {
				deref: () => ({
					getState: vi.fn().mockResolvedValue(mockState),
					providerSettingsManager: {
						getProfile: vi.fn().mockResolvedValue({ apiProvider: "anthropic", apiKey: "test-key" }),
					},
				}),
			},
		} as unknown as Task
	}

	beforeEach(() => {
		vi.clearAllMocks()

		// Default mock for buildApiHandler
		vi.mocked(buildApiHandler).mockReturnValue({
			initialize: vi.fn().mockResolvedValue(undefined),
			createMessage: vi.fn(),
			getModel: vi.fn().mockReturnValue({
				id: "claude-3-haiku",
				info: { inputPrice: 0.25, outputPrice: 1.25 },
			}),
		} as any)
	})

	describe("return type", () => {
		it("should return both selectedRulePaths and selectedRuleNames", async () => {
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "0, 2",
				usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
			})

			const result = await autoSelectRules("user prompt", mockRules, createMockTask())

			expect(result).toHaveProperty("selectedRulePaths")
			expect(result).toHaveProperty("selectedRuleNames")
			expect(result.selectedRulePaths).toEqual(["/rules/a.md", "/rules/c.md"])
			expect(result.selectedRuleNames).toEqual(["Rule A", "Rule C"])
		})

		it("should return empty arrays when no rules match", async () => {
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "none",
				usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
			})

			const result = await autoSelectRules("user prompt", mockRules, createMockTask())

			expect(result.selectedRulePaths).toEqual([])
			expect(result.selectedRuleNames).toEqual([])
		})

		it("should return all rules when no API configs available", async () => {
			const task = createMockTask({ listApiConfigMeta: null })

			const result = await autoSelectRules("user prompt", mockRules, task)

			expect(result.selectedRulePaths).toEqual(mockRules.map((r) => r.path))
			expect(result.selectedRuleNames).toEqual(mockRules.map((r) => r.name))
		})
	})

	describe("empty rules handling", () => {
		it("should return empty result when no rules available", async () => {
			const result = await autoSelectRules("user prompt", [], createMockTask())

			expect(result.selectedRulePaths).toEqual([])
			expect(result.selectedRuleNames).toEqual([])
			expect(streamResponseFromHandler).not.toHaveBeenCalled()
		})
	})

	describe("response parsing", () => {
		it("should parse comma-separated indices", async () => {
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "0, 1, 2",
				usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
			})

			const result = await autoSelectRules("user prompt", mockRules, createMockTask())

			expect(result.selectedRulePaths).toEqual(["/rules/a.md", "/rules/b.md", "/rules/c.md"])
			expect(result.selectedRuleNames).toEqual(["Rule A", "Rule B", "Rule C"])
		})

		it("should handle 'none' response", async () => {
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "none",
				usage: undefined,
			})

			const result = await autoSelectRules("user prompt", mockRules, createMockTask())

			expect(result.selectedRulePaths).toEqual([])
			expect(result.selectedRuleNames).toEqual([])
		})

		it("should ignore out-of-range indices", async () => {
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "0, 5, 10", // 5 and 10 are out of range for 3 rules
				usage: undefined,
			})

			const result = await autoSelectRules("user prompt", mockRules, createMockTask())

			expect(result.selectedRulePaths).toEqual(["/rules/a.md"])
			expect(result.selectedRuleNames).toEqual(["Rule A"])
		})
	})

	describe("error handling", () => {
		it("should return all rules on error", async () => {
			vi.mocked(streamResponseFromHandler).mockRejectedValue(new Error("API error"))

			const result = await autoSelectRules("user prompt", mockRules, createMockTask())

			expect(result.selectedRulePaths).toEqual(mockRules.map((r) => r.path))
			expect(result.selectedRuleNames).toEqual(mockRules.map((r) => r.name))
		})
	})

	describe("cost calculation", () => {
		it("should include totalCost when available from usage", async () => {
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "0",
				usage: { type: "usage", inputTokens: 100, outputTokens: 10, totalCost: 0.05 },
			})

			const result = await autoSelectRules("user prompt", mockRules, createMockTask())

			expect(result.totalCost).toBe(0.05)
		})

		it("should calculate cost when totalCost not in usage", async () => {
			vi.mocked(streamResponseFromHandler).mockResolvedValue({
				text: "0",
				usage: { type: "usage", inputTokens: 100, outputTokens: 10 },
			})

			const result = await autoSelectRules("user prompt", mockRules, createMockTask())

			// Cost should be calculated from model pricing
			expect(result.totalCost).toBeDefined()
		})
	})
})
