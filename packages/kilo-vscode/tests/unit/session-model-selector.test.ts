import { describe, expect, it } from "bun:test"
import { createModelSelector } from "../../webview-ui/src/context/session-model-selector"
import { variantKey } from "../../webview-ui/src/context/session-variant-store"

describe("model selector", () => {
  it("preserves the nearest variant for the active session model change", () => {
    const selected = { providerID: "kilo", modelID: "old" }
    const next: Array<{ id: string; selection: typeof selected }> = []
    const variants: Record<string, string> = {}
    const hidden: string[] = []
    const selector = createModelSelector({
      current: () => "session",
      agent: () => "code",
      selected: () => selected,
      variant: () => "high",
      variants: () => ["low", "medium"],
      apply: (_agent, selection, id) => next.push({ id: id!, selection }),
      set: () => undefined,
      setVariant: (key, value) => (variants[key] = value),
      persist: () => undefined,
      hide: (id) => hidden.push(id),
    })

    selector.select("kilo", "new")

    const model = { providerID: "kilo", modelID: "new" }
    expect(next).toEqual([{ id: "session", selection: model }])
    expect(variants[variantKey(model, "code", "session")]).toBe("medium")
    expect(hidden).toEqual(["session"])
  })

  it("retains a session variant without persisting a global model selection", () => {
    const selected = { providerID: "kilo", modelID: "old" }
    const models: Array<{ id: string; selection: typeof selected }> = []
    const variants: Record<string, string> = {}
    let persisted = false
    const selector = createModelSelector({
      current: () => undefined,
      agent: () => "code",
      selected: () => selected,
      variant: () => "high",
      variants: () => ["low", "medium", "high"],
      apply: () => undefined,
      set: (id, selection) => models.push({ id, selection }),
      setVariant: (key, value) => (variants[key] = value),
      persist: () => (persisted = true),
      hide: () => undefined,
    })

    selector.session("session", "kilo", "new")

    const model = { providerID: "kilo", modelID: "new" }
    expect(models).toEqual([{ id: "session", selection: model }])
    expect(variants[variantKey(model, "code", "session")]).toBe("high")
    expect(persisted).toBe(false)
  })
})
