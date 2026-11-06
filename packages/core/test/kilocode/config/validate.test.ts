import { describe, expect, test } from "bun:test"
import { KiloConfigValidate } from "@opencode/core/kilocode/config/validate"

describe("KiloConfigValidate.unknownKeys", () => {
  test("accepts upstream and Kilo top-level keys", () => {
    expect(
      KiloConfigValidate.unknownKeys({ shell: "sh", permissions: [], privacy_mode: true, sandbox: {}, indexing: {} }),
    ).toEqual([])
  })

  test("lists unknown keys and v1-only names that the v2 schema does not define", () => {
    expect(KiloConfigValidate.unknownKeys({ bogus: 1, permission: {}, console: {}, shell: "sh" })).toEqual([
      "bogus",
      "permission",
      "console",
    ])
  })
})

describe("KiloConfigValidate.check", () => {
  test("accepts a valid edit", () => {
    expect(KiloConfigValidate.check(`{ "shell": "sh" }`, [{ path: ["privacy_mode"], value: true }])).toEqual([])
  })

  test("reports a malformed upstream value", () => {
    expect(KiloConfigValidate.check(`{}`, [{ path: ["shell"], value: 5 }])).toEqual([
      "$.shell: skipped malformed recognized value",
    ])
  })

  test("reports a malformed Kilo value, including a nested leaf", () => {
    expect(KiloConfigValidate.check(`{}`, [{ path: ["privacy_mode"], value: "yes" }])[0]).toStartWith(
      "$.privacy_mode: ignored invalid privacy_mode",
    )
    expect(KiloConfigValidate.check(`{}`, [{ path: ["sandbox", "network"], value: "maybe" }])).toHaveLength(1)
  })

  test("an unrelated value that is already invalid does not block a write", () => {
    expect(KiloConfigValidate.check(`{ "shell": 5 }`, [{ path: ["privacy_mode"], value: true }])).toEqual([])
  })

  test("replacing an invalid value with another invalid value is still reported", () => {
    expect(KiloConfigValidate.check(`{ "privacy_mode": "no" }`, [{ path: ["privacy_mode"], value: "yes" }])).toHaveLength(1)
  })

  test("a removal is never refused for the value it removes", () => {
    expect(
      KiloConfigValidate.check(`{ "sandbox": { "network": "maybe" } }`, [{ path: ["sandbox", "network"], value: undefined }]),
    ).toEqual([])
  })
})

describe("KiloConfigValidate.apply", () => {
  test("keeps comments and skips a removal of an absent path", () => {
    const text = `{\n  // keep\n  "shell": "sh"\n}\n`
    expect(
      KiloConfigValidate.apply(text, [
        { path: ["sandbox", "network"], value: undefined },
        { path: ["privacy_mode"], value: true },
      ]),
    ).toBe(`{\n  // keep\n  "shell": "sh",\n  "privacy_mode": true\n}\n`)
  })
})
