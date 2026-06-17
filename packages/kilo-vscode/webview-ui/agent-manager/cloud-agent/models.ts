import { KILO_PROVIDER_ID } from "../../../src/shared/provider-model"
import type { EnrichedModel } from "../../src/context/provider-utils"
import type { ModelSelection } from "../../src/types/messages"

const supported = new Set(["code", "plan", "debug", "orchestrator", "ask"])

export function modes<T extends { name: string; native?: boolean; mode?: string; hidden?: boolean }>(agents: T[]): T[] {
  return agents.filter(
    (agent) => agent.native && agent.mode !== "subagent" && !agent.hidden && supported.has(agent.name),
  )
}

export function options(models: EnrichedModel[]) {
  return models.filter((model) => model.providerID === KILO_PROVIDER_ID)
}

export function initial(models: EnrichedModel[], selected: ModelSelection | null) {
  if (selected?.providerID === KILO_PROVIDER_ID && models.some((model) => model.id === selected.modelID)) {
    return selected.modelID
  }
  return models[0]?.id
}
