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

const weightedStep = (overrides: {
  generation: number
  output: number
  reasoning?: number
  elapsedMs: number
}) => ({
  metrics: { generation: overrides.generation, source: "computed" as const },
  generated: overrides.output + (overrides.reasoning ?? 0),
  elapsedMs: overrides.elapsedMs,
  output: overrides.output,
  reasoning: overrides.reasoning ?? 0,
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

  test("surfaces the most recent non-empty generation rate as the snapshot (fallback)", () => {
    // Fallback path — used when callers don't pass timing on the wire.
    // The weighted path is exercised by the dedicated tests below.
    const aggregated = aggregateMetrics([
      { ...step({ generation: 20 }), generated: 100 },
      { ...step({ generation: 60 }), generated: 300 },
    ])
    expect(aggregated.generation).toBe(60)
  })

  test("skips samples without metrics", () => {
    const aggregated = aggregateMetrics([
      { metrics: undefined, generated: 100, elapsedMs: 1000 },
      weightedStep({ generation: 40, output: 50, elapsedMs: 1000 }),
    ])
    // weighted step contributes (50, 1000) → 50 t/s.
    expect(aggregated.generation).toBe(50)
  })

  test("weights samples by elapsed time across steps", () => {
    const aggregated = aggregateMetrics([
      weightedStep({ generation: 100, output: 100, elapsedMs: 1000 }),
      weightedStep({ generation: 50, output: 200, elapsedMs: 4000 }),
    ])
    // totalGenerated=300, totalElapsedMs=5000 → 60 t/s
    expect(aggregated.generation).toBe(60)
  })

  test("includes reasoning tokens in the weighted numerator", () => {
    const aggregated = aggregateMetrics([
      weightedStep({ generation: 200, output: 50, reasoning: 150, elapsedMs: 1000 }),
    ])
    // (50 + 150) tokens / 1000 ms = 200 t/s
    expect(aggregated.generation).toBe(200)
  })

  test("falls back to last-wins snapshot when no sample carries timing", () => {
    const aggregated = aggregateMetrics([
      { ...step({ generation: 20 }), generated: 100 },
      { ...step({ generation: 60 }), generated: 300 },
    ])
    expect(aggregated.generation).toBe(60)
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