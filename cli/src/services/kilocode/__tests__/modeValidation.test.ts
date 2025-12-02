/**
 * Tests for mode validation service
 */

import { describe, it, expect } from "vitest"
import { validateModeAvailability, getFallbackMode, getModeValidationResult } from "../modeValidation.js"
import type { ModeConfig } from "../../../types/messages.js"

describe("modeValidation", () => {
	describe("validateModeAvailability", () => {
		it("should return true for default modes", () => {
			const customModes: ModeConfig[] = []

			expect(validateModeAvailability("code", customModes)).toBe(true)
			expect(validateModeAvailability("architect", customModes)).toBe(true)
			expect(validateModeAvailability("ask", customModes)).toBe(true)
			expect(validateModeAvailability("debug", customModes)).toBe(true)
			expect(validateModeAvailability("orchestrator", customModes)).toBe(true)
		})

		it("should return true for custom modes", () => {
			const customModes: ModeConfig[] = [
				{
					slug: "custom-mode",
					name: "Custom Mode",
					roleDefinition: "A custom mode",
					groups: ["read"],
					source: "project",
				},
			]

			expect(validateModeAvailability("custom-mode", customModes)).toBe(true)
		})

		it("should return true for organization modes", () => {
			const customModes: ModeConfig[] = [
				{
					slug: "org-mode",
					name: "Org Mode",
					roleDefinition: "An organization mode",
					groups: ["read"],
					source: "organization",
				},
			]

			expect(validateModeAvailability("org-mode", customModes)).toBe(true)
		})

		it("should return false for non-existent modes", () => {
			const customModes: ModeConfig[] = []

			expect(validateModeAvailability("non-existent", customModes)).toBe(false)
		})

		it("should return false for organization mode from different org", () => {
			const customModes: ModeConfig[] = [
				{
					slug: "org-a-mode",
					name: "Org A Mode",
					roleDefinition: "Organization A mode",
					groups: ["read"],
					source: "organization",
				},
			]

			// Trying to use a mode from org B when only org A modes are available
			expect(validateModeAvailability("org-b-mode", customModes)).toBe(false)
		})

		it("should handle multiple custom modes", () => {
			const customModes: ModeConfig[] = [
				{
					slug: "mode-1",
					name: "Mode 1",
					roleDefinition: "First mode",
					groups: ["read"],
					source: "project",
				},
				{
					slug: "mode-2",
					name: "Mode 2",
					roleDefinition: "Second mode",
					groups: ["read"],
					source: "organization",
				},
			]

			expect(validateModeAvailability("mode-1", customModes)).toBe(true)
			expect(validateModeAvailability("mode-2", customModes)).toBe(true)
			expect(validateModeAvailability("mode-3", customModes)).toBe(false)
		})
	})

	describe("getFallbackMode", () => {
		it("should return 'code' as fallback mode", () => {
			expect(getFallbackMode()).toBe("code")
		})
	})

	describe("getModeValidationResult", () => {
		it("should return valid result for default modes", () => {
			const customModes: ModeConfig[] = []

			const result = getModeValidationResult("code", customModes)

			expect(result.isValid).toBe(true)
			expect(result.fallbackMode).toBeNull()
		})

		it("should return valid result for custom modes", () => {
			const customModes: ModeConfig[] = [
				{
					slug: "custom-mode",
					name: "Custom Mode",
					roleDefinition: "A custom mode",
					groups: ["read"],
					source: "project",
				},
			]

			const result = getModeValidationResult("custom-mode", customModes)

			expect(result.isValid).toBe(true)
			expect(result.fallbackMode).toBeNull()
		})

		it("should return invalid result with fallback for non-existent modes", () => {
			const customModes: ModeConfig[] = []

			const result = getModeValidationResult("non-existent", customModes)

			expect(result.isValid).toBe(false)
			expect(result.fallbackMode).toBe("code")
		})

		it("should return invalid result when organization mode is not available", () => {
			const customModes: ModeConfig[] = [
				{
					slug: "org-a-mode",
					name: "Org A Mode",
					roleDefinition: "Organization A mode",
					groups: ["read"],
					source: "organization",
				},
			]

			// Trying to validate org-b-mode when only org-a-mode is available
			const result = getModeValidationResult("org-b-mode", customModes)

			expect(result.isValid).toBe(false)
			expect(result.fallbackMode).toBe("code")
		})
	})
})
