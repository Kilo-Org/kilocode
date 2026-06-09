import { describe, expect, it } from "bun:test"
import {
  getVariant,
  sessionVariantKeys,
  sessionVariants,
  transferVariants,
  variantKey,
} from "../../webview-ui/src/context/session-variant-store"
import type { ModelSelection } from "../../webview-ui/src/types/messages"

const model: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }
const variants = ["low", "medium", "high"]

describe("per-session variant selection", () => {
  it("keeps reasoning effort independent for each Agent Manager session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "session-a")] = "low"
    store[variantKey(model, "code", "session-b")] = "high"

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("low")
    expect(getVariant(store, model, variants, "code", "session-b")).toBe("high")
  })

  it("keeps reasoning effort independent for each pending local tab", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "pending-local-1")] = "medium"
    store[variantKey(model, "code", "pending-local-2")] = "high"

    expect(getVariant(store, model, variants, "code", "pending-local-1")).toBe("medium")
    expect(getVariant(store, model, variants, "code", "pending-local-2")).toBe("high")
  })

  it("keeps no-session reasoning effort independent per agent", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code")] = "medium"
    store[variantKey(model, "ask")] = "high"

    expect(getVariant(store, model, variants, "code")).toBe("medium")
    expect(getVariant(store, model, variants, "ask")).toBe("high")
  })

  it("carries the pre-submit agent variant into a newly created session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code")] = "medium"

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("medium")
  })

  it("prefers a session variant over the pre-submit agent variant", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code")] = "medium"
    store[variantKey(model, "code", "session-a")] = "high"

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("high")
  })

  it("falls back to the legacy provider/model variant key", () => {
    const store: Record<string, string> = { "anthropic/claude-sonnet-4": "medium" }

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("medium")
  })

  it("transfers a pending local tab variant to the created session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "pending-local-1")] = "medium"
    Object.assign(store, transferVariants(store, "pending-local-1", "session-a"))

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("medium")
  })

  it("extracts persisted session variant preferences", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "session-a")] = "medium"
    store[variantKey(model, "code", "session-b")] = "high"

    expect(sessionVariants(store, "session-a")).toEqual({ "anthropic/claude-sonnet-4": "medium" })
  })

  it("finds only variant keys for the requested session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "pending-local-1")] = "medium"
    store[variantKey(model, "code", "pending-local-2")] = "high"

    expect(sessionVariantKeys(store, "pending-local-1")).toEqual(["session/pending-local-1/anthropic/claude-sonnet-4"])
  })
})
