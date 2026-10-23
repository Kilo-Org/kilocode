import { expect, test } from "bun:test"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { familyUsage, formatCacheRate, formatSpeed, formatWindow, windowLabel } from "../../src/kilocode/usage-data"

const session = (id: string, tokens: { input: number; output: number; reasoning: number; read: number; write: number }) =>
  ({
    id,
    projectID: "proj",
    location: { directory: "/" },
    cost: 0,
    tokens: { ...tokens, cache: { read: tokens.read, write: tokens.write } },
    time: { created: 0, updated: 0 },
  }) as SessionInfo

const step = (id: string, output: number, reasoning: number, created: number, completed?: number) =>
  ({
    type: "assistant",
    id,
    agent: "build",
    model: { providerID: "kilo", id: "kilo-auto/free" },
    content: [],
    tokens: { input: 1, output, reasoning, cache: { read: 0, write: 0 } },
    time: { created, completed },
  }) as SessionMessageInfo

// v1 kilocode/tui/usage.test.ts: the speed is weighted by generation time across steps, and bogus values show "-".
test("sums family tokens and weights the generation speed by step time", () => {
  const result = familyUsage(
    [session("root", { input: 100, output: 50, reasoning: 10, read: 300, write: 100 }), session("child", { input: 20, output: 5, reasoning: 0, read: 0, write: 0 })],
    [
      step("a", 90, 10, 0, 1_000),
      step("b", 300, 0, 5_000, 8_000),
      // Not finished, no generated tokens, or no elapsed time: ignored.
      step("c", 50, 0, 9_000),
      step("d", 0, 0, 10_000, 11_000),
      step("e", 10, 0, 12_000, 12_000),
      { type: "user", id: "u", text: "hi", time: { created: 0 } } as SessionMessageInfo,
    ],
  )
  expect(result.tokens).toEqual({ input: 120, output: 55, reasoning: 10, read: 300, write: 100 })
  expect(result.generation).toBe(100)
  expect(formatSpeed(result.generation)).toBe("100 t/s")
  expect(formatSpeed(12_345.67)).toBe("12,345.7 t/s")
  for (const value of [undefined, 0, -5, Number.NaN, Infinity]) expect(formatSpeed(value)).toBe("-")
  expect(familyUsage([], []).generation).toBeUndefined()
  expect(formatCacheRate(result.tokens)).toBe("57.7%")
  expect(formatCacheRate({ input: 0, read: 0, write: 0 })).toBe("-")
})

test("labels quota windows as v1 does", () => {
  const base = { id: "w", unit: "percent", state: "active" as const }
  expect(windowLabel({ ...base, resource: "subscription", orientation: "remaining_percent", period: { unit: "hour", value: 5 } })).toBe(
    "5-hour quota",
  )
  expect(windowLabel({ ...base, resource: "general", orientation: "amount", period: { unit: "week", value: 1 } })).toBe(
    "Shared · Weekly quota",
  )
  expect(windowLabel({ ...base, resource: "Codex", orientation: "used_percent" })).toBe("Codex · Quota")
  expect(formatWindow({ ...base, resource: "x", orientation: "remaining_percent", remaining: 75 })).toBe("75% remaining")
  expect(formatWindow({ ...base, resource: "x", orientation: "used_percent", used: 42 })).toBe("42% used")
  expect(formatWindow({ ...base, resource: "x", unit: "count", orientation: "count", remaining: 30, limit: 100 })).toBe(
    "30 of 100 remaining",
  )
  expect(formatWindow({ ...base, resource: "x", unit: "USD", orientation: "amount", used: 2, limit: 10 })).toBe(
    "$2.00 of $10.00 used",
  )
  expect(formatWindow({ ...base, resource: "x", orientation: "amount", state: "not_in_plan" })).toBe("Not in plan")
  expect(formatWindow({ ...base, resource: "x", orientation: "amount", state: "exhausted" })).toBe("Exhausted")
})
