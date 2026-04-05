import { describe, it, expect } from "bun:test"
import { buildTelemetryPayload, buildTelemetryAuthHeader } from "../../src/services/telemetry/telemetry-proxy-utils"

describe("buildTelemetryPayload", () => {
  it("includes event name in payload", () => {
    const result = buildTelemetryPayload("test.event", {}, undefined)
    expect(result.event).toBe("test.event")
  })

  it("merges provider properties with event properties", () => {
    const result = buildTelemetryPayload("test.event", { eventProp: "value" }, { providerProp: "providerValue" })
    expect(result.properties.eventProp).toBe("value")
    expect(result.properties.providerProp).toBe("providerValue")
  })

  it("event properties override provider properties", () => {
    const result = buildTelemetryPayload("test.event", { shared: "from-event" }, { shared: "from-provider" })
    expect(result.properties.shared).toBe("from-event")
  })

  it("handles undefined event properties", () => {
    const result = buildTelemetryPayload("test.event", undefined, { providerProp: "x" })
    expect(result.properties.providerProp).toBe("x")
  })

  it("handles undefined provider properties", () => {
    const result = buildTelemetryPayload("test.event", { key: "val" }, undefined)
    expect(result.properties.key).toBe("val")
  })

  it("handles both undefined", () => {
    const result = buildTelemetryPayload("test.event", undefined, undefined)
    expect(result.properties).toEqual({})
  })
})

describe("buildTelemetryAuthHeader", () => {
  it("returns a Basic auth header string", () => {
    const result = buildTelemetryAuthHeader("mypassword")
    expect(result.startsWith("Basic ")).toBe(true)
  })

  it("encodes kilo:password in base64", () => {
    const result = buildTelemetryAuthHeader("secret")
    const encoded = Buffer.from("kilo:secret").toString("base64")
    expect(result).toBe(`Basic ${encoded}`)
  })

  it("handles empty password", () => {
    const result = buildTelemetryAuthHeader("")
    const encoded = Buffer.from("kilo:").toString("base64")
    expect(result).toBe(`Basic ${encoded}`)
  })
})
