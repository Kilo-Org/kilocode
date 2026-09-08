import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "../../src/v1/config/config"

const decode = Schema.decodeUnknownSync(ConfigV1.Info)
const encode = Schema.encodeSync(ConfigV1.Info)

describe("shared agent board configuration", () => {
  test("is absent by default", () => {
    const config = decode({})

    expect(config.experimental?.shared_agent_board).toBeUndefined()
    expect(encode(config).experimental?.shared_agent_board).toBeUndefined()
  })

  test.each([false, true])("parses and round-trips %s", (value) => {
    const config = decode({ experimental: { shared_agent_board: value } })

    expect(config.experimental?.shared_agent_board).toBe(value)
    expect(encode(config).experimental?.shared_agent_board).toBe(value)
  })
})
