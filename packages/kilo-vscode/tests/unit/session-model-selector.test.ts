import { describe, expect, it } from "bun:test"
import { createModelSelector } from "../../webview-ui/src/context/session-model-selector"

describe("model selector", () => {
  it("carries the active session variant for the selected model", () => {
    const selected = { providerID: "kilo", modelID: "old" }
    const next: Array<{ id: string; selection: typeof selected }> = []
    const variants: Array<{ value: string | undefined; session: string | undefined }> = []
    const hidden: string[] = []
    const selector = createModelSelector({
      current: () => "session",
      agent: () => "code",
      selected: () => selected,
      variant: () => "high",
      apply: (_agent, selection, id) => next.push({ id: id!, selection }),
      set: () => undefined,
      carry: (_selection, value, _agent, session) => variants.push({ value, session }),
      hide: (id) => hidden.push(id),
    })

    selector.select("kilo", "new")

    const model = { providerID: "kilo", modelID: "new" }
    expect(next).toEqual([{ id: "session", selection: model }])
    expect(variants).toEqual([{ value: "high", session: "session" }])
    expect(hidden).toEqual(["session"])
  })

  it("retains a session variant without persisting a global model selection", () => {
    const selected = { providerID: "kilo", modelID: "old" }
    const models: Array<{ id: string; selection: typeof selected }> = []
    const variants: Array<{ value: string | undefined; session: string | undefined }> = []
    const selector = createModelSelector({
      current: () => undefined,
      agent: () => "code",
      selected: () => selected,
      variant: () => "high",
      apply: () => undefined,
      set: (id, selection) => models.push({ id, selection }),
      carry: (_selection, value, _agent, session) => variants.push({ value, session }),
      hide: () => undefined,
    })

    selector.session("session", "kilo", "new")

    const model = { providerID: "kilo", modelID: "new" }
    expect(models).toEqual([{ id: "session", selection: model }])
    expect(variants).toEqual([{ value: "high", session: "session" }])
  })
})
