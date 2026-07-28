import { expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { isInterrupted, shouldReportPromptFailure } from "../../src/kilocode/effect/cause"

test("recognizes a pure interruption", () => {
  const exit = Effect.runSync(Effect.exit(Effect.interrupt))
  if (Exit.isSuccess(exit)) throw new Error("expected interruption")
  expect(isInterrupted(exit.cause)).toBe(true)
  expect(shouldReportPromptFailure(exit.cause)).toBe(false)
  expect(isInterrupted(Cause.die(new Error("failure")))).toBe(false)
  expect(shouldReportPromptFailure(Cause.die(new Error("failure")))).toBe(true)
  expect(shouldReportPromptFailure(Cause.combine(exit.cause, Cause.die(new Error("failure"))))).toBe(true)
})
