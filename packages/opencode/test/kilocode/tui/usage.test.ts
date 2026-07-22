import { describe, expect, test } from "bun:test"
import {
  aggregateMetrics,
  formatRateValue,
  hasMetrics,
  throughputLabel,
} from "../../../src/kilocode/plugins/model-usage"

const step = (metrics: { generation?: number }) => ({
  metrics: { source: "computed" as const, ...metrics },
  generated: 0,
})

describe("kilocode.plugins.model-usage throughput helpers", () => {
  test("formatRateValue renders positive values with grouping", () => {
    expect(formatRateValue(412)).toBe("412 t/s")
    expect(formatRateValue(412.5)).toBe("412.5 t/s")
    expect(formatRateValue(12345)).toBe("12,345 t/s")
    expect(formatRateValue(28.7)).toBe("28.7 t/s")
  })

  test("formatRateValue falls back to dash for missing or bogus values", () => {
    expect(formatRateValue(undefined)).toBe("-")
    expect(formatRateValue(0)).toBe("-")
    expect(formatRateValue(-5)).toBe("-")
    expect(formatRateValue(Number.NaN)).toBe("-")
    expect(formatRateValue(Infinity)).toBe("-")
  })

  test("throughputLabel centralizes the generation-speed label so a future i18n sweep is one file", () => {
    expect(throughputLabel.generation).toBe("Generation speed")
  })

  test("surfaces the most recent non-empty generation rate as the snapshot", () => {
    const aggregated = aggregateMetrics([
      { ...step({ generation: 20 }), generated: 100 },
      { ...step({ generation: 60 }), generated: 300 },
    ])
    expect(aggregated.generation).toBe(60)
  })

  test("skips samples without metrics", () => {
    const aggregated = aggregateMetrics([
      { metrics: undefined, generated: 100 },
      { ...step({ generation: 40 }), generated: 50 },
    ])
    expect(aggregated.generation).toBe(40)
  })

  test("skips zero-weight samples when picking the latest snapshot", () => {
    const aggregated = aggregateMetrics([
      { ...step({ generation: 9999 }), generated: 0 },
      { ...step({ generation: 25 }), generated: 50 },
    ])
    expect(aggregated.generation).toBe(25)
  })

  test("returns empty aggregate when nothing has metrics", () => {
    expect(aggregateMetrics([])).toEqual({})
    expect(aggregateMetrics([{ metrics: undefined, generated: 100 }])).toEqual({})
  })

  test("ignores bogus per-call values without poisoning the snapshot", () => {
    const aggregated = aggregateMetrics([
      { ...step({ generation: -1 }), generated: 100 },
      { ...step({ generation: Number.POSITIVE_INFINITY }), generated: 100 },
      { ...step({ generation: 30 }), generated: 50 },
    ])
    expect(aggregated.generation).toBe(30)
  })

  test("hasMetrics gates opportunistic rendering", () => {
    expect(hasMetrics(undefined)).toBeFalse()
    expect(hasMetrics({})).toBeFalse()
    expect(hasMetrics({ generation: 12 })).toBeTrue()
  })
})