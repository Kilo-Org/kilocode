// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { SecurityContinuation } from "@/kilocode/security-decision/continuation"
import { SecurityBlocked } from "@/kilocode/security-decision/block"

// A security block stops the *call*, not the turn: the model keeps its turn and may pick another
// allowed path. Repeating the identical blocked call is not another path, so it ends the turn.

describe("SecurityContinuation.after", () => {
  const blocked = () => SecurityBlocked.of("SEC.V1.GIT_HOOK_WRITE", {} as never)

  test("continues the turn after a security block", () => {
    const seen = SecurityContinuation.state()
    expect(
      SecurityContinuation.after(seen, blocked(), { tool: "edit", input: { filePath: ".git/hooks/pre-commit" } }),
    ).toBe("continue")
  })

  test("continues when the next blocked call differs", () => {
    const seen = SecurityContinuation.state()
    SecurityContinuation.after(seen, blocked(), { tool: "edit", input: { filePath: ".git/hooks/pre-commit" } })
    expect(SecurityContinuation.after(seen, blocked(), { tool: "edit", input: { filePath: "src/a.ts" } })).toBe(
      "continue",
    )
  })

  test("stops the turn when the identical blocked call is repeated", () => {
    const seen = SecurityContinuation.state()
    const call = { tool: "edit", input: { filePath: ".git/hooks/pre-commit", content: "x" } }
    expect(SecurityContinuation.after(seen, blocked(), call)).toBe("continue")
    expect(
      SecurityContinuation.after(seen, blocked(), {
        tool: "edit",
        input: { content: "x", filePath: ".git/hooks/pre-commit" },
      }),
    ).toBe("stop")
  })

  test("leaves a non-security failure to the existing rule", () => {
    const seen = SecurityContinuation.state()
    expect(SecurityContinuation.after(seen, new Error("boom"), { tool: "edit", input: {} })).toBeUndefined()
  })
})

/**
 * A block tells the model one path is closed, and the turn goes on so it can take another. That is
 * only true while it is *taking another path*: a run of blocks with nothing successful between them
 * is the model working around the policy rather than adapting to it, and at some point the turn has
 * to end rather than let it keep enumerating.
 *
 * The counter is over security blocks — deterministic policy refusals — and not over the reviewer's
 * `keep_ask`. Our reviewer can only narrow an ask to an allow; declining to narrow one is the
 * default answer to a question, not a refusal to count against the model.
 */
describe("SecurityContinuation circuit breaker", () => {
  const blocked = () => SecurityBlocked.of("SEC.V1.GIT_HOOK_WRITE", {} as never)
  const attempt = (seen: SecurityContinuation.State, index: number) =>
    SecurityContinuation.after(seen, blocked(), { tool: "edit", input: { filePath: `blocked-${index}.txt` } })

  test("interrupts the turn after enough consecutive blocks", () => {
    const seen = SecurityContinuation.state()
    expect(attempt(seen, 1)).toBe("continue")
    expect(attempt(seen, 2)).toBe("continue")
    expect(attempt(seen, 3)).toBe("interrupt")
  })

  test("a successful action resets the consecutive count", () => {
    const seen = SecurityContinuation.state()
    expect(attempt(seen, 1)).toBe("continue")
    expect(attempt(seen, 2)).toBe("continue")
    SecurityContinuation.succeeded(seen)
    expect(attempt(seen, 3)).toBe("continue")
    expect(attempt(seen, 4)).toBe("continue")
    expect(attempt(seen, 5)).toBe("interrupt")
  })

  test("interrupts on enough blocks inside the recent window even when none are consecutive", () => {
    const seen = SecurityContinuation.state()
    const outcomes: Array<string | undefined> = []
    for (let index = 1; index <= 5; index++) {
      outcomes.push(attempt(seen, index))
      SecurityContinuation.succeeded(seen)
    }
    // Never two in a row, so the consecutive rule never fires; the density rule does.
    expect(outcomes.slice(0, 4)).toEqual(["continue", "continue", "continue", "continue"])
    expect(outcomes[4]).toBe("interrupt")
  })

  test("blocks that have scrolled out of the window no longer count", () => {
    const seen = SecurityContinuation.state({ consecutive: 99, window: 6, recent: 3 })
    expect(attempt(seen, 1)).toBe("continue")
    expect(attempt(seen, 2)).toBe("continue")
    // Six successes push both blocks past the end of a six-entry window.
    for (let index = 0; index < 6; index++) SecurityContinuation.succeeded(seen)
    expect(attempt(seen, 3)).toBe("continue")
    expect(attempt(seen, 4)).toBe("continue")
    expect(attempt(seen, 5)).toBe("interrupt")
  })

  test("the interrupt stays latched for subsequent blocked calls", () => {
    const seen = SecurityContinuation.state()
    attempt(seen, 1)
    attempt(seen, 2)
    expect(attempt(seen, 3)).toBe("interrupt")
    expect(attempt(seen, 4)).toBe("interrupt")
    SecurityContinuation.succeeded(seen)
    expect(attempt(seen, 5)).toBe("interrupt")
  })

  test("thresholds are configurable", () => {
    const seen = SecurityContinuation.state({ consecutive: 2 })
    expect(attempt(seen, 1)).toBe("continue")
    expect(attempt(seen, 2)).toBe("interrupt")
  })

  test("a repeated signature still stops before the breaker is consulted", () => {
    const seen = SecurityContinuation.state()
    const call = { tool: "edit", input: { filePath: "same.txt" } }
    expect(SecurityContinuation.after(seen, blocked(), call)).toBe("continue")
    expect(SecurityContinuation.after(seen, blocked(), call)).toBe("stop")
  })
})

describe("SecurityContinuation.blocked", () => {
  const blocked = () => SecurityBlocked.of("SEC.V1.GIT_HOOK_WRITE", {} as never)

  test("reports whether this exact call was already blocked in the turn", () => {
    const seen = SecurityContinuation.state()
    const call = { tool: "bash", input: { command: "cp x .git/hooks/pre-commit" } }
    expect(SecurityContinuation.blocked(seen, call.tool, call.input)).toBe(false)
    SecurityContinuation.after(seen, blocked(), call)
    expect(SecurityContinuation.blocked(seen, call.tool, call.input)).toBe(true)
  })

  test("argument order does not make a repeat look like a new call", () => {
    const seen = SecurityContinuation.state()
    SecurityContinuation.after(seen, blocked(), { tool: "edit", input: { filePath: "a", content: "b" } })
    expect(SecurityContinuation.blocked(seen, "edit", { content: "b", filePath: "a" })).toBe(true)
  })

  test("a different call is not reported as blocked", () => {
    const seen = SecurityContinuation.state()
    SecurityContinuation.after(seen, blocked(), { tool: "edit", input: { filePath: "a" } })
    expect(SecurityContinuation.blocked(seen, "edit", { filePath: "b" })).toBe(false)
  })
})
