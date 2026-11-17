import { describe, expect, test } from "bun:test"
import { KiloConfigValidate } from "@opencode/core/kilocode/config/validate"

describe("KiloConfigValidate.unknownKeys", () => {
  test("accepts upstream and Kilo top-level keys", () => {
    expect(
      KiloConfigValidate.unknownKeys({ shell: "sh", permissions: [], privacy_mode: true, sandbox: {}, indexing: {} }),
    ).toEqual([])
  })

  test("lists unknown keys, reader-migrated legacy names and the derived workflow_models", () => {
    expect(
      KiloConfigValidate.unknownKeys({ bogus: 1, permission: {}, autoupdate: true, console: {}, workflow_models: {}, shell: "sh" }),
    ).toEqual(["bogus", "permission", "autoupdate", "console", "workflow_models"])
  })

  test("allows a null (removal) for any key", () => {
    expect(KiloConfigValidate.unknownKeys({ bogus: null, autoupdate: null })).toEqual([])
  })
})

describe("KiloConfigValidate.check", () => {
  test("accepts a valid edit", () => {
    expect(KiloConfigValidate.check(`{ "shell": "sh" }`, [{ path: ["privacy_mode"], value: true }])).toEqual([])
  })

  test("accepts experimental.openTelemetry, which upstream normalization refuses as a legacy setting", () => {
    expect(KiloConfigValidate.check(`{}`, [{ path: ["experimental", "openTelemetry"], value: false }])).toEqual([])
    expect(KiloConfigValidate.check(`{}`, [{ path: ["experimental", "openTelemetry"], value: "no" }])).toEqual([
      "$.experimental.openTelemetry: ignored invalid experimental.openTelemetry; expected a boolean (true or false)",
    ])
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

  test("reports an invalid display layout, which the reader drops", () => {
    expect(KiloConfigValidate.check(`{}`, [{ path: ["terminal_command_display"], value: "sideways" }])).toEqual([
      '$.terminal_command_display: ignored invalid terminal_command_display; expected "expanded" or "collapsed"',
    ])
  })

  test("a conflict where the native value wins does not block the write", () => {
    expect(
      KiloConfigValidate.check(`{ "autoupdate": true, "update": "notify" }`, [{ path: ["update"], value: "disable" }]),
    ).toEqual([])
  })

  test("a pre-existing root rejection does not fail a write with no set", () => {
    expect(KiloConfigValidate.check(`// only a comment\n`, [])).toEqual([])
  })

  test("throws when the document cannot take the edit", () => {
    expect(() => KiloConfigValidate.check(`[]`, [{ path: ["shell"], value: "sh" }])).toThrow()
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
