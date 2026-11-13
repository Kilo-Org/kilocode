import { describe, expect, it } from "bun:test"
import { buildTelemetryPayload } from "../src/services/telemetry/telemetry-proxy-utils"
import { TelemetryEventName } from "../src/services/telemetry/types"

describe("buildTelemetryPayload", () => {
  it("includes event name in payload", () => {
    const result = buildTelemetryPayload("test.event", {}, undefined)
    expect(result?.event).toBe("test.event")
  })

  it("merges provider properties with event properties", () => {
    const result = buildTelemetryPayload("test.event", { eventProp: "value" }, { providerProp: "providerValue" })
    expect(result?.properties.eventProp).toBe("value")
    expect(result?.properties.providerProp).toBe("providerValue")
  })

  it("event properties override provider properties", () => {
    const result = buildTelemetryPayload("test.event", { shared: "from-event" }, { shared: "from-provider" })
    expect(result?.properties.shared).toBe("from-event")
  })

  it("handles undefined event properties", () => {
    const result = buildTelemetryPayload("test.event", undefined, { providerProp: "x" })
    expect(result?.properties.providerProp).toBe("x")
  })

  it("handles undefined provider properties", () => {
    const result = buildTelemetryPayload("test.event", { key: "val" }, undefined)
    expect(result?.properties.key).toBe("val")
  })

  it("handles both undefined", () => {
    const result = buildTelemetryPayload("test.event", undefined, undefined)
    expect(result?.properties).toEqual({})
  })

  it("keeps one in ten autocomplete failures and tags the sample rate", () => {
    const event = TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_FAILED
    expect(buildTelemetryPayload(event, { error: "x" }, undefined, () => 0.1)).toBeNull()
    expect(buildTelemetryPayload(event, { error: "x" }, undefined, () => 0.09)).toEqual({
      event,
      properties: { error: "x", autocomplete_failure_sample_rate: 0.1 },
    })
  })

  it("does not sample other events", () => {
    const result = buildTelemetryPayload(TelemetryEventName.AUTOCOMPLETE_ACCEPT_SUGGESTION, {}, undefined, () => 0.99)
    expect(result?.properties).toEqual({})
  })
})
