import { expect, test } from "bun:test"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"
import * as SpawnValidation from "@opencode-ai/core/kilocode/spawn-validation"

test("spawn validation is command-scoped and consumed once", () => {
  const first = ChildProcess.make("first")
  const second = ChildProcess.make("second")
  const effect = Effect.void

  expect(SpawnValidation.attach(first, effect)).toBe(first)
  expect(SpawnValidation.take(second)).toBeUndefined()
  expect(SpawnValidation.take(first)).toBe(effect)
  expect(SpawnValidation.take(first)).toBeUndefined()
})
