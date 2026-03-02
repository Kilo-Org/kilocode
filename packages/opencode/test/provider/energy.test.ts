import { describe, it, expect } from "bun:test"
import { parseNeuralwatt, parseGreenPT, formatWh } from "../../src/provider/energy"

describe("parseNeuralwatt", () => {
	it("should parse energy_joules and energy_kwh", () => {
		const result = parseNeuralwatt({
			energy_joules: 1632,
			energy_kwh: 0.000453,
			avg_power_watts: 379.1,
			attribution_method: "rapl",
		})

		expect(result.joules).toBe(1632)
		expect(result.kwh).toBe(0.000453)
		expect(result.wh).toBe(0.453) // kwh * 1000
		expect(result.source).toBe("measured")
		expect(result.provider).toBe("neuralwatt")
		expect(result.method).toBe("rapl")
		expect(result.raw).toEqual({
			energy_joules: 1632,
			energy_kwh: 0.000453,
			avg_power_watts: 379.1,
			attribution_method: "rapl",
		})
	})

	it("should derive wh from joules when kwh is absent", () => {
		const result = parseNeuralwatt({ energy_joules: 3600 })

		expect(result.joules).toBe(3600)
		expect(result.kwh).toBeUndefined()
		expect(result.wh).toBeCloseTo(1.0) // 3600 / 3600
	})

	it("should handle missing energy fields", () => {
		const result = parseNeuralwatt({})

		expect(result.joules).toBeUndefined()
		expect(result.kwh).toBeUndefined()
		expect(result.wh).toBeUndefined()
		expect(result.source).toBe("measured")
		expect(result.provider).toBe("neuralwatt")
	})

	it("should ignore non-numeric energy values", () => {
		const result = parseNeuralwatt({ energy_joules: "not a number", energy_kwh: null })

		expect(result.joules).toBeUndefined()
		expect(result.kwh).toBeUndefined()
		expect(result.wh).toBeUndefined()
	})
})

describe("parseGreenPT", () => {
	it("should parse Watt-milliseconds energy and ugCO2e emissions", () => {
		const result = parseGreenPT({
			version: "20250922",
			energy: { total: 3_600_000, unit: "Wms" },
			emissions: { total: 1_000_000, unit: "ugCO2e" },
		})

		expect(result.wh).toBeCloseTo(1.0) // 3_600_000 / 3_600_000
		expect(result.kwh).toBeCloseTo(0.001)
		expect(result.joules).toBeCloseTo(3600) // 3_600_000 / 1000
		expect(result.gCO2e).toBeCloseTo(1.0) // 1_000_000 / 1_000_000
		expect(result.source).toBe("measured")
		expect(result.provider).toBe("greenpt")
	})

	it("should handle missing energy field", () => {
		const result = parseGreenPT({
			emissions: { total: 500_000, unit: "ugCO2e" },
		})

		expect(result.wh).toBeUndefined()
		expect(result.joules).toBeUndefined()
		expect(result.gCO2e).toBeCloseTo(0.5)
	})

	it("should handle missing emissions field", () => {
		const result = parseGreenPT({
			energy: { total: 7_200_000, unit: "Wms" },
		})

		expect(result.wh).toBeCloseTo(2.0)
		expect(result.gCO2e).toBeUndefined()
	})

	it("should ignore unsupported energy units", () => {
		const result = parseGreenPT({
			energy: { total: 100, unit: "kWh" },
		})

		expect(result.wh).toBeUndefined()
		expect(result.joules).toBeUndefined()
	})

	it("should ignore unsupported emissions units", () => {
		const result = parseGreenPT({
			emissions: { total: 100, unit: "gCO2" },
		})

		expect(result.gCO2e).toBeUndefined()
	})
})

describe("formatWh", () => {
	it("should format kilowatt-hours", () => {
		expect(formatWh(1500)).toBe("1.50 kWh")
		expect(formatWh(1000)).toBe("1.00 kWh")
	})

	it("should format watt-hours", () => {
		expect(formatWh(2.5)).toBe("2.50 Wh")
		expect(formatWh(1)).toBe("1.00 Wh")
		expect(formatWh(999.99)).toBe("999.99 Wh")
	})

	it("should format milliwatt-hours", () => {
		expect(formatWh(0.175)).toBe("175.0 mWh")
		expect(formatWh(0.001)).toBe("1.0 mWh")
	})

	it("should format microwatt-hours", () => {
		expect(formatWh(0.00005)).toBe("50.0 μWh")
		expect(formatWh(0.0000001)).toBe("0.1 μWh")
	})

	it("should handle zero", () => {
		expect(formatWh(0)).toBe("0 Wh")
	})

	it("should return em-dash for negative values", () => {
		expect(formatWh(-1)).toBe("\u2014")
	})

	it("should return em-dash for non-finite values", () => {
		expect(formatWh(NaN)).toBe("\u2014")
		expect(formatWh(Infinity)).toBe("\u2014")
		expect(formatWh(-Infinity)).toBe("\u2014")
	})
})
