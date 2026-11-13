// Model picker filtering. The Gateway small model is reserved for the small model row, as on v1, so every other
// picker hides it. The ids include the v1 alias for catalogs that still use it.
const KILO_GATEWAY_ID = "kilo"
const SMALL_MODEL_IDS = new Set(["kilo-auto/small", "auto-small"])

export function isSmallModel(model: { providerID: string; id: string }) {
  return model.providerID === KILO_GATEWAY_ID && SMALL_MODEL_IDS.has(model.id)
}

/** Gateway names start with the upstream provider ("MiniMax: ..."); the chat shows only the model name. */
export function stripSubProviderPrefix(name: string) {
  const colon = name.indexOf(": ")
  if (colon < 0) return name
  if (name.slice(0, colon).toLowerCase() === KILO_GATEWAY_ID) return name
  return name.slice(colon + 2)
}

/** The catalog rows a picker shows: enabled, not deprecated, and without the small model unless it is that row. */
export function pickerModels<T extends { providerID: string; id: string; enabled: boolean; status: string }>(
  models: T[],
  includeSmall = false,
): T[] {
  return models.filter(
    (model) => model.enabled && model.status !== "deprecated" && (includeSmall || !isSmallModel(model)),
  )
}
