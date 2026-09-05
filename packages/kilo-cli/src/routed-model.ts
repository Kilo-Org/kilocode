const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/

export function isKiloAutoID(modelID: string) {
  return modelID.startsWith("kilo-auto/") || modelID === "auto-small"
}

/** Read the Kilo-owned durable state after Core persists the routed native-route metadata namespace. */
export function routedModelID(input: unknown) {
  if (!isRecord(input)) return
  return modelID(input.routedModelID)
}

function modelID(input: unknown) {
  if (typeof input !== "string" || input.length > 256 || !MODEL_ID.test(input)) return
  return input
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
