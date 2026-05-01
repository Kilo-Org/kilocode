import { describe, expect, test } from "bun:test"
import { KiloSessionMetrics } from "../../src/kilocode/session/metrics"

describe("KiloSessionMetrics", () => {
  test("computes output tokens per second from elapsed milliseconds", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 2_000,
      tokens: { input: 100, output: 50 },
    })

    expect(metrics).toEqual({
      duration: 2_000,
      rate: { output: 25 },
    })
  })

  test("includes reasoning tokens in computed output rate", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 1_000,
      tokens: { input: 100, output: 50, reasoning: 10 },
    })

    expect(metrics?.rate.output).toBe(60)
  })

  test("extracts provider prompt and generation rates from llama timings", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 3_000,
      tokens: { input: 100, output: 90 },
      metadata: {
        llama: {
          timings: {
            prompt_per_second: 412.49,
            predicted_per_second: 38.15,
          },
        },
      },
    })

    expect(metrics).toEqual({
      duration: 3_000,
      rate: { output: 30, prompt: 412.49, generation: 38.15 },
    })
  })

  test("extracts provider rates from top-level timing fields", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 1_000,
      tokens: { input: 100, output: 10 },
      metadata: {
        prompt_per_second: 201.2,
        predicted_per_second: 44.8,
      },
    })

    expect(metrics?.rate.prompt).toBe(201.2)
    expect(metrics?.rate.generation).toBe(44.8)
  })

  test("returns undefined without positive duration or provider rates", () => {
    const metrics = KiloSessionMetrics.create({
      elapsed: 0,
      tokens: { input: 100, output: 10 },
    })

    expect(metrics).toBeUndefined()
  })
})
