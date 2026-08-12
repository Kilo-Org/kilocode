// kilocode_change - new file
//
// Unit tests for the HttpApi exerciser scenario retry. A single transient scenario
// flake must not fail the whole gate, while a genuine regression must fail every attempt.

import { describe, expect, test } from "bun:test"
import { Effect, Ref } from "effect"
import { attemptWithRetry } from "./httpapi-exercise/runner"
import type { ActiveScenario, Result } from "./httpapi-exercise/types"

const scenario = { kind: "active", name: "probe", method: "GET", path: "/x" } as unknown as ActiveScenario

// An attempt that fails its first `failures` runs, then passes. Re-running the same
// Effect increments the shared counter, mirroring how `attemptWithRetry` re-runs it.
const flaky = (counter: Ref.Ref<number>, failures: number) =>
  Ref.updateAndGet(counter, (n) => n + 1).pipe(
    Effect.map(
      (tries): Result =>
        tries <= failures ? { status: "fail", scenario, message: "boom" } : { status: "pass", scenario },
    ),
  )

describe("attemptWithRetry", () => {
  test("passes on the first try without tagging attempts", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        return yield* attemptWithRetry(flaky(counter, 0), 3, 1)
      }),
    )
    if (result.status === "skip") throw new Error("unexpected skip result")
    expect(result.status).toBe("pass")
    expect(result.attempts).toBeUndefined()
  })

  test("recovers from a transient failure and records the attempt count", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        return yield* attemptWithRetry(flaky(counter, 1), 3, 1)
      }),
    )
    if (result.status === "skip") throw new Error("unexpected skip result")
    expect(result.status).toBe("pass")
    expect(result.attempts).toBe(2)
  })

  test("fails after exhausting every attempt", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const counter = yield* Ref.make(0)
        return yield* attemptWithRetry(flaky(counter, 99), 3, 1)
      }),
    )
    if (result.status === "skip") throw new Error("unexpected skip result")
    expect(result.status).toBe("fail")
    expect(result.attempts).toBe(3)
  })
})
