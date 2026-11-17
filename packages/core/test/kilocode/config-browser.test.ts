import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "../../src/v1/config/config"

const decode = Schema.decodeUnknownSync(ConfigV1.Info)
const encode = Schema.encodeSync(ConfigV1.Info)

describe("browser configuration", () => {
  test("is absent by default", () => {
    const config = decode({})

    expect(config.browser).toBeUndefined()
    expect(config.experimental?.browser_extension).toBeUndefined()
  })

  test("reads every browser field and round-trips it", () => {
    const config = decode({
      browser: { backend: "extension", observation: "diff", allowSensitive: true, target: "work" },
      experimental: { browser_extension: true },
    })

    expect(config.browser).toEqual({
      backend: "extension",
      observation: "diff",
      allowSensitive: true,
      target: "work",
    })
    expect(config.experimental?.browser_extension).toBe(true)
    expect(encode(config).browser).toEqual(config.browser)
  })

  test("accepts an explicit null target", () => {
    expect(decode({ browser: { target: null } }).browser?.target).toBeNull()
  })

  test("rejects an unknown backend", () => {
    expect(() => decode({ browser: { backend: "puppeteer" } })).toThrow()
  })

  test("rejects an unknown observation mode", () => {
    expect(() => decode({ browser: { observation: "summary" } })).toThrow()
  })
})
