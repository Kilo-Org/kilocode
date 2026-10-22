import { expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"
import { Effect, Option, Schema } from "effect"
import { it } from "../../lib/effect"

test("the exact top-level hide_prompt_training_models setting accepts only booleans", () => {
  const decode = Schema.decodeUnknownOption(KiloConfigPolicy.Info)
  expect(Option.isSome(decode({ hide_prompt_training_models: true }))).toBe(true)
  expect(Option.isSome(decode({ hide_prompt_training_models: false }))).toBe(true)
  expect(Option.isSome(decode({}))).toBe(true)
  expect(Option.isNone(decode({ hide_prompt_training_models: "true" }))).toBe(true)
  expect(ConfigNormalize.normalize({ hide_prompt_training_models: true }).diagnostics).toEqual([])
})

test.each(["true", null, 0])("invalid Kilo flag %p preserves canonical settings and managed policies", (value) => {
  const input = {
    hide_prompt_training_models: value,
    shell: "valid",
    policies: [{ effect: "deny", action: "tool.use", resource: "shell:*" }],
  } as const
  const normalized = ConfigNormalize.normalize(input)
  if (normalized.type !== "normalized") throw new Error("expected canonical normalization")
  const parsed = KiloConfigPolicy.parse(input, normalized.encoded)
  expect(parsed?.shell).toBe("valid")
  expect(parsed?.policies).toEqual(input.policies)
  expect(parsed?.hide_prompt_training_models).toBeUndefined()
})

it.effect("reads fresh effective entries without filesystem, global paths or plugin storage services", () =>
  Effect.gen(function* () {
    const config = yield* Config.Test
    const document = (hide?: boolean) =>
      new Document({
        type: "document",
        info: new KiloConfigPolicy.Info({ hide_prompt_training_models: hide }),
      })
    expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: false })
    yield* config.setEntries([document(false), document(true), document()])
    expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: true })
    yield* config.setEntries([document(true), document(false)])
    expect(yield* KiloConfigPolicy.get(config)).toEqual({ hide_prompt_training_models: false })
  }).pipe(Effect.provide(Config.testLayer())),
)
