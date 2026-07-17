import { describe, expect, it } from "bun:test"
import {
  cycleVariant,
  agentVariantKeys,
  getPromptVariant,
  modeVariant,
  getVariant,
  sessionVariantKeys,
  sessionVariants,
  transferVariants,
  variantKey,
} from "../../webview-ui/src/context/session-variant-store"
import type { ModelSelection } from "../../webview-ui/src/types/messages"

const model: ModelSelection = { providerID: "anthropic", modelID: "claude-sonnet-4" }
const other: ModelSelection = { providerID: "openai", modelID: "gpt-5" }
const variants = ["low", "medium", "high"]

describe("per-session variant selection", () => {
  it("keeps reasoning effort independent for each Agent Manager session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "session-a")] = "low"
    store[variantKey(model, "code", "session-b")] = "high"

    expect(getVariant(store, model, variants, "code", "session-a")).toBe("low")
    expect(getVariant(store, model, variants, "code", "session-b")).toBe("high")
  })

  it("keeps variants independent for different agents in the same session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "session-a")] = "low"

    expect(getVariant(store, model, variants, "ask", "session-a", "high")).toBe("high")

    store[variantKey(model, "ask", "session-a")] = "medium"

    expect(getVariant(store, model, variants, "code", "session-a", "high")).toBe("low")
    expect(getVariant(store, model, variants, "ask", "session-a", "high")).toBe("medium")
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

  it("uses the configured agent variant when no session override exists", () => {
    const store: Record<string, string> = {}

    expect(getVariant(store, model, variants, "code", undefined, "high")).toBe("high")
  })

  it("prefers a session override over the configured agent variant", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "session-a")] = "low"

    expect(getVariant(store, model, variants, "code", "session-a", "high")).toBe("low")
  })

  it("ignores invalid configured variants", () => {
    const store: Record<string, string> = {}

    expect(getVariant(store, model, variants, "code", undefined, "xhigh")).toBeUndefined()
  })

  it("treats the default sentinel as no configured variant", () => {
    const store: Record<string, string> = {}

    expect(getVariant(store, model, variants, "code", undefined, "default")).toBeUndefined()
  })

  it("lets an explicit default override suppress a configured variant", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code")] = "default"

    expect(getVariant(store, model, variants, "code", undefined, "high")).toBeUndefined()
  })

  it("preserves explicit default for prompt payloads", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "session-a")] = "default"

    expect(getVariant(store, model, variants, "code", "session-a", "high")).toBeUndefined()
    expect(getPromptVariant(store, model, variants, "code", "session-a", "high")).toBe("default")
  })

  it("does not send configured default as a prompt override", () => {
    const store: Record<string, string> = {}

    expect(getPromptVariant(store, model, variants, "code", undefined, "default")).toBeUndefined()
  })

  it("reserves configured default even when a provider exposes a default variant", () => {
    const store: Record<string, string> = {}

    expect(getPromptVariant(store, model, [...variants, "default"], "code", undefined, "default")).toBeUndefined()
  })

  it("clears stale no-session variants for one agent before applying a new config default", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code")] = "high"
    store[variantKey(other, "code")] = "medium"
    store[variantKey(model, "ask")] = "low"

    for (const key of agentVariantKeys(store, "code")) delete store[key]
    store[variantKey(other, "code")] = "default"

    expect(getVariant(store, model, variants, "code", undefined, "default")).toBeUndefined()
    expect(getVariant(store, other, variants, "code", undefined, "default")).toBeUndefined()
    expect(getVariant(store, model, variants, "ask")).toBe("low")
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

    expect(sessionVariants(store, "session-a")).toEqual({ "code/anthropic/claude-sonnet-4": "medium" })
  })

  it("finds only variant keys for the requested session", () => {
    const store: Record<string, string> = {}

    store[variantKey(model, "code", "pending-local-1")] = "medium"
    store[variantKey(model, "code", "pending-local-2")] = "high"

    expect(sessionVariantKeys(store, "pending-local-1")).toEqual([
      "session/pending-local-1/code/anthropic/claude-sonnet-4",
    ])
  })

  it("uses config variants only when the configured model matches", () => {
    expect(modeVariant(model, model, "high")).toBe("high")
    expect(modeVariant(model, other, "high")).toBeUndefined()
    expect(modeVariant(model, undefined, "high")).toBe("high")
  })
})

describe("cycleVariant", () => {
  it("advances to the next variant", () => {
    expect(cycleVariant("low", variants)).toBe("medium")
    expect(cycleVariant("medium", variants)).toBe("high")
  })

  it("wraps back to the first variant after the last", () => {
    expect(cycleVariant("high", variants)).toBe("low")
  })

  it("starts at the first variant when current is missing or unknown", () => {
    expect(cycleVariant(undefined, variants)).toBe("low")
    expect(cycleVariant("bogus", variants)).toBe("low")
  })

  it("returns undefined when no variants exist", () => {
    expect(cycleVariant("low", [])).toBeUndefined()
  })
})
