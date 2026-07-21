import { describe, expect, test } from "bun:test"
import {
  aggregateMetrics,
  formatPP,
  formatTG,
  hasMetrics,
} from "../../../src/kilocode/plugins/model-usage"

describe("kilocode.plugins.model-usage throughput helpers", () => {
  test("formats positive PP/TG values with grouping", () => {
    expect(formatPP(412)).toBe("412 t/s")
    expect(formatPP(412.5)).toBe("412.5 t/s")
    expect(formatPP(12345)).toBe("12,345 t/s")
    expect(formatTG(28.7)).toBe("28.7 t/s")
  })

  test("falls back to dash for missing or bogus values", () => {
    expect(formatPP(undefined)).toBe("-")
    expect(formatPP(0)).toBe("-")
    expect(formatPP(-5)).toBe("-")
    expect(formatPP(Number.NaN)).toBe("-")
    expect(formatTG(undefined)).toBe("-")
    expect(formatTG(0)).toBe("-")
    expect(formatTG(Infinity)).toBe("-")
  })

  test("aggregates per-step metrics weighted by generated tokens", () => {
    const aggregated = aggregateMetrics([
      { metrics: { generation: 20, source: "computed" }, generated: 100 },
      { metrics: { generation: 60, source: "computed" }, generated: 300 },
    ])
    expect(aggregated.generation).toBeCloseTo((20 * 100 + 60 * 300) / (100 + 300))
  })

  test("aggregates prompt and generation independently", () => {
    const aggregated = aggregateMetrics([
      { metrics: { prompt: 1000, generation: 20, source: "provider" }, generated: 100 },
      { metrics: { prompt: 500, generation: 60, source: "provider" }, generated: 300 },
    ])
    expect(aggregated.prompt).toBeCloseTo((1000 * 100 + 500 * 300) / 400)
    expect(aggregated.generation).toBeCloseTo((20 * 100 + 60 * 300) / 400)
  })

  test("skips samples without metrics", () => {
    const aggregated = aggregateMetrics([
      { metrics: undefined, generated: 100 },
      { metrics: { generation: 40, source: "computed" }, generated: 50 },
    ])
    expect(aggregated.generation).toBe(40)
  })

  test("skips samples with zero weight so prompt/generation stay valid", () => {
    const aggregated = aggregateMetrics([
      { metrics: { prompt: 9999, generation: 9999, source: "provider" }, generated: 0 },
      { metrics: { generation: 25, source: "computed" }, generated: 50 },
    ])
    expect(aggregated.prompt).toBeUndefined()
    expect(aggregated.generation).toBe(25)
  })

  test("returns empty aggregate when nothing has metrics", () => {
    expect(aggregateMetrics([])).toEqual({})
    expect(aggregateMetrics([{ metrics: undefined, generated: 100 }])).toEqual({})
  })

  test("ignores bogus per-call values without poisoning the aggregate", () => {
    const aggregated = aggregateMetrics([
      { metrics: { generation: -1, source: "computed" }, generated: 100 },
      { metrics: { generation: Number.POSITIVE_INFINITY, source: "computed" }, generated: 100 },
      { metrics: { generation: 30, source: "computed" }, generated: 50 },
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