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

  it("keeps a variant-only switch until the store reports that variant", () => {
    const attribution = createModelAttribution()
    attribution.request("ses_one", model("claude", "high"))

    expect(attribution.read("ses_one", model("claude", "low"))).toEqual(model("claude", "high"))
    expect(attribution.read("ses_one", model("claude", "high"))).toEqual(model("claude", "high"))
    expect(attribution.read("ses_one", model("claude", "low"))).toEqual(model("claude", "low"))
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

  it("keeps a newer request when an earlier switch fails", () => {
    const attribution = createModelAttribution()
    const earlier = model("deepseek-v4.1-flash")
    const later = model("kilo-auto-free")
    attribution.request("ses_one", earlier)
    attribution.request("ses_one", later)

    attribution.clear("ses_one", earlier)

    expect(attribution.read("ses_one", model("nemotron-3.5-lightning"))).toEqual(later)
  })
})
