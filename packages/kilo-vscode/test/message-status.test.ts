import { describe, expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import {
  formatTokenThroughput,
  terminalStep,
  turnMetadata,
  turnTiming,
  turnTokensPerSecond,
} from "../webview-ui/src/v2/message-status"
import { formatClock, formatDuration } from "../webview-ui/src/utils/message-time"

const user = (id: string, created: number) =>
  ({ id, type: "user", text: id, time: { created } }) as unknown as SessionMessageInfo

const idle = (id: string, created: number) =>
  ({ id, type: "idle", time: { created }, outcome: "succeeded" }) as unknown as SessionMessageInfo

const assistant = (input: {
  id?: string
  created: number
  streamed?: number
  completed?: number
  finish?: SessionMessageAssistant["finish"]
  output?: number
  reasoning?: number
  error?: boolean
  text?: string
}) =>
  ({
    id: input.id ?? "a",
    type: "assistant",
    content: input.text ? [{ type: "text", text: input.text }] : [],
    time: { created: input.created, streamed: input.streamed, completed: input.completed },
    finish: input.finish,
    tokens:
      input.output === undefined && input.reasoning === undefined
        ? undefined
        : { input: 0, output: input.output ?? 0, reasoning: input.reasoning ?? 0, cache: { read: 0, write: 0 } },
    error: input.error ? { type: "unknown", message: "failed" } : undefined,
  }) as unknown as SessionMessageAssistant

describe("terminalStep", () => {
  test("treats a real finish or an error as terminal", () => {
    expect(terminalStep(assistant({ created: 0, finish: "stop" }))).toBe(true)
    expect(terminalStep(assistant({ created: 0, finish: "length" }))).toBe(true)
    expect(terminalStep(assistant({ created: 0, finish: "tool-calls" }))).toBe(false)
    expect(terminalStep(assistant({ created: 0, finish: "unknown" }))).toBe(false)
    expect(terminalStep(assistant({ created: 0, error: true }))).toBe(true)
    expect(terminalStep(assistant({ created: 0 }))).toBe(false)
  })
})

describe("turnTiming", () => {
  test("measures duration from the user that starts the turn", () => {
    const a1 = assistant({ id: "a1", created: 1100, completed: 1300 })
    expect(turnTiming(a1, [user("u1", 1000), a1])).toEqual({ completedAt: 1300, durationMs: 300 })
  })

  test("a turn after an idle uses the newer user", () => {
    const a1 = assistant({ id: "a1", created: 200, completed: 300 })
    const a2 = assistant({ id: "a2", created: 500, completed: 600 })
    const messages = [user("u1", 100), a1, idle("i1", 350), user("u2", 400), a2]
    expect(turnTiming(a2, messages)).toEqual({ completedAt: 600, durationMs: 200 })
  })

  test("legacy messages with no idle use the nearest user", () => {
    const a1 = assistant({ id: "a1", created: 200, completed: 250 })
    const a2 = assistant({ id: "a2", created: 400, completed: 500 })
    const messages = [user("u1", 100), a1, user("u2", 300), a2]
    expect(turnTiming(a2, messages)).toEqual({ completedAt: 500, durationMs: 200 })
  })

  test("returns undefined until the step completes", () => {
    const a1 = assistant({ id: "a1", created: 100 })
    expect(turnTiming(a1, [user("u1", 50), a1])).toBeUndefined()
  })

  test("keeps the finish clock when no turn input is known", () => {
    const a1 = assistant({ id: "a1", created: 100, completed: 200 })
    expect(turnTiming(a1, [a1])).toEqual({ completedAt: 200 })
  })
})

describe("turnTokensPerSecond", () => {
  test("sums output plus reasoning and weights by streamed time", () => {
    const a1 = assistant({ id: "a1", created: 1100, streamed: 1300, completed: 1400, output: 100, reasoning: 50 })
    const a2 = assistant({ id: "a2", created: 1400, streamed: 1500, completed: 1600, output: 20 })
    expect(turnTokensPerSecond(a2, [user("u1", 1000), a1, a2])).toBeCloseTo(170 / 0.3, 5)
  })

  test("returns undefined when a step has no streamed time", () => {
    const a1 = assistant({ id: "a1", created: 100, completed: 200, output: 10 })
    expect(turnTokensPerSecond(a1, [user("u1", 50), a1])).toBeUndefined()
  })

  test("returns undefined without tokens", () => {
    const a1 = assistant({ id: "a1", created: 100, streamed: 200, completed: 300 })
    expect(turnTokensPerSecond(a1, [user("u1", 50), a1])).toBeUndefined()
  })

  test("returns undefined without a positive duration", () => {
    const a1 = assistant({ id: "a1", created: 100, streamed: 100, completed: 200, output: 10 })
    expect(turnTokensPerSecond(a1, [user("u1", 50), a1])).toBeUndefined()
  })

  test("returns undefined when the turn has no steps", () => {
    const orphan = assistant({ id: "orphan", created: 100, completed: 200, output: 10 })
    expect(turnTokensPerSecond(orphan, [user("u1", 50)])).toBeUndefined()
  })

  test("returns undefined when the turn input is outside the loaded page", () => {
    const a1 = assistant({ id: "a1", created: 100, streamed: 200, completed: 300, output: 10 })
    const a2 = assistant({ id: "a2", created: 400, streamed: 500, completed: 600, output: 10 })
    expect(turnTokensPerSecond(a2, [a1, a2])).toBeUndefined()
  })
})

describe("turnMetadata", () => {
  test("a terminal step with no text uses the earlier text step as the carrier", () => {
    const a1 = assistant({
      id: "a1",
      created: 1100,
      streamed: 1300,
      completed: 1400,
      output: 50,
      text: "first",
      finish: "tool-calls",
    })
    const a2 = assistant({ id: "a2", created: 1400, streamed: 1500, completed: 1600, output: 20, finish: "stop" })
    const metadata = turnMetadata(a2, [user("u1", 1000), a1, a2])
    expect(metadata?.carrierID).toBe("a1")
    expect(metadata?.timing).toEqual({ completedAt: 1600, durationMs: 600 })
    expect(metadata?.tokensPerSecond).toBeCloseTo(70 / 0.3, 5)
  })

  test("returns undefined when the turn input is outside the loaded page", () => {
    const a1 = assistant({ id: "a1", created: 100, streamed: 200, completed: 300, output: 10, text: "hi", finish: "stop" })
    expect(turnMetadata(a1, [a1])).toBeUndefined()
  })

  test("returns undefined while the terminal step is running", () => {
    const a1 = assistant({ id: "a1", created: 100, streamed: 200, output: 10, text: "hi", finish: "stop" })
    expect(turnMetadata(a1, [user("u1", 50), a1])).toBeUndefined()
  })

  test("returns undefined when no step has text", () => {
    const a1 = assistant({ id: "a1", created: 100, streamed: 200, completed: 300, output: 10, finish: "stop" })
    expect(turnMetadata(a1, [user("u1", 50), a1])).toBeUndefined()
  })
})

describe("formatting", () => {
  test("formats a token throughput value with one decimal", () => {
    // Kilo's internal "en" locale uses the en-US grouping conventions.
    expect(formatTokenThroughput(1166.2, "en")).toBe("1,166.2 t/s")
  })

  test("formats durations compactly", () => {
    expect(formatDuration(45_000)).toBe("45s")
    expect(formatDuration(125_000)).toBe("2m 5s")
    expect(formatDuration(3_780_000)).toBe("1h 3m")
  })

  test("converts Kilo locales to BCP-47 for Intl", () => {
    // "br" is Kilo's pt-BR, not the Breton language tag.
    expect(formatTokenThroughput(1166.2, "br")).toBe("1.166,2 t/s")
    // "zht" is not a valid tag and must resolve to zh-TW, not the system default.
    // zh-TW always prefixes a Chinese day period (the exact period depends on the host time zone).
    const clock = formatClock(0, "zht")
    expect(clock).toMatch(/[凌晨清晨上午中午下午晚上]/u)
    expect(clock).not.toContain("AM")
    expect(clock).not.toContain("PM")
  })
})
