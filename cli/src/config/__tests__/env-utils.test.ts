import { describe, it, expect } from "vitest"
import {
	parseBoolean,
	parseNumber,
	parseArray,
	snakeToCamelCase,
	parseReasoningEffort,
	parseVerbosity,
	VALID_REASONING_EFFORT_VALUES,
	VALID_VERBOSITY_VALUES,
} from "../env-utils.js"

describe("env-utils", () => {
	describe("parseBoolean", () => {
		it("should parse 'true' as true", () => {
			expect(parseBoolean("true")).toBe(true)
			expect(parseBoolean("TRUE")).toBe(true)
			expect(parseBoolean("True")).toBe(true)
		})

		it("should parse '1' as true", () => {
			expect(parseBoolean("1")).toBe(true)
		})

		it("should parse 'yes' as true", () => {
			expect(parseBoolean("yes")).toBe(true)
			expect(parseBoolean("YES")).toBe(true)
			expect(parseBoolean("Yes")).toBe(true)
		})

		it("should parse 'false' as false", () => {
			expect(parseBoolean("false")).toBe(false)
			expect(parseBoolean("FALSE")).toBe(false)
			expect(parseBoolean("False")).toBe(false)
		})

		it("should parse '0' as false", () => {
			expect(parseBoolean("0")).toBe(false)
		})

		it("should parse 'no' as false", () => {
			expect(parseBoolean("no")).toBe(false)
			expect(parseBoolean("NO")).toBe(false)
			expect(parseBoolean("No")).toBe(false)
		})

		it("should return default value for undefined", () => {
			expect(parseBoolean(undefined, true)).toBe(true)
			expect(parseBoolean(undefined, false)).toBe(false)
		})

		it("should return default value for invalid strings", () => {
			expect(parseBoolean("invalid", true)).toBe(true)
			expect(parseBoolean("invalid", false)).toBe(false)
		})

		it("should return undefined when no default is provided", () => {
			expect(parseBoolean(undefined)).toBeUndefined()
			expect(parseBoolean("invalid")).toBeUndefined()
		})
	})

	describe("parseNumber", () => {
		it("should parse valid numbers", () => {
			expect(parseNumber("42")).toBe(42)
			expect(parseNumber("0")).toBe(0)
			expect(parseNumber("-10")).toBe(-10)
			expect(parseNumber("3.14")).toBe(3.14)
		})

		it("should return default value for undefined", () => {
			expect(parseNumber(undefined, 100)).toBe(100)
		})

		it("should return default value for invalid strings", () => {
			expect(parseNumber("not a number", 50)).toBe(50)
		})

		it("should return undefined when no default is provided", () => {
			expect(parseNumber(undefined)).toBeUndefined()
			expect(parseNumber("invalid")).toBeUndefined()
		})
	})

	describe("parseArray", () => {
		it("should parse comma-separated values", () => {
			expect(parseArray("a,b,c")).toEqual(["a", "b", "c"])
		})

		it("should trim whitespace", () => {
			expect(parseArray("a, b , c")).toEqual(["a", "b", "c"])
		})

		it("should filter empty strings", () => {
			expect(parseArray("a,,b,,,c")).toEqual(["a", "b", "c"])
		})

		it("should return default value for undefined", () => {
			expect(parseArray(undefined, ["default"])).toEqual(["default"])
		})

		it("should return undefined when no default is provided", () => {
			expect(parseArray(undefined)).toBeUndefined()
		})

		it("should handle empty string", () => {
			expect(parseArray("", [])).toEqual([])
		})
	})

	describe("snakeToCamelCase", () => {
		it("should convert SCREAMING_SNAKE_CASE to camelCase", () => {
			expect(snakeToCamelCase("API_KEY")).toBe("apiKey")
			expect(snakeToCamelCase("BASE_URL")).toBe("baseUrl")
			expect(snakeToCamelCase("API_MODEL_ID")).toBe("apiModelId")
		})

		it("should convert snake_case to camelCase", () => {
			expect(snakeToCamelCase("api_key")).toBe("apiKey")
			expect(snakeToCamelCase("base_url")).toBe("baseUrl")
		})

		it("should handle single words", () => {
			expect(snakeToCamelCase("MODEL")).toBe("model")
			expect(snakeToCamelCase("model")).toBe("model")
		})

		it("should handle KILOCODE_ prefix", () => {
			expect(snakeToCamelCase("KILOCODE_MODEL")).toBe("kilocodeModel")
			expect(snakeToCamelCase("KILOCODE_ORGANIZATION_ID")).toBe("kilocodeOrganizationId")
		})
	})

	describe("parseReasoningEffort", () => {
		it("should parse all valid reasoning effort values", () => {
			for (const value of VALID_REASONING_EFFORT_VALUES) {
				expect(parseReasoningEffort(value)).toBe(value)
			}
		})

		it("should parse reasoning effort values case-insensitively", () => {
			expect(parseReasoningEffort("HIGH")).toBe("high")
			expect(parseReasoningEffort("Medium")).toBe("medium")
			expect(parseReasoningEffort("DISABLE")).toBe("disable")
		})

		it("should trim whitespace", () => {
			expect(parseReasoningEffort("  high  ")).toBe("high")
			expect(parseReasoningEffort("\tmedium\n")).toBe("medium")
		})

		it("should return undefined for invalid values", () => {
			expect(parseReasoningEffort("invalid")).toBeUndefined()
			expect(parseReasoningEffort("very-high")).toBeUndefined()
		})

		it("should return undefined for empty string", () => {
			expect(parseReasoningEffort("")).toBeUndefined()
		})

		it("should return undefined for undefined", () => {
			expect(parseReasoningEffort(undefined)).toBeUndefined()
		})

		it("should return default value when provided", () => {
			expect(parseReasoningEffort(undefined, "medium")).toBe("medium")
			expect(parseReasoningEffort("invalid", "high")).toBe("high")
		})
	})

	describe("parseVerbosity", () => {
		it("should parse all valid verbosity values", () => {
			for (const value of VALID_VERBOSITY_VALUES) {
				expect(parseVerbosity(value)).toBe(value)
			}
		})

		it("should parse verbosity values case-insensitively", () => {
			expect(parseVerbosity("HIGH")).toBe("high")
			expect(parseVerbosity("Medium")).toBe("medium")
			expect(parseVerbosity("LOW")).toBe("low")
		})

		it("should trim whitespace", () => {
			expect(parseVerbosity("  high  ")).toBe("high")
			expect(parseVerbosity("\tmedium\n")).toBe("medium")
		})

		it("should return undefined for invalid values", () => {
			expect(parseVerbosity("invalid")).toBeUndefined()
			expect(parseVerbosity("very-high")).toBeUndefined()
			expect(parseVerbosity("xhigh")).toBeUndefined() // Valid for reasoningEffort but not for verbosity
		})

		it("should return undefined for empty string", () => {
			expect(parseVerbosity("")).toBeUndefined()
		})

		it("should return undefined for undefined", () => {
			expect(parseVerbosity(undefined)).toBeUndefined()
		})

		it("should return default value when provided", () => {
			expect(parseVerbosity(undefined, "medium")).toBe("medium")
			expect(parseVerbosity("invalid", "high")).toBe("high")
		})
	})
})
