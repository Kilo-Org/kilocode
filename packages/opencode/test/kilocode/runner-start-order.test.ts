import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Scope } from "effect"
import { Runner } from "@/effect/runner"
import { awaitWithTimeout, it, pollWithTimeout } from "../lib/effect"

describe("Runner start ordering", () => {
  it.live(
    "commits Running before work begins",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const runner = Runner.make<string>(scope)
      const started = yield* Deferred.make<Runner.State<string, never>["_tag"]>()
      const release = yield* Deferred.make<void>()
      const fiber = yield* runner
        .ensureRunning(
          Effect.gen(function* () {
            yield* Deferred.succeed(started, runner.state._tag)
            yield* Deferred.await(release)
            return "done"
          }),
        )
        .pipe(Effect.forkChild)

      expect(yield* Deferred.await(started)).toBe("Running")
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(fiber)).toBe("done")
    }),
  )

  it.live(
    "commits Running before queued work begins after a shell",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const runner = Runner.make<string>(scope)
      const shell = yield* Deferred.make<void>()
      const started = yield* Deferred.make<Runner.State<string, never>["_tag"]>()
      const release = yield* Deferred.make<void>()
      const shellFiber = yield* runner.startShell(Deferred.await(shell).pipe(Effect.as("shell"))).pipe(Effect.forkChild)
      yield* pollWithTimeout(
        Effect.sync(() => (runner.state._tag === "Shell" ? true : undefined)),
        "runner did not enter Shell",
      )
      const runFiber = yield* runner
        .ensureRunning(
          Effect.gen(function* () {
            yield* Deferred.succeed(started, runner.state._tag)
            yield* Deferred.await(release)
            return "done"
          }),
        )
        .pipe(Effect.forkChild)
      yield* pollWithTimeout(
        Effect.sync(() => (runner.state._tag === "ShellThenRun" ? true : undefined)),
        "runner did not queue work",
      )

      yield* Deferred.succeed(shell, undefined)
      yield* Fiber.join(shellFiber)
      expect(yield* awaitWithTimeout(Deferred.await(started), "queued work did not start")).toBe("Running")
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(runFiber)).toBe("done")
    }),
  )

  it.live(
    "opens committed work when its first caller is interrupted",
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const runner = Runner.make<string>(scope)
      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const fiber = yield* runner
        .ensureRunning(
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined)
            yield* Deferred.await(release)
            return "done"
          }),
        )
        .pipe(Effect.forkChild)

      yield* pollWithTimeout(
        Effect.sync(() => (runner.state._tag === "Running" ? true : undefined)),
        "runner did not commit Running",
      )
      yield* Fiber.interrupt(fiber)
      yield* awaitWithTimeout(Deferred.await(started), "committed work did not start")
      yield* Deferred.succeed(release, undefined)
      yield* pollWithTimeout(
        Effect.sync(() => (runner.state._tag === "Idle" ? true : undefined)),
        "runner did not return to Idle",
      )
    }),
  )
})
