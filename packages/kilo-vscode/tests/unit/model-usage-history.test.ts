import { describe, expect, it } from "bun:test"
import { recordModelUsage, validateModelUsage } from "../../src/kilo-provider/model-usage"

describe("model usage history", () => {
  it("increments a model and updates its last-used timestamp", () => {
    expect(recordModelUsage({ "openai/gpt": { count: 2, lastUsed: 10 } }, "openai", "gpt", 20)).toEqual({
      "openai/gpt": { count: 3, lastUsed: 20 },
    })
  })

  it("drops malformed entries and caps persisted history", () => {
    const raw = Object.fromEntries(
      Array.from({ length: 205 }, (_, index) => [`provider/model-${index}`, { count: 1, lastUsed: index }]),
    )
    const result = validateModelUsage({ ...raw, invalid: { count: 0, lastUsed: 1 } })
    expect(Object.keys(result)).toHaveLength(200)
    expect(result["provider/model-204"]).toEqual({ count: 1, lastUsed: 204 })
    expect(result.invalid).toBeUndefined()
  })
})
