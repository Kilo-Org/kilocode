// npx vitest run src/shared/__tests__/language.spec.ts

import { formatLanguage } from "../language"

describe("formatLanguage", () => {
	it("should handle empty or undefined input", () => {
		expect(formatLanguage("")).toBe("en")
		expect(formatLanguage(undefined as unknown as string)).toBe("en")
	})
})
