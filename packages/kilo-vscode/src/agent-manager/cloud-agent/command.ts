type Input = Record<string, unknown>

function field(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function parseCloudCommand(input: Input, sessionID?: string) {
  const command = field(input.command)
  const args = typeof input.arguments === "string" ? input.arguments : undefined
  const messageID = typeof input.messageID === "string" ? input.messageID : undefined
  const draftID = typeof input.draftID === "string" ? input.draftID : undefined
  const files = Array.isArray(input.files) ? input.files : undefined
  const providerID = field(input.providerID)
  const modelID = field(input.modelID)
  const agent = field(input.agent) || undefined
  const variant = field(input.variant) || undefined
  if (!sessionID || !command || args === undefined || draftID || files?.length || providerID !== "kilo" || !modelID)
    return
  return {
    sessionID,
    ...(messageID ? { messageID } : {}),
    command,
    arguments: args,
    model: `kilo/${modelID}`,
    ...(agent ? { agent } : {}),
    ...(variant ? { variant } : {}),
  }
}
