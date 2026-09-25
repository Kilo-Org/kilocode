import { afterEach, describe, it, expect, spyOn } from "bun:test"
import { buildTelemetryPayload, buildTelemetryAuthHeader } from "../../src/services/telemetry/telemetry-proxy-utils"
import { TelemetryProxy } from "../../src/services/telemetry/telemetry-proxy"
import { TelemetryEventName } from "../../src/services/telemetry/types"

describe("buildTelemetryPayload", () => {
  afterEach(() => {
    random?.mockRestore()
  })

  let random: ReturnType<typeof spyOn<typeof Math, "random">> | undefined

  it("drops autocomplete failures outside the retained sample", () => {
    random = spyOn(Math, "random").mockReturnValue(0.1)
    expect(buildTelemetryPayload("Autocomplete LLM Request Failed", { error: "timeout" }, undefined)).toBeNull()
  })

  it.each(["inline", "chat-textarea", "next-edit"])(
    "tags retained %s failures without mutating their details",
    (mode) => {
      random = spyOn(Math, "random").mockReturnValue(0.099)
      const properties = { mode, error: "timeout", latencyMs: 300 }
      expect(buildTelemetryPayload("Autocomplete LLM Request Failed", properties, { appVersion: "7.8.1" })).toEqual({
        event: "Autocomplete LLM Request Failed",
        properties: { ...properties, appVersion: "7.8.1", autocomplete_failure_sample_rate: 0.1 },
      })
      expect(properties).toEqual({ mode, error: "timeout", latencyMs: 300 })
    },
  )

  it("keeps successful completions and other events outside the failure sample", () => {
    random = spyOn(Math, "random").mockReturnValue(0.99)
    for (const event of ["Autocomplete LLM Request Completed", "Autocomplete Accept Suggestion", "$identify"]) {
      expect(buildTelemetryPayload(event, { count: 1 }, undefined)).toEqual({ event, properties: { count: 1 } })
    }
    expect(random).not.toHaveBeenCalled()
  })

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
})

describe("TelemetryProxy sampling", () => {
  it("does not forward dropped failures, but forwards successes and weighted retained failures", () => {
    const proxy = TelemetryProxy.getInstance()
    proxy.configure("http://localhost:12345", "test-only")
    const consent = spyOn(proxy, "isVSCodeTelemetryEnabled").mockReturnValue(true)
    const random = spyOn(Math, "random").mockReturnValue(0.99)
    const send = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }))
    try {
      proxy.capture(TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_FAILED, { error: "timeout" })
      expect(send).not.toHaveBeenCalled()

      proxy.capture(TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_COMPLETED, { latencyMs: 20 })
      expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toEqual({
        event: "Autocomplete LLM Request Completed",
        properties: { latencyMs: 20 },
      })

      random.mockReturnValue(0)
      proxy.capture(TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_FAILED, { error: "timeout" })
      expect(send).toHaveBeenCalledTimes(2)
      expect(JSON.parse(String(send.mock.calls[1]?.[1]?.body))).toEqual({
        event: "Autocomplete LLM Request Failed",
        properties: { error: "timeout", autocomplete_failure_sample_rate: 0.1 },
      })
    } finally {
      send.mockRestore()
      random.mockRestore()
      consent.mockRestore()
      proxy.configure("", "")
    }
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
