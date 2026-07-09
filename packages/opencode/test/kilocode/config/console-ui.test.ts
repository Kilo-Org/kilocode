import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Config } from "@/config/config"

describe("Config.Info console UI", () => {
  test("accepts console UI preferences", () => {
    const config = Schema.decodeUnknownSync(Config.Info)({
      console: { context_sidebar_width: 420, diff_style: "split" },
    })

    expect(config.console?.context_sidebar_width).toBe(420)
    expect(config.console?.diff_style).toBe("split")
  })

  test("rejects invalid console UI preferences", () => {
    expect(() => Schema.decodeUnknownSync(Config.Info)({ console: { context_sidebar_width: 249 } })).toThrow()
    expect(() => Schema.decodeUnknownSync(Config.Info)({ console: { context_sidebar_width: 801 } })).toThrow()
    expect(() => Schema.decodeUnknownSync(Config.Info)({ console: { context_sidebar_width: 420.5 } })).toThrow()
    expect(() => Schema.decodeUnknownSync(Config.Info)({ console: { context_sidebar_width: Number.NaN } })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(Config.Info)({ console: { context_sidebar_width: Number.POSITIVE_INFINITY } }),
    ).toThrow()
    expect(() => Schema.decodeUnknownSync(Config.Info)({ console: { diff_style: "side-by-side" } })).toThrow()
  })
})
