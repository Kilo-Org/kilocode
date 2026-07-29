import { describe, expect } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { it } from "../../lib/effect"

const fromConfig = (input: Record<string, unknown>) =>
  RuntimeFlags.defaultLayer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(input))))

const readFlags = RuntimeFlags.Service.useSync((flags) => flags)

describe("Kilo runtime flags", () => {
  it.effect("disableClaudeCodeCommands defaults to false", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({})))

      expect(flags.disableClaudeCodeCommands).toBe(false)
    }),
  )

  it.effect("disableClaudeCodeCommands reads KILO_DISABLE_CLAUDE_CODE_COMMANDS", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_DISABLE_CLAUDE_CODE_COMMANDS: "true" })))

      expect(flags.disableClaudeCodeCommands).toBe(true)
    }),
  )

  it.effect("disableClaudeCodeCommands inherits KILO_DISABLE_CLAUDE_CODE", () =>
    Effect.gen(function* () {
      const flags = yield* readFlags.pipe(Effect.provide(fromConfig({ KILO_DISABLE_CLAUDE_CODE: "true" })))

      expect(flags.disableClaudeCodeCommands).toBe(true)
    }),
  )
})
