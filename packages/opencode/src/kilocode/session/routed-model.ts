import type { LLMEvent, ProviderMetadata } from "@opencode-ai/llm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
export namespace KiloRoutedModel {
  const ns = "kilocode"
  const key = "routedModelID"
  const providerKey = "routedProviderID"

  export function write(meta: ProviderMetadata | undefined, modelID: string | undefined) {
    const id = modelID?.trim()
    if (!id) return meta
    return {
      ...(meta ?? {}),
      [ns]: {
        ...(meta?.[ns] ?? {}),
        [key]: id,
      },
    } satisfies ProviderMetadata
  }

  // ADR 0005: a client pick runs on the owner's own provider, so the served
  // model identity cannot come from the Kilo gateway response. Record the
  // provider and keep a response-reported model id when the provider sent one.
  export function writeRoute(meta: ProviderMetadata | undefined, route: { providerID: string; modelID: string }) {
    const existing = meta?.[ns]?.[key]
    const id = typeof existing === "string" && existing.trim() ? existing.trim() : route.modelID
    return {
      ...(meta ?? {}),
      [ns]: {
        ...(meta?.[ns] ?? {}),
        [key]: id,
        [providerKey]: route.providerID,
      },
    } satisfies ProviderMetadata
  }

  export function stamp(event: LLMEvent, route: { providerID: string; modelID: string }): LLMEvent {
    switch (event.type) {
      case "step-finish":
        return { ...event, providerMetadata: writeRoute(event.providerMetadata, route) }
      case "finish":
        return { ...event, providerMetadata: writeRoute(event.providerMetadata, route) }
      default:
        return event
    }
  }

  export function display(modelID: string) {
    return modelID.trim().replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2})$/, "")
  }

  export function displayName(name: string) {
    return name
      .trim()
      .replace(/^[^:]+:\s+/, "")
      .replace(/^[^/\s]+\/(?=[^/]+$)/, "")
      .replace(/\s*\([^)]*%\s*off[^)]*\)\s*$/i, "")
      .replace(/^([A-Za-z]{2,})(?=\d)/, "$1 ")
      .replace(/\s+/g, " ")
  }

  export function read(meta: ProviderMetadata | undefined, providerID: ProviderV2.ID) {
    const value = meta?.[ns]?.[key]
    if (typeof value !== "string") return undefined
    const id = value.trim()
    if (!id) return undefined
    const routed = meta?.[ns]?.[providerKey]
    return {
      providerID: typeof routed === "string" && routed.trim() ? ProviderV2.ID.make(routed.trim()) : providerID,
      modelID: ModelV2.ID.make(id),
    }
  }

  export function readAuto(
    meta: ProviderMetadata | undefined,
    input: { providerID: ProviderV2.ID; modelID: string; selected?: string },
  ) {
    if (input.providerID !== ProviderV2.ID.kilo) return undefined
    if (!input.modelID.startsWith("kilo-auto/") && !input.modelID.startsWith("openrouter/") && !input.modelID.includes("fable")) return undefined
    const model = read(meta, input.providerID)
    if (!model) return undefined
    if (model.modelID === input.modelID || model.modelID === input.selected) return undefined
    return model
  }
}
