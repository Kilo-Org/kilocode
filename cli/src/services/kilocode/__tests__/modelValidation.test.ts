/**
 * Tests for model validation service
 */

import { describe, it, expect } from "vitest"
import { validateModelAvailability, validateModelForOrganization } from "../modelValidation.js"
import type { ModelRecord } from "../../../constants/providers/models.js"

describe("modelValidation", () => {
	describe("validateModelAvailability", () => {
		it("should return true for available model", () => {
			const models: ModelRecord = {
				"claude-sonnet-4": {
					contextWindow: 200000,
					supportsPromptCache: true,
				},
			}
			expect(validateModelAvailability("claude-sonnet-4", models)).toBe(true)
		})

		it("should return false for unavailable model", () => {
			const models: ModelRecord = {
				"claude-sonnet-4": {
					contextWindow: 200000,
					supportsPromptCache: true,
				},
			}
			expect(validateModelAvailability("gpt-4", models)).toBe(false)
		})

		it("should return false for empty model list", () => {
			const models: ModelRecord = {}
			expect(validateModelAvailability("claude-sonnet-4", models)).toBe(false)
		})
	})

	describe("validateModelForOrganization", () => {
		it("should return valid when model is available", () => {
			const result = validateModelForOrganization({
				currentModel: "claude-sonnet-4",
				availableModels: {
					"claude-sonnet-4": {
						contextWindow: 200000,
						supportsPromptCache: true,
					},
				},
				defaultModel: "claude-haiku",
			})

			expect(result.isValid).toBe(true)
			expect(result.currentModel).toBe("claude-sonnet-4")
			expect(result.fallbackModel).toBeUndefined()
		})

		it("should return fallback to default when model not available", () => {
			const result = validateModelForOrganization({
				currentModel: "gpt-4",
				availableModels: {
					"claude-sonnet-4": {
						contextWindow: 200000,
						supportsPromptCache: true,
					},
				},
				defaultModel: "claude-sonnet-4",
			})

			expect(result.isValid).toBe(false)
			expect(result.currentModel).toBe("gpt-4")
			expect(result.fallbackModel).toBe("claude-sonnet-4")
		})
	})
})
