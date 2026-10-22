// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { Config } from "../../../src/config/config"
import { Schema } from "effect"

describe("Config.Info experimental.openTelemetry default", () => {
  test("defaults to true when experimental is set without openTelemetry", () => {
    const parsed = Schema.decodeUnknownSync(Config.Info)({ experimental: {} })
    expect(parsed.experimental?.openTelemetry).toBe(true)
  })

  test("defaults to true when openTelemetry is explicitly undefined", () => {
    const parsed = Schema.decodeUnknownSync(Config.Info)({ experimental: { openTelemetry: undefined } })
    expect(parsed.experimental?.openTelemetry).toBe(true)
  })

  test("respects explicit false", () => {
    const parsed = Schema.decodeUnknownSync(Config.Info)({ experimental: { openTelemetry: false } })
    expect(parsed.experimental?.openTelemetry).toBe(false)
  })

  test("respects explicit true", () => {
    const parsed = Schema.decodeUnknownSync(Config.Info)({ experimental: { openTelemetry: true } })
    expect(parsed.experimental?.openTelemetry).toBe(true)
  })

  test("experimental stays undefined when not set at all", () => {
    const parsed = Schema.decodeUnknownSync(Config.Info)({})
    expect(parsed.experimental).toBeUndefined()
  })
})
