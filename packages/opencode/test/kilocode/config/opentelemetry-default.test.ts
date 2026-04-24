// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { Config } from "../../../src/config"

describe("Config.Info experimental.openTelemetry default", () => {
  test("defaults to true when experimental is set without openTelemetry", () => {
    const parsed = Config.Info.parse({ experimental: {} })
    expect(parsed.experimental?.openTelemetry).toBe(true)
  })

  test("defaults to true when openTelemetry is explicitly undefined", () => {
    const parsed = Config.Info.parse({ experimental: { openTelemetry: undefined } })
    expect(parsed.experimental?.openTelemetry).toBe(true)
  })

  test("respects explicit false", () => {
    const parsed = Config.Info.parse({ experimental: { openTelemetry: false } })
    expect(parsed.experimental?.openTelemetry).toBe(false)
  })

  test("respects explicit true", () => {
    const parsed = Config.Info.parse({ experimental: { openTelemetry: true } })
    expect(parsed.experimental?.openTelemetry).toBe(true)
  })

  test("experimental stays undefined when not set at all", () => {
    const parsed = Config.Info.parse({})
    expect(parsed.experimental).toBeUndefined()
  })
})
