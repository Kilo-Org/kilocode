import { describe, expect, it } from "vitest"
import { modelSupportsNextEdit } from "./autodetect"

describe("modelSupportsNextEdit", () => {
	describe("when capabilities.nextEdit is defined", () => {
		it("should return true when capabilities.nextEdit is true", () => {
			expect(
				modelSupportsNextEdit(
					{
						nextEdit: true,
					},
					"any-model",
					"Any Title",
				),
			).toBe(true)
		})

		it("should return false when capabilities.nextEdit is false", () => {
			expect(modelSupportsNextEdit({ nextEdit: false }, "mercury-coder", "Mercury Coder")).toBe(false)
		})

		it("should prioritize capabilities over model name matching", () => {
			// Even though model name matches, capabilities should take precedence.
			expect(modelSupportsNextEdit({ nextEdit: false }, "mercury-coder", "Mercury Coder")).toBe(false)
		})
	})

	describe("when capabilities.nextEdit is undefined", () => {
		it("should return true for mercury-coder model (case insensitive)", () => {
			expect(modelSupportsNextEdit(undefined, "Mercury-Coder", undefined)).toBe(true)
		})

		it("should return true for instinct", () => {
			expect(modelSupportsNextEdit(undefined, "instinct", undefined)).toBe(true)
		})

		it("should return true when model contains supported model name as substring", () => {
			expect(modelSupportsNextEdit(undefined, "provider/mercury-coder-v2", undefined)).toBe(true)
		})

		it("should return true when title contains supported model name", () => {
			expect(modelSupportsNextEdit(undefined, "some-model", "This is mercury-coder model")).toBe(true)
		})

		it("should return true when title contains instinct", () => {
			expect(modelSupportsNextEdit(undefined, "some-model", "instinct deployment")).toBe(true)
		})

		it("should return true for unsupported models that have capabilities explicitly set to true", () => {
			expect(
				modelSupportsNextEdit(
					{
						nextEdit: true,
					},
					"gpt-4",
					"GPT-4 Model",
				),
			).toBe(true)
		})

		it("should return false for unsupported models", () => {
			expect(modelSupportsNextEdit(undefined, "gpt-4", "GPT-4 Model")).toBe(false)
		})

		it("should return false when model and title are both undefined/null", () => {
			expect(modelSupportsNextEdit(undefined, "", undefined)).toBe(false)
		})

		it("should return false when model and title do not contain supported names", () => {
			expect(modelSupportsNextEdit(undefined, "claude-3", "Claude 3 Sonnet")).toBe(false)
		})
	})

	describe("edge cases", () => {
		it("should handle empty strings", () => {
			expect(modelSupportsNextEdit(undefined, "", "")).toBe(false)
		})

		it("should handle undefined title gracefully", () => {
			expect(modelSupportsNextEdit(undefined, "mercury-coder", undefined)).toBe(true)
		})

		it("should handle case sensitivity correctly", () => {
			expect(modelSupportsNextEdit(undefined, "MERCURY-CODER", "instinct")).toBe(true)
		})

		it("should handle capabilities with other properties", () => {
			expect(
				modelSupportsNextEdit(
					{
						nextEdit: true,
						uploadImage: false,
					},
					"unsupported-model",
					undefined,
				),
			).toBe(true)
		})
	})
})
