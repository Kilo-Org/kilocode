import { describe, expect, test } from "bun:test"
import { KiloAutoPreview } from "@kilocode/gateway-core"
import type { RpcCallContext } from "@opencode/plugin/effect/rpc"
import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { GatewayAutoPreview } from "../src/gateway/auto-preview.js"

type PreviewContext = RpcCallContext<(typeof KiloGatewayRpc.Definition.methods)["autoModel.preview"]>

const context = {
  error: (code: string, message: string) => ({ code, message }),
} as unknown as PreviewContext

describe("GatewayAutoPreview caching & coalescing", () => {
  test("serves repeated identical prompts from cache even when invoked a dozen times", async () => {
    let calls = 0
    const { "autoModel.preview": preview } = GatewayAutoPreview.handlers({
      models: Effect.succeed([]),
      compute: (input) =>
        Effect.sync(() => {
          calls++
          return KiloAutoPreview.preview(input)
        }),
    })

    const results = await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 12 }, (_, idx) => (idx % 2 === 0 ? "Refactor auth helper" : "  Refactor auth helper \n")),
        (prompt) => preview({ prompt, agent: "code", profile: "efficient" }, context),
      ),
    )

    expect(calls).toBe(1)
    expect(results).toHaveLength(12)
    expect(results.every((item) => item === results[0])).toBe(true)
  })

  test("keys cache entries by prompt, agent, profile, and explicit model", async () => {
    let calls = 0
    const { "autoModel.preview": preview } = GatewayAutoPreview.handlers({
      models: Effect.succeed([]),
      compute: (input) =>
        Effect.sync(() => {
          calls++
          return KiloAutoPreview.preview(input)
        }),
    })

    await Effect.runPromise(preview({ prompt: "Refactor auth helper", agent: "code", profile: "efficient" }, context))
    await Effect.runPromise(preview({ prompt: "Refactor auth helper", agent: "code", profile: "frontier" }, context))
    await Effect.runPromise(preview({ prompt: "Refactor auth helper", agent: "ask", profile: "efficient" }, context))
    await Effect.runPromise(
      preview(
        {
          prompt: "Refactor auth helper",
          agent: "code",
          currentModel: { providerID: "kilo", id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
        },
        context,
      ),
    )
    // Repeating any of the above hits the cache.
    await Effect.runPromise(preview({ prompt: "Refactor auth helper", agent: "code", profile: "frontier" }, context))
    await Effect.runPromise(preview({ prompt: "Refactor auth helper", agent: "ask", profile: "efficient" }, context))

    expect(calls).toBe(4)
  })

  test("expires cached entries after TTL", async () => {
    let now = 1_000
    let calls = 0
    const { "autoModel.preview": preview } = GatewayAutoPreview.handlers({
      models: Effect.succeed([]),
      ttlMs: 5_000,
      now: () => now,
      compute: (input) =>
        Effect.sync(() => {
          calls++
          return KiloAutoPreview.preview(input)
        }),
    })

    await Effect.runPromise(preview({ prompt: "Fix login crash" }, context))
    now += 4_999
    await Effect.runPromise(preview({ prompt: "Fix login crash" }, context))
    expect(calls).toBe(1)

    now += 1
    await Effect.runPromise(preview({ prompt: "Fix login crash" }, context))
    expect(calls).toBe(2)
  })

  test("evicts least-recently-used entries when maxEntries is exceeded", async () => {
    let calls = 0
    const { "autoModel.preview": preview } = GatewayAutoPreview.handlers({
      models: Effect.succeed([]),
      maxEntries: 2,
      compute: (input) =>
        Effect.sync(() => {
          calls++
          return KiloAutoPreview.preview(input)
        }),
    })

    await Effect.runPromise(preview({ prompt: "Prompt A" }, context))
    await Effect.runPromise(preview({ prompt: "Prompt B" }, context))
    // Touch Prompt A so Prompt B becomes least recently used.
    await Effect.runPromise(preview({ prompt: "Prompt A" }, context))
    expect(calls).toBe(2)

    // Inserting Prompt C evicts Prompt B, keeping Prompt A cached.
    await Effect.runPromise(preview({ prompt: "Prompt C" }, context))
    expect(calls).toBe(3)

    await Effect.runPromise(preview({ prompt: "Prompt A" }, context))
    expect(calls).toBe(3)

    await Effect.runPromise(preview({ prompt: "Prompt B" }, context))
    expect(calls).toBe(4)
  })

  test("clears cached entries when the Gateway account/catalog scope changes", async () => {
    let scope = "1:https://api.kilo.ai::auth"
    let calls = 0
    const { "autoModel.preview": preview } = GatewayAutoPreview.handlers({
      models: Effect.succeed([]),
      scope: () => scope,
      compute: (input) =>
        Effect.sync(() => {
          calls++
          return KiloAutoPreview.preview(input)
        }),
    })

    await Effect.runPromise(preview({ prompt: "Refactor auth helper" }, context))
    await Effect.runPromise(preview({ prompt: "Refactor auth helper" }, context))
    expect(calls).toBe(1)

    scope = "2:https://api.kilo.ai:org-1:auth"
    await Effect.runPromise(preview({ prompt: "Refactor auth helper" }, context))
    expect(calls).toBe(2)
  })

  test("does not cache failed computations so retries recover cleanly", async () => {
    let calls = 0
    const { "autoModel.preview": preview } = GatewayAutoPreview.handlers({
      models: Effect.succeed([]),
      compute: (input) =>
        Effect.suspend(() => {
          calls++
          if (calls === 1) return Effect.fail(new Error("Upstream timeout"))
          return Effect.succeed(KiloAutoPreview.preview(input))
        }),
    })

    const first = await Effect.runPromiseExit(preview({ prompt: "Debug flaky test" }, context))
    expect(Exit.isFailure(first)).toBe(true)

    const second = await Effect.runPromise(preview({ prompt: "Debug flaky test" }, context))
    expect(second.task.category).toBe("Debugging & bug fix")

    const third = await Effect.runPromise(preview({ prompt: "Debug flaky test" }, context))
    expect(third).toBe(second)
    expect(calls).toBe(2)
  })

  test("coalesces concurrent identical requests into a single in-flight computation", async () => {
    let calls = 0
    const gate = Deferred.makeUnsafe<void>()
    const started = Deferred.makeUnsafe<void>()
    const { "autoModel.preview": preview } = GatewayAutoPreview.handlers({
      models: Effect.succeed([]),
      compute: (input) =>
        Effect.gen(function* () {
          calls++
          yield* Deferred.succeed(started, undefined)
          yield* Deferred.await(gate)
          return KiloAutoPreview.preview(input)
        }),
    })

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Effect.forkChild(preview({ prompt: "Explain this architecture" }, context))
        yield* Deferred.await(started)
        const followers = yield* Effect.forEach(
          [1, 2, 3, 4],
          () => Effect.forkChild(preview({ prompt: "Explain this architecture" }, context)),
        )
        yield* Effect.yieldNow
        yield* Deferred.succeed(gate, undefined)
        const head = yield* Fiber.join(first)
        const tail = yield* Effect.forEach(followers, Fiber.join)
        return [head, ...tail]
      }),
    )

    expect(calls).toBe(1)
    expect(results).toHaveLength(5)
    expect(results.every((item) => item === results[0])).toBe(true)
  })
})
