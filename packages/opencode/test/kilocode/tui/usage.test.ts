import { describe, expect, test } from "bun:test"
import {
  aggregateMetrics,
  formatRateValue,
  hasMetrics,
  throughputLabel,
} from "../../../src/kilocode/plugins/model-usage"

const step = (metrics: { prompt?: number; generation?: number }) => ({
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

  test("throughputLabel centralizes the PP/TG labels so a future i18n sweep is one file", () => {
    expect(throughputLabel.prompt).toBe("PP")
    expect(throughputLabel.generation).toBe("TG")
  })

  test("aggregates per-step generation weighted by generated tokens", () => {
    const aggregated = aggregateMetrics([
      { ...step({ generation: 20 }), generated: 100 },
      { ...step({ generation: 60 }), generated: 300 },
    ])
    expect(aggregated.generation).toBeCloseTo((20 * 100 + 60 * 300) / (100 + 300))
  })

  test("aggregates prompt and generation independently", () => {
    const aggregated = aggregateMetrics([
      { ...step({ prompt: 1000, generation: 20 }), generated: 100 },
      { ...step({ prompt: 500, generation: 60 }), generated: 300 },
    ])
    expect(aggregated.prompt).toBeCloseTo((1000 + 500) / 2)
    expect(aggregated.generation).toBeCloseTo((20 * 100 + 60 * 300) / 400)
  })

  test("includes prompt from a zero-generated step so it isn't silently dropped", () => {
    const aggregated = aggregateMetrics([
      { ...step({ prompt: 9999, generation: 9999 }), generated: 0 },
      { ...step({ generation: 25 }), generated: 50 },
    ])
    expect(aggregated.prompt).toBe(9999)
    expect(aggregated.generation).toBe(25)
  })

  test("skips samples without metrics", () => {
    const aggregated = aggregateMetrics([
      { metrics: undefined, generated: 100 },
      { ...step({ generation: 40 }), generated: 50 },
    ])
    expect(aggregated.generation).toBe(40)
  })

  test("skips zero-weight samples for the generation average", () => {
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

  test("ignores bogus per-call values without poisoning the aggregate", () => {
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
    expect(hasMetrics({ prompt: 12 })).toBeTrue()
  })
})