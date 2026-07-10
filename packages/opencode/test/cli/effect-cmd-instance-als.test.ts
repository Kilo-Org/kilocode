import { afterEach, expect } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect } from "effect"
import { effectCmd } from "../../src/cli/effect-cmd"
import { EffectBridge } from "../../src/effect/bridge"
import { InstanceRef } from "../../src/effect/instance-ref"
import { Instance } from "../../src/kilocode/instance"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(FSUtil.defaultLayer)

afterEach(async () => {
  await disposeAllInstances()
})

it.instance(
  "EffectBridge preserves legacy instance context across Promise awaits",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const directory = yield* EffectBridge.fromPromise(async () => {
        await Promise.resolve()
        return Instance.directory
      })
      const bridge = yield* EffectBridge.make()
      const bound = bridge.bind(async () => {
        await Promise.resolve()
        return Instance.directory
      })

      expect(directory).toBe(test.directory)
      expect(yield* Effect.promise(bound)).toBe(test.directory)
    }),
  { git: true },
)

it.instance(
  "effectCmd preserves Effect and legacy instance contexts across Promise awaits",
  () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      let reference: string | undefined
      let legacy: string | undefined
      const command = effectCmd({
        command: "context-test",
        describe: false,
        directory: () => test.directory,
        handler: () =>
          Effect.gen(function* () {
            reference = (yield* InstanceRef)?.directory
            legacy = yield* Effect.promise(async () => {
              await Promise.resolve()
              return Instance.directory
            })
          }),
      })
      const handler = command.handler
      if (!handler) return yield* Effect.die(new Error("effect command handler not provided"))

      yield* Effect.promise(() => Promise.resolve(handler({} as never)))

      expect(reference).toBe(test.directory)
      expect(legacy).toBe(test.directory)
    }),
  { git: true },
)
