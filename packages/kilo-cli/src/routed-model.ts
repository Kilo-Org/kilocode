const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/

export function isKiloAutoID(modelID: string) {
  return modelID.startsWith("kilo-auto/") || modelID === "auto-small"
}

/** Read only a bounded, printable gateway model identifier from an OpenAI-compatible response. */
export function responseModelID(input: unknown) {
  if (!isRecord(input)) return
  return modelID(input.model)
}

/** Read the Kilo-owned durable state after Core persists the routed adapter metadata namespace. */
export function routedModelID(input: unknown) {
  if (!isRecord(input)) return
  return modelID(input.routedModelID)
}

export function routedModelMetadata(model: string) {
  return { kilo: { routedModelID: model } }
}

function modelID(input: unknown) {
  if (typeof input !== "string" || input.length > 256 || !MODEL_ID.test(input)) return
  return input
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}
