import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "../../src/v1/config/config"

const decode = Schema.decodeUnknownSync(ConfigV1.Info)
const encode = Schema.encodeSync(ConfigV1.Info)

describe("require_approval_for_config_edits configuration", () => {
  test("is absent by default so writable configs stay unwritten", () => {
    const config = decode({})

    expect(config.require_approval_for_config_edits).toBeUndefined()
    expect(encode(config).require_approval_for_config_edits).toBeUndefined()
  })

  test.each([false, true])("parses and round-trips %s", (value) => {
    const config = decode({ require_approval_for_config_edits: value })

    expect(config.require_approval_for_config_edits).toBe(value)
    expect(encode(config).require_approval_for_config_edits).toBe(value)
  })

  test("rejects non-boolean values", () => {
    expect(() => decode({ require_approval_for_config_edits: "no" })).toThrow()
    expect(() => decode({ require_approval_for_config_edits: 1 })).toThrow()
  })
})
