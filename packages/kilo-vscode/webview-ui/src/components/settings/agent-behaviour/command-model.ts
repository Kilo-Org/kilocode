// The config `commands.<n>.model` value is a `providerID/modelID#variant` string or an explicit object with a `model`
// field. The Workflows subtab shows and edits it as one picker value, so it parses and serializes both shapes.
export interface CommandModelValue {
  providerID: string
  modelID: string
  variant?: string
}

export function parseCommandModel(raw: unknown): CommandModelValue | undefined {
  if (typeof raw === "string") {
    const [head, variant] = raw.split("#")
    const separator = head!.indexOf("/")
    if (separator <= 0) return undefined
    return {
      providerID: head!.slice(0, separator),
      modelID: head!.slice(separator + 1),
      ...(variant ? { variant } : {}),
    }
  }
  if (raw && typeof raw === "object") {
    const value = raw as { providerID?: unknown; model?: unknown; variant?: unknown }
    if (typeof value.providerID === "string" && typeof value.model === "string")
      return {
        providerID: value.providerID,
        modelID: value.model,
        ...(typeof value.variant === "string" ? { variant: value.variant } : {}),
      }
  }
  return undefined
}

export function serializeCommandModel(value: CommandModelValue): string {
  return value.variant ? `${value.providerID}/${value.modelID}#${value.variant}` : `${value.providerID}/${value.modelID}`
}
