import { describe, expect } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Scope } from "effect"
import { Runner } from "@/effect/runner"
import { KiloRunner } from "@/kilocode/effect/runner"
import { SessionDrain } from "@/kilocode/session/drain"
import { SessionID } from "@/session/schema"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"

const it = testEffect(SessionDrain.layer)

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

  it.instance(
    "keeps drain blocked during cancelled callers' shell cleanup and handoff",
    Effect.gen(function* () {
      const drain = yield* SessionDrain.Service
      const id = SessionID.make("ses_runner_shell_cleanup")
      const runner = Runner.make<string>(yield* Scope.Scope, { lease: drain.hold(id) })
      const entered = yield* Deferred.make<void>()
      const stopping = yield* Deferred.make<void>()
      const cleanup = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      yield* Effect.gen(function* () {
        const work = Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(stopping, undefined).pipe(Effect.andThen(Deferred.await(cleanup)))),
        )
        const shell = yield* drain.track(id, runner.startShell(work)).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        const run = Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(finish)), Effect.as("done"))
        const caller = yield* drain.track(id, runner.ensureRunning(run)).pipe(Effect.forkChild)
        yield* pollWithTimeout(
          Effect.sync(() => (runner.state._tag === "ShellThenRun" ? true : undefined)),
          "runner did not queue work",
        )
        yield* Fiber.interrupt(caller)
        const waiting = yield* drain.wait(id).pipe(Effect.forkChild({ startImmediately: true }))
        const stop = yield* Fiber.interrupt(shell).pipe(Effect.forkChild)
        yield* awaitWithTimeout(Deferred.await(stopping), "shell cleanup did not start")
        expect(runner.state._tag).toBe("ShellThenRun")
        expect(waiting.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(cleanup, undefined)
        yield* awaitWithTimeout(Fiber.join(stop), "shell cleanup did not finish")
        yield* awaitWithTimeout(Deferred.await(started), "queued work did not start")
        expect(runner.busy).toBe(true)
        expect(waiting.pollUnsafe()).toBeUndefined()
        yield* awaitWithTimeout(runner.cancel, "queued work inherited an uninterruptible shell finalizer")
        yield* awaitWithTimeout(Fiber.join(waiting), "shell handoff reservation was not released")
        expect(runner.busy).toBe(false)
      }).pipe(
        Effect.ensuring(Deferred.succeed(cleanup, undefined).pipe(Effect.andThen(Deferred.succeed(finish, undefined)))),
      )
    }),
  )

  it.instance(
    "releases provisional work when its caller is interrupted before commit",
    Effect.gen(function* () {
      const drain = yield* SessionDrain.Service
      const id = SessionID.make("ses_runner_provisional")
      const runner = Runner.make<string>(yield* Scope.Scope, {
        lease: drain
          .hold(id)
          .pipe(Effect.tap(() => Effect.withFiber((fiber) => Effect.sync(() => fiber.interruptUnsafe())))),
      })
      const started = yield* Deferred.make<void>()
      const work = Deferred.succeed(started, undefined).pipe(Effect.as("done"))
      const caller = yield* drain.track(id, runner.ensureRunning(work)).pipe(Effect.forkChild)

      const exit = yield* awaitWithTimeout(Fiber.await(caller), "provisional work rollback did not finish")
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(yield* Deferred.isDone(started)).toBe(false)
      expect(runner.busy).toBe(false)
      yield* awaitWithTimeout(drain.wait(id), "provisional work reservation was not released")
    }),
  )

  it.instance(
    "releases a closed-scope fiber before its first evaluation",
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      yield* Scope.close(scope, Exit.void)
      const drain = yield* SessionDrain.Service
      const id = SessionID.make("ses_runner_closed")
      const work = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const started = yield* KiloRunner.guard(
        () => false,
        (record) =>
          KiloRunner.start({
            scope,
            lease: drain.hold(id),
            record,
            work: Deferred.succeed(work, undefined),
            finish: () => Deferred.succeed(finish, undefined).pipe(Effect.asVoid),
            handle: (fiber) => fiber,
          }),
      )

      expect(Exit.hasInterrupts(yield* Fiber.await(started.run))).toBe(true)
      expect(yield* Deferred.isDone(work)).toBe(false)
      expect(yield* Deferred.isDone(finish)).toBe(false)
      yield* awaitWithTimeout(drain.wait(id), "closed-scope fiber reservation was not released")
    }),
  )

  it.live(
    "can interrupt callers waiting for the runner mutex",
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const unlock = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      yield* Effect.addFinalizer(() =>
        Deferred.succeed(unlock, undefined).pipe(Effect.andThen(Deferred.succeed(finish, undefined))),
      )
      const runner = Runner.make<string>(yield* Scope.Scope, {
        onBusy: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(unlock))),
      })
      const shell = yield* runner.startShell(Deferred.await(finish).pipe(Effect.as("shell"))).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      const started = yield* Deferred.make<void>()
      const work = Deferred.succeed(started, undefined).pipe(Effect.as("done"))
      const caller = yield* runner.ensureRunning(work).pipe(Effect.forkChild({ startImmediately: true }))

      yield* awaitWithTimeout(Fiber.interrupt(caller), "caller could not cancel its mutex wait")
      yield* Deferred.succeed(unlock, undefined)
      yield* Deferred.succeed(finish, undefined)
      expect(yield* Fiber.join(shell)).toBe("shell")
      expect(yield* Deferred.isDone(started)).toBe(false)
      expect(runner.busy).toBe(false)
    }),
  )
})
