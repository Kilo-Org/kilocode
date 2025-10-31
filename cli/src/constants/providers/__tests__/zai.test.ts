/**
 * Tests for ZAI provider constants
 */

import { describe, it, expect } from "vitest"
import {
	ZAI_API_LINES,
	ZAI_MODELS,
	ZAI_DEFAULTS,
	getZaiApiLineInfo,
	getZaiModelInfo,
	formatZaiModelChoices,
	formatZaiApiLineChoices,
} from "../zai"

describe("ZAI constants", () => {
	describe("ZAI_API_LINES", () => {
		it("should have the correct number of API lines", () => {
			expect(ZAI_API_LINES).toHaveLength(2)
		})

		it("should contain international_coding API line", () => {
			const internationalLine = ZAI_API_LINES.find((line) => line.value === "international_coding")
			expect(internationalLine).toBeDefined()
			expect(internationalLine?.name).toBe("International Coding Plan")
			expect(internationalLine?.baseUrl).toBe("https://api.z.ai/api/coding/paas/v4")
			expect(internationalLine?.description).toContain("International")
		})

		it("should contain china_coding API line", () => {
			const chinaLine = ZAI_API_LINES.find((line) => line.value === "china_coding")
			expect(chinaLine).toBeDefined()
			expect(chinaLine?.name).toBe("China Coding Plan")
			expect(chinaLine?.baseUrl).toBe("https://open.bigmodel.cn/api/coding/paas/v4")
			expect(chinaLine?.description).toContain("China")
		})
	})

	describe("ZAI_MODELS", () => {
		it("should have the correct number of models", () => {
			expect(ZAI_MODELS).toHaveLength(4)
		})

		it("should contain all expected models", () => {
			const modelValues = ZAI_MODELS.map((model) => model.value)
			expect(modelValues).toContain("glm-4.6")
			expect(modelValues).toContain("glm-4.5")
			expect(modelValues).toContain("glm-4.5-air")
			expect(modelValues).toContain("glm-4.5-flash")
		})

		it("should have correct model information", () => {
			const glm46 = ZAI_MODELS.find((model) => model.value === "glm-4.6")
			expect(glm46).toBeDefined()
			expect(glm46?.name).toBe("GLM-4.6")
			expect(glm46?.contextWindow).toBe(204800)
			expect(glm46?.description).toContain("newest model")
		})
	})

	describe("ZAI_DEFAULTS", () => {
		it("should have correct default values", () => {
			expect(ZAI_DEFAULTS.apiLine).toBe("international_coding")
			expect(ZAI_DEFAULTS.model).toBe("glm-4.6")
		})
	})

	describe("getZaiApiLineInfo", () => {
		it("should return correct info for valid API line", () => {
			const info = getZaiApiLineInfo("international_coding")
			expect(info).toEqual({
				value: "international_coding",
				name: "International Coding Plan",
				description: "International API endpoint optimized for coding tasks",
				baseUrl: "https://api.z.ai/api/coding/paas/v4",
			})
		})

		it("should return undefined for invalid API line", () => {
			const info = getZaiApiLineInfo("invalid" as never)
			expect(info).toBeUndefined()
		})
	})

	describe("getZaiModelInfo", () => {
		it("should return correct info for valid model", () => {
			const info = getZaiModelInfo("glm-4.6")
			expect(info).toEqual({
				value: "glm-4.6",
				name: "GLM-4.6",
				description: "Zhipu's newest model with extended context window (up to 200k tokens)",
				contextWindow: 204800,
			})
		})

		it("should return undefined for invalid model", () => {
			const info = getZaiModelInfo("invalid-model")
			expect(info).toBeUndefined()
		})
	})

	describe("formatZaiModelChoices", () => {
		it("should format models for inquirer choices", () => {
			const choices = formatZaiModelChoices()
			expect(choices).toHaveLength(4)

			const glm46Choice = choices.find((choice) => choice.value === "glm-4.6")
			expect(glm46Choice).toBeDefined()
			expect(glm46Choice?.name).toContain("GLM-4.6")
			expect(glm46Choice?.name).toContain("204,800 tokens")
			expect(glm46Choice?.short).toBe("GLM-4.6")
		})
	})

	describe("formatZaiApiLineChoices", () => {
		it("should format API lines for inquirer choices", () => {
			const choices = formatZaiApiLineChoices()
			expect(choices).toHaveLength(2)

			const internationalChoice = choices.find((choice) => choice.value === "international_coding")
			expect(internationalChoice).toBeDefined()
			expect(internationalChoice?.name).toContain("International Coding Plan")
			expect(internationalChoice?.short).toBe("International Coding Plan")
		})
	})
})
