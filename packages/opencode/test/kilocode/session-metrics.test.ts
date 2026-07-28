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
  test("derives generation rate from elapsed time", () => {
    const metrics = computeMetrics({
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

  test("ignores providerMetadata until the upstream wiring lands (see #6579)", () => {
    // llama.cpp surfaces prompt_per_second / predicted_per_second, but the
    // upstream AI SDK drops them before the raw usage reaches our adapter.
    // Until a metadataExtractor is wired into createOpenAICompatible, the
    // provider source is unreachable — exercise the tolerance here.
    const metrics = computeMetrics({
      providerMetadata: {
        llama: { prompt_per_second: 412.3, predicted_per_second: 28.7 },
      },
      tokens: { ...tokens, output: 100 },
      elapsedMs: 2000,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(50)
    expect(metrics?.prompt).toBeUndefined()
  })

  test("tolerates missing providerMetadata", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 200 },
      elapsedMs: 4000,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(50)
    expect(metrics?.prompt).toBeUndefined()
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