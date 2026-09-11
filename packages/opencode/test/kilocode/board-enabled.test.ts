import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { BoardEnabled } from "../../src/kilocode/board/enabled"
import { it } from "../lib/effect"

const fromEnv = (input: Record<string, unknown>) =>
  AppNodeBuilder.build(RuntimeFlags.node).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input))))

const resolve = (config: boolean | undefined, input: Record<string, unknown>) =>
  Effect.gen(function* () {
    const flags = yield* RuntimeFlags.Service
    return BoardEnabled.resolve({ config, flag: flags.experimentalSharedAgentBoard })
  }).pipe(Effect.provide(fromEnv(input)))

describe("shared agent board enablement", () => {
  it.effect("enables when the config key is true", () =>
    Effect.gen(function* () {
      expect(yield* resolve(true, {})).toBe(true)
    }),
  )

  it.effect("stays disabled when config is false and the env flag is unset", () =>
    Effect.gen(function* () {
      expect(yield* resolve(false, {})).toBe(false)
      expect(yield* resolve(undefined, {})).toBe(false)
    }),
  )

  it.effect("enables when the specific env flag is true", () =>
    Effect.gen(function* () {
      expect(yield* resolve(undefined, { KILO_EXPERIMENTAL_SHARED_AGENT_BOARD: "true" })).toBe(true)
    }),
  )

  it.effect("stays disabled when the specific env flag is false", () =>
    Effect.gen(function* () {
      expect(yield* resolve(undefined, { KILO_EXPERIMENTAL_SHARED_AGENT_BOARD: "false" })).toBe(false)
    }),
  )

  it.effect("enables when the KILO_EXPERIMENTAL umbrella is true", () =>
    Effect.gen(function* () {
      expect(yield* resolve(undefined, { KILO_EXPERIMENTAL: "true" })).toBe(true)
    }),
  )

  it.effect("lets the specific flag override the umbrella", () =>
    Effect.gen(function* () {
      expect(
        yield* resolve(undefined, {
          KILO_EXPERIMENTAL: "true",
          KILO_EXPERIMENTAL_SHARED_AGENT_BOARD: "false",
        }),
      ).toBe(false)
    }),
  )

  it.effect("keeps the env path enabled when config is explicitly false", () =>
    Effect.gen(function* () {
      expect(yield* resolve(false, { KILO_EXPERIMENTAL_SHARED_AGENT_BOARD: "true" })).toBe(true)
    }),
  )
})
