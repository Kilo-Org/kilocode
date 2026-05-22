// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { KiloSessionProcessor } from "../../src/kilocode/session/processor"
import type { MessageV2 } from "../../src/session/message-v2"

const REVIEW_COMMANDS = ["review", "local-review", "local-review-uncommitted"] as const

const expected = (command: (typeof REVIEW_COMMANDS)[number]) => ({
  mode: "review" as const,
  feature: "code_reviews" as const,
  command,
})

describe("KiloSessionProcessor.reviewTelemetry", () => {
  for (const command of REVIEW_COMMANDS) {
    test(`returns telemetry for ${command}`, () => {
      expect(KiloSessionProcessor.reviewTelemetry(command)).toEqual(expected(command))
    })
  }

  test("returns undefined for an unrelated command", () => {
    expect(KiloSessionProcessor.reviewTelemetry("init")).toBeUndefined()
  })

  test("returns undefined for an undefined command", () => {
    expect(KiloSessionProcessor.reviewTelemetry(undefined)).toBeUndefined()
  })
})

describe("KiloSessionProcessor.markReviewTelemetry", () => {
  for (const command of REVIEW_COMMANDS) {
    test(`stamps text parts with telemetry for ${command}`, () => {
      const parts: Array<{ type: string; metadata?: Record<string, unknown> }> = [
        { type: "text", metadata: { existing: "keep" } },
        { type: "file" },
        { type: "text" },
      ]
      const tel = KiloSessionProcessor.markReviewTelemetry(parts, command)
      expect(tel).toEqual(expected(command))
      expect(parts[0].metadata).toEqual({ existing: "keep", ...expected(command) })
      expect(parts[1].metadata).toBeUndefined()
      expect(parts[2].metadata).toEqual({ ...expected(command) })
    })
  }

  test("does nothing for an unrelated command", () => {
    const parts: Array<{ type: string; metadata?: Record<string, unknown> }> = [{ type: "text" }]
    expect(KiloSessionProcessor.markReviewTelemetry(parts, "init")).toBeUndefined()
    expect(parts[0].metadata).toBeUndefined()
  })

  test("does nothing for an undefined command", () => {
    const parts: Array<{ type: string; metadata?: Record<string, unknown> }> = [{ type: "text" }]
    expect(KiloSessionProcessor.markReviewTelemetry(parts, undefined)).toBeUndefined()
    expect(parts[0].metadata).toBeUndefined()
  })
})

describe("KiloSessionProcessor.extractReviewTelemetry", () => {
  for (const command of REVIEW_COMMANDS) {
    test(`recovers ${command} telemetry from marked text parts`, () => {
      const parts: Array<{ type: string; metadata?: Record<string, unknown> }> = [{ type: "text" }]
      KiloSessionProcessor.markReviewTelemetry(parts, command)
      const round = KiloSessionProcessor.extractReviewTelemetry(parts as unknown as MessageV2.Part[])
      expect(round).toEqual(expected(command))
    })
  }

  test("returns undefined when parts have no review metadata", () => {
    const parts: Array<{ type: string; metadata?: Record<string, unknown> }> = [
      { type: "text" },
      { type: "text", metadata: { foo: "bar" } },
    ]
    expect(KiloSessionProcessor.extractReviewTelemetry(parts as unknown as MessageV2.Part[])).toBeUndefined()
  })

  test("returns undefined when command in metadata is unknown", () => {
    const parts: Array<{ type: string; metadata?: Record<string, unknown> }> = [
      { type: "text", metadata: { mode: "review", feature: "code_reviews", command: "unknown" } },
    ]
    expect(KiloSessionProcessor.extractReviewTelemetry(parts as unknown as MessageV2.Part[])).toBeUndefined()
  })
})
