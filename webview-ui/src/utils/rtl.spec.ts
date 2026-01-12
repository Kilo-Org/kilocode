import { describe, it, expect } from "vitest"
import { isRTLLanguage, getTextDirection, containsRTLCharacters, getTextDirectionFromContent } from "./textDirection"

describe("RTL Utils", () => {
	describe("isRTLLanguage", () => {
		it("should return true for Arabic", () => {
			expect(isRTLLanguage("ar")).toBe(true)
			expect(isRTLLanguage("ar-SA")).toBe(true)
			expect(isRTLLanguage("ar-EG")).toBe(true)
		})

		it("should return true for Hebrew", () => {
			expect(isRTLLanguage("he")).toBe(true)
			expect(isRTLLanguage("he-IL")).toBe(true)
		})

		it("should return true for Persian", () => {
			expect(isRTLLanguage("fa")).toBe(true)
			expect(isRTLLanguage("fa-IR")).toBe(true)
		})

		it("should return false for LTR languages", () => {
			expect(isRTLLanguage("en")).toBe(false)
			expect(isRTLLanguage("en-US")).toBe(false)
			expect(isRTLLanguage("zh-CN")).toBe(false)
			expect(isRTLLanguage("fr")).toBe(false)
			expect(isRTLLanguage("de")).toBe(false)
		})

		it("should return false for undefined", () => {
			expect(isRTLLanguage(undefined)).toBe(false)
		})
	})

	describe("getTextDirection", () => {
		it("should return rtl for RTL languages", () => {
			expect(getTextDirection("ar")).toBe("rtl")
			expect(getTextDirection("he")).toBe("rtl")
			expect(getTextDirection("fa")).toBe("rtl")
		})

		it("should return ltr for LTR languages", () => {
			expect(getTextDirection("en")).toBe("ltr")
			expect(getTextDirection("fr")).toBe("ltr")
			expect(getTextDirection("zh-CN")).toBe("ltr")
		})

		it("should return ltr for undefined", () => {
			expect(getTextDirection(undefined)).toBe("ltr")
		})
	})

	describe("containsRTLCharacters", () => {
		it("should return true for Arabic text", () => {
			expect(containsRTLCharacters("مرحبا بالعالم")).toBe(true)
			expect(containsRTLCharacters("Hello مرحبا")).toBe(true)
		})

		it("should return true for Hebrew text", () => {
			expect(containsRTLCharacters("שלום עולם")).toBe(true)
		})

		it("should return false for LTR text", () => {
			expect(containsRTLCharacters("Hello World")).toBe(false)
			expect(containsRTLCharacters("Bonjour le monde")).toBe(false)
		})

		it("should return false for empty text", () => {
			expect(containsRTLCharacters("")).toBe(false)
		})
	})

	describe("getTextDirectionFromContent", () => {
		it("should return rtl for RTL content", () => {
			expect(getTextDirectionFromContent("مرحبا بالعالم")).toBe("rtl")
			expect(getTextDirectionFromContent("שלום עולם")).toBe("rtl")
		})

		it("should return ltr for LTR content", () => {
			expect(getTextDirectionFromContent("Hello World")).toBe("ltr")
			expect(getTextDirectionFromContent("Bonjour le monde")).toBe("ltr")
		})

		it("should return ltr for mixed content with majority LTR", () => {
			expect(getTextDirectionFromContent("Hello مرحبا World")).toBe("ltr")
		})
	})
})
