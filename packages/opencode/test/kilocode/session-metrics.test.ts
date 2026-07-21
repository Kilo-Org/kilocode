// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { computeMetrics, formatRate } from "@/kilocode/session/metrics"

const tokens = {
  input: 100,
  output: 50,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

describe("kilocode.session.metrics.computeMetrics", () => {
  test("preserves llama.cpp provider-reported timings", () => {
    const metrics = computeMetrics({
      providerMetadata: {
        llama: { prompt_per_second: 412.3, predicted_per_second: 28.7 },
      },
      tokens,
      elapsedMs: 1000,
    })
    expect(metrics?.source).toBe("provider")
    expect(metrics?.prompt).toBeCloseTo(412.3)
    expect(metrics?.generation).toBeCloseTo(28.7)
  })

  test("derives generation rate when no provider timing is present", () => {
    const metrics = computeMetrics({
      providerMetadata: { openai: { finish_reason: "stop" } },
      tokens: { ...tokens, output: 100 },
      elapsedMs: 1000,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(100)
    expect(metrics?.prompt).toBeUndefined()
  })

  test("returns undefined when there are no generation tokens", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 0, reasoning: 0 },
      elapsedMs: 2000,
    })
    expect(metrics).toBeUndefined()
  })

  test("guards against zero elapsed time", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 50 },
      elapsedMs: 0,
    })
    expect(metrics).toBeUndefined()
  })

  test("falls back to computed when provider rates are bogus", () => {
    const metrics = computeMetrics({
      providerMetadata: {
        llama: { prompt_per_second: -5, predicted_per_second: Number.POSITIVE_INFINITY },
      },
      tokens,
      elapsedMs: 1000,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(50)
  })

  test("tolerates missing providerMetadata", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 200 },
      elapsedMs: 4000,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(50)
  })
})

describe("kilocode.session.metrics.formatRate", () => {
  test.each([
    [0, "0 t/s"],
    [12, "12 t/s"],
    [412.5, "412.5 t/s"],
    [12345, "12,345 t/s"],
  ] as const)("formats %f as %s", (input, expected) => {
    expect(formatRate(input)).toBe(expected)
  })

  test("returns zero string for negative inputs", () => {
    expect(formatRate(-5)).toBe("0 t/s")
  })
})
