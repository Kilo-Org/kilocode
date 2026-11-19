import { createSignal } from "solid-js"
import type { ModelRef } from "@opencode/client"
import { createSelection, type SelectorSource } from "../../src/v2/selectors"

import type { HostedChoice } from "./route"

/** The same catalog, preferences and controls as a worktree draft. No hosted ID enters a local session mutation. */
export function createCloudSelection(initial: () => HostedChoice | undefined, effort: boolean) {
  const draft = createSelection(() => undefined)
  const [picked, setPicked] = createSignal<ModelRef>()
  const [mode, setMode] = createSignal<string>()
  const models = () => draft.models()?.filter((m) => m.providerID === "kilo" && m.enabled)
  const agents = () =>
    draft.agents().filter((a) => ["code", "ask", "architect", "debug", "plan", "build", initial()?.mode].includes(a.id))
  const agentID = () => mode() ?? initial()?.mode ?? "code"
  const model = () => {
    const saved = initial()
    if (picked()) return picked()
    if (saved) return { providerID: "kilo", id: saved.model, variant: saved.variant }
    const preferred = draft.model()
    if (preferred?.providerID === "kilo") return preferred
    const fallback = models()?.find((m) => m.id === "kilo-auto/free") ?? models()?.[0]
    return fallback && { providerID: "kilo", id: fallback.id, variant: undefined }
  }
  const variants = () =>
    effort
      ? (models()
          ?.find((m) => m.id === model()?.id)
          ?.variants.map((v) => v.id) ?? [])
      : []
  const selection: SelectorSource = {
    agents,
    agent: () => agents().find((a) => a.id === agentID()),
    models,
    model,
    variants,
    providers: draft.providers,
    selectAgent: (id) => {
      setMode(id)
      draft.selectAgent(id)
    },
    selectModel: (providerID, id) => {
      draft.selectModel(providerID, id)
      setPicked(draft.model())
    },
    selectVariant: (variant) => {
      const current = model()
      if (current) setPicked({ ...current, variant })
    },
  }
  return {
    selection,
    choice() {
      const current = model()
      return (
        current && {
          mode: agentID(),
          model: current.id,
          ...(effort && current.variant && { variant: current.variant }),
        }
      )
    },
  }
}
