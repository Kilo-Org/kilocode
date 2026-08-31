import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { KiloSessionProcessor } from "@/kilocode/session/processor"
import { SessionNetwork } from "@/session/network"
import { SessionRetry } from "@/session/retry"
import { MessageV2 } from "@/session/message-v2"
import { ProviderV2 } from "@opencode-ai/core/provider"

// Wide margins: Windows timer granularity (~15ms) makes tight sleeps drift.
const fast = { stallMs: 200, tickMs: 20 }

function error(exit: Exit.Exit<unknown, unknown>) {
  if (!Exit.isFailure(exit)) return undefined
  return Cause.squash(exit.cause)
}

describe("kilocode.session.offlineGuard", () => {
  test("fails a stalled attempt when the connectivity probe fails", async () => {
    const guard = KiloSessionProcessor.offlineGuard({ ...fast, check: () => Promise.resolve(false) })
    const exit = await Effect.runPromiseExit(guard.watch)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(error(exit)).toBeInstanceOf(KiloSessionProcessor.DisconnectedError)
  })

  test("keeps waiting while connectivity is healthy", async () => {
    let asked = 0
    const guard = KiloSessionProcessor.offlineGuard({
      ...fast,
      check: () => {
        asked++
        return Promise.resolve(true)
      },
    })
    const exit = await Effect.runPromiseExit(guard.watch.pipe(Effect.raceFirst(Effect.sleep("700 millis"))))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(asked).toBeGreaterThan(0)
  })

  test("stream activity defers the probe", async () => {
    let asked = 0
    const guard = KiloSessionProcessor.offlineGuard({
      ...fast,
      check: () => {
        asked++
        return Promise.resolve(true)
      },
    })
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        for (let i = 0; i < 12; i++) {
          yield* Effect.sleep("30 millis")
          guard.touch()
        }
      }).pipe(Effect.raceFirst(guard.watch)),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(asked).toBe(0)
  })

  test("stream activity during a failing probe keeps the attempt alive", async () => {
    let asked = 0
    const guard = KiloSessionProcessor.offlineGuard({
      ...fast,
      check: () => {
        asked++
        return new Promise((resolve) => setTimeout(() => resolve(false), 120))
      },
    })
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* Effect.forkChild(
          Effect.gen(function* () {
            yield* Effect.sleep("250 millis") // lands inside the probe window (~200-340)
            guard.touch()
          }),
        )
        yield* Effect.sleep("380 millis") // outlives the probe so the post-probe check runs
      }).pipe(Effect.raceFirst(guard.watch)),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(asked).toBe(1)
  })

  test("active tool calls hold the guard back", async () => {
    let asked = 0
    const guard = KiloSessionProcessor.offlineGuard({
      ...fast,
      busy: () => true,
      check: () => {
        asked++
        return Promise.resolve(false)
      },
    })
    const exit = await Effect.runPromiseExit(guard.watch.pipe(Effect.raceFirst(Effect.sleep("700 millis"))))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(asked).toBe(0)
  })

  test("pending tool input does not hold the guard back", async () => {
    let asked = 0
    const guard = KiloSessionProcessor.offlineGuard({
      ...fast,
      busy: () => KiloSessionProcessor.executingTools({ "call-1": {} }),
      check: () => {
        asked++
        return Promise.resolve(false)
      },
    })
    const exit = await Effect.runPromiseExit(guard.watch.pipe(Effect.raceFirst(Effect.sleep("700 millis"))))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(error(exit)).toBeInstanceOf(KiloSessionProcessor.DisconnectedError)
    expect(asked).toBeGreaterThanOrEqual(1)
  })

  test("executing tool calls hold the guard back", async () => {
    let asked = 0
    const guard = KiloSessionProcessor.offlineGuard({
      ...fast,
      busy: () => KiloSessionProcessor.executingTools({ "call-1": { executing: true } }),
      check: () => {
        asked++
        return Promise.resolve(false)
      },
    })
    const exit = await Effect.runPromiseExit(guard.watch.pipe(Effect.raceFirst(Effect.sleep("700 millis"))))
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(asked).toBe(0)
  })

  test("the synthetic failure routes to the offline retry branch", () => {
    const err = new KiloSessionProcessor.DisconnectedError()
    expect(SessionNetwork.disconnected(err)).toBe(true)
    expect(SessionNetwork.message(err)).toBe("Network connection failed")

    const parsed = MessageV2.fromError(err, { providerID: ProviderV2.ID.make("test") })
    expect(MessageV2.APIError.isInstance(parsed)).toBe(true)
    if (MessageV2.APIError.isInstance(parsed)) expect(parsed.data.isRetryable).toBe(true)
    expect(SessionRetry.retryable(parsed, "test")).toBeDefined()
  })
})

describe("kilocode.session.probeProvider", () => {
  test("a reachable endpoint passes without consulting the fallback", async () => {
    let asked = 0
    const live = Bun.serve({ port: 0, fetch: () => new Response("ok") })
    try {
      expect(
        await SessionNetwork.probeProvider(`http://localhost:${live.port}`, () => {
          asked++
          return Promise.resolve(false)
        }),
      ).toBe(true)
    } finally {
      live.stop(true)
    }
    expect(asked).toBe(0)
  })

  test("a dead endpoint falls back to the public probe", async () => {
    const dead = Bun.serve({ port: 0, fetch: () => new Response("ok") })
    const deadURL = `http://localhost:${dead.port}`
    dead.stop(true)
    expect(await SessionNetwork.probeProvider(deadURL, () => Promise.resolve(false))).toBe(false)
    expect(await SessionNetwork.probeProvider(deadURL, () => Promise.resolve(true))).toBe(true)
    expect(await SessionNetwork.probeProvider(undefined, () => Promise.resolve(true))).toBe(true)
  })

  test("a busy endpoint that never answers HTTP still passes", async () => {
    const busy = Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) })
    try {
      expect(await SessionNetwork.probeProvider(`http://localhost:${busy.port}`, () => Promise.resolve(false))).toBe(true)
    } finally {
      busy.stop(true)
    }
  })
})
