import { describe, expect, it } from "bun:test"
import type { ModelRef } from "@opencode/client"
import { createModelAttribution } from "../webview-ui/src/v2/attribution"

const model = (id: string, variant?: string): ModelRef => ({ id, providerID: "kilo", ...(variant ? { variant } : {}) })

describe("model attribution", () => {
  it("names the requested model before the store reports it", () => {
    const attribution = createModelAttribution()
    attribution.request("ses_one", model("deepseek-v4.1-flash"))

    expect(attribution.read("ses_one", model("kilo-auto-free"))).toEqual(model("deepseek-v4.1-flash"))
  })

  it("reports the session's own model when no switch was requested", () => {
    const attribution = createModelAttribution()

    expect(attribution.read("ses_one", model("kilo-auto-free", "high"))).toEqual(model("kilo-auto-free", "high"))
    expect(attribution.read("ses_one", undefined)).toBeUndefined()
  })

  it("forgets the request once the store reports the same model", () => {
    const attribution = createModelAttribution()
    attribution.request("ses_one", model("deepseek-v4.1-flash"))

    expect(attribution.read("ses_one", model("deepseek-v4.1-flash"))).toEqual(model("deepseek-v4.1-flash"))
    // A later server change is not overwritten by the old request.
    expect(attribution.read("ses_one", model("kilo-auto-free"))).toEqual(model("kilo-auto-free"))
  })

  it("never names a prompt of another session", () => {
    const attribution = createModelAttribution()
    attribution.request("ses_one", model("deepseek-v4.1-flash"))

    expect(attribution.read("ses_two", model("kilo-auto-free"))).toEqual(model("kilo-auto-free"))
  })

  it("does not name a prompt after the request is cleared", () => {
    const attribution = createModelAttribution()
    attribution.request("ses_one", model("deepseek-v4.1-flash"))
    attribution.clear("ses_one")

    expect(attribution.read("ses_one", model("kilo-auto-free"))).toEqual(model("kilo-auto-free"))
  })
})
