import { formatCost } from "../costFormatting"

describe("formatCost", () => {
	it("should format zero cost correctly", () => {
		expect(formatCost(0)).toBe("$0.00")
	})

	it("should format costs less than one cent", () => {
		expect(formatCost(0.001)).toBe("<$0.01")
		expect(formatCost(0.005)).toBe("<$0.01")
		expect(formatCost(0.009)).toBe("<$0.01")
	})

	it("should format costs one cent and above", () => {
		expect(formatCost(0.01)).toBe("$0.01")
		expect(formatCost(0.99)).toBe("$0.99")
		expect(formatCost(1.0)).toBe("$1.00")
		expect(formatCost(1.234)).toBe("$1.23")
		expect(formatCost(10.567)).toBe("$10.57")
		expect(formatCost(100.999)).toBe("$101.00")
	})

	it("should handle large amounts", () => {
		expect(formatCost(1000.5)).toBe("$1000.50")
		expect(formatCost(999999.99)).toBe("$999999.99")
	})

	it("should round to two decimal places", () => {
		expect(formatCost(1.234567)).toBe("$1.23")
		expect(formatCost(1.235)).toBe("$1.24") // Rounds up
		expect(formatCost(1.999)).toBe("$2.00") // Rounds up
	})
})
