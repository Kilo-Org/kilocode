// Mapping between the v2 `ConfigModel.Selection` written to the config file and the `ModelPickerValue` of the picker.
// The selection is either the short string `provider/model#variant` or the explicit `{ providerID, model, variant? }`.

/** The picker value shape (`ModelPickerValue`), kept local so this module stays free of component imports. */
export interface ModelSelection {
  providerID: string
  modelID: string
  variant?: string
}

/** Read a selection value as a picker value. Unknown or malformed values read as unset. */
export function selection(value: unknown): ModelSelection | undefined {
  if (typeof value === "string") {
    const slash = value.indexOf("/")
    if (slash <= 0) return undefined
    const rest = value.slice(slash + 1)
    const hash = rest.indexOf("#")
    const modelID = hash === -1 ? rest : rest.slice(0, hash)
    if (!modelID) return undefined
    return {
      providerID: value.slice(0, slash),
      modelID,
      ...(hash === -1 ? {} : { variant: rest.slice(hash + 1) }),
    }
  }
  if (typeof value === "object" && value !== null) {
    const record = value as { providerID?: unknown; model?: unknown; variant?: unknown }
    if (typeof record.providerID !== "string" || typeof record.model !== "string") return undefined
    return {
      providerID: record.providerID,
      modelID: record.model,
      ...(typeof record.variant === "string" ? { variant: record.variant } : {}),
    }
  }
  return undefined
}

/** Write a picker value as the explicit `ConfigModel.Selection` object, or `undefined` when cleared. */
export function write(value: ModelSelection | undefined) {
  if (!value) return undefined
  return {
    providerID: value.providerID,
    model: value.modelID,
    ...(value.variant ? { variant: value.variant } : {}),
  }
}
