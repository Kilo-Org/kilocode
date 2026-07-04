import type { ProviderMetadata } from "@opencode-ai/llm"
import { ModelID, ProviderID } from "@/provider/schema"

export namespace KiloRoutedModel {
  const ns = "kilocode"
  const key = "routedModelID"

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

  export function read(meta: ProviderMetadata | undefined, providerID: ProviderID) {
    const value = meta?.[ns]?.[key]
    if (typeof value !== "string") return undefined
    const id = value.trim()
    if (!id) return undefined
    return {
      providerID,
      modelID: ModelID.make(id),
    }
  }

  function different(
    meta: ProviderMetadata | undefined,
    input: { providerID: ProviderID; modelID: string; selected?: string },
  ) {
    const model = read(meta, input.providerID)
    if (!model) return undefined
    if (model.modelID === input.modelID || model.modelID === input.selected) return undefined
    return model
  }

  export function readAuto(
    meta: ProviderMetadata | undefined,
    input: { providerID: ProviderID; modelID: string; selected?: string },
  ) {
    if (input.providerID !== ProviderID.kilo) return undefined
    if (!input.modelID.startsWith("kilo-auto/")) return undefined
    return different(meta, input)
  }

  export function readSession(
    meta: ProviderMetadata | undefined,
    input: { providerID: ProviderID; modelID: string; selected?: string },
  ) {
    const auto = readAuto(meta, input)
    if (auto) return auto
    if (!input.modelID.toLowerCase().includes("fable")) return undefined
    return different(meta, input)
  }

}
