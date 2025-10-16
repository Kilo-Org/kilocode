// npx vitest run src/__tests__/kilocode.test.ts

import { describe, it, expect } from "vitest"
import { ghostServiceSettingsSchema } from "../kilocode/kilocode.js"

describe("ghostServiceSettingsSchema", () => {
	describe("autoTriggerDelay", () => {
		it("should accept valid millisecond values", () => {
			const validValues = [50, 100, 200, 1000, 3000, 5000]

			for (const value of validValues) {
				const result = ghostServiceSettingsSchema.safeParse({
					autoTriggerDelay: value,
				})
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.data?.autoTriggerDelay).toBe(value)
				}
			}
		})

		it("should accept legacy second values for backward compatibility (1-5 seconds)", () => {
			// Values 1-5 are treated as seconds and capped at 5 (= 5000ms)
			const legacyValues = [1, 3, 5]

			for (const value of legacyValues) {
				const result = ghostServiceSettingsSchema.safeParse({
					autoTriggerDelay: value,
				})
				expect(result.success).toBe(true)
				if (result.success) {
					expect(result.data?.autoTriggerDelay).toBe(value)
				}
			}
		})

		it("should accept legacy values above 5 seconds (they get capped at runtime)", () => {
			const legacyValues = [6, 10, 30, 49]

			for (const value of legacyValues) {
				const result = ghostServiceSettingsSchema.safeParse({
					autoTriggerDelay: value,
				})
				expect(result.success).toBe(true)
			}
		})

		it("should reject values below minimum (1 for legacy, 50 for new)", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				autoTriggerDelay: 0,
			})
			expect(result.success).toBe(false)
		})

		it("should reject values above maximum (5000ms)", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				autoTriggerDelay: 5001,
			})
			expect(result.success).toBe(false)
		})

		it("should be optional", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				enableAutoTrigger: true,
			})
			expect(result.success).toBe(true)
		})
	})

	describe("other ghost service settings", () => {
		it("should accept all boolean settings", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				enableAutoTrigger: true,
				enableQuickInlineTaskKeybinding: false,
				enableSmartInlineTaskKeybinding: true,
				showGutterAnimation: false,
			})
			expect(result.success).toBe(true)
		})

		it("should accept combined settings", () => {
			const result = ghostServiceSettingsSchema.safeParse({
				enableAutoTrigger: true,
				autoTriggerDelay: 1500,
				enableQuickInlineTaskKeybinding: true,
				enableSmartInlineTaskKeybinding: true,
				showGutterAnimation: true,
			})
			expect(result.success).toBe(true)
			if (result.success) {
				expect(result.data?.autoTriggerDelay).toBe(1500)
			}
		})
	})
})
