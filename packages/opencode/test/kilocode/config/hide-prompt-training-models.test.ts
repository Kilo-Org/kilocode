import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "../../../src/config/config"

describe("hide_prompt_training_models config", () => {
  test("accepts boolean values", () => {
    expect(
      Schema.decodeUnknownSync(Config.Info)({ hide_prompt_training_models: true }).hide_prompt_training_models,
    ).toBe(true)
    expect(
      Schema.decodeUnknownSync(Config.Info)({ hide_prompt_training_models: false }).hide_prompt_training_models,
    ).toBe(false)
  })

  test("is optional", () => {
    expect(Schema.decodeUnknownSync(Config.Info)({}).hide_prompt_training_models).toBeUndefined()
  })

  test("rejects non-boolean values", () => {
    expect(() => Schema.decodeUnknownSync(Config.Info)({ hide_prompt_training_models: "true" })).toThrow()
  })
})
