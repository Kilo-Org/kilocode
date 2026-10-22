import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"

describe("workflow model overrides", () => {
  test("accepts a command entry containing only model and variant", () => {
    const value = Schema.decodeUnknownSync(ConfigV1.Info)({
      command: {
        review: {
          model: "anthropic/claude-sonnet-4-6",
          variant: "high",
        },
      },
    })

    expect(value.command?.review).toEqual({
      model: "anthropic/claude-sonnet-4-6",
      variant: "high",
    })
  })
})
