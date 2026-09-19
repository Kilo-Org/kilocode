// kilocode_change - new file

import { expect, test } from "bun:test"
import { Cause, Data, Effect, Exit } from "effect"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { KiloSnapshotLock } from "../../src/kilocode/snapshot/lock"

class SomeError extends Data.TaggedError("SomeError")<{ command: string }> {}

const expectDefect = (exit: Exit.Exit<unknown, unknown>) => {
  if (!Exit.isFailure(exit)) throw new Error(`expected a failure, got ${exit._tag}`)
  expect(Cause.hasDies(exit.cause)).toBe(true)
  expect(Cause.hasFails(exit.cause)).toBe(false)
}

test("dieOnLockError turns a lock timeout into a defect", async () => {
  const exit = await Effect.runPromiseExit(
    KiloSnapshotLock.dieOnLockError(Effect.fail(new EffectFlock.LockTimeoutError({ key: "snapshot:/tmp/repo/.git" }))),
  )
  expectDefect(exit)
})

test("dieOnLockError turns a compromised lock into a defect", async () => {
  const exit = await Effect.runPromiseExit(
    KiloSnapshotLock.dieOnLockError(Effect.fail(new EffectFlock.LockCompromisedError({ detail: "token mismatch" }))),
  )
  expectDefect(exit)
})

test("dieOnLockError leaves the body's own errors in the error channel", async () => {
  const exit = await Effect.runPromiseExit(
    KiloSnapshotLock.dieOnLockError(Effect.fail(new SomeError({ command: "read-tree" }))),
  )
  if (!Exit.isFailure(exit)) throw new Error(`expected a failure, got ${exit._tag}`)
  expect(Cause.hasFails(exit.cause)).toBe(true)
  expect(Cause.hasDies(exit.cause)).toBe(false)
  expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "SomeError", command: "read-tree" })
})

test("dieOnLockError passes a success through untouched", async () => {
  expect(await Effect.runPromise(KiloSnapshotLock.dieOnLockError(Effect.succeed("ok")))).toBe("ok")
})
