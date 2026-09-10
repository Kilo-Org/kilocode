type Meta = { sessionId?: string }

type State = {
  metadata?: Meta
}

type Part = {
  type?: string
  tool?: string
  metadata?: Meta
  state?: State
}

export function childID(part: Part): string | undefined {
  if (part.type !== "tool" || part.tool !== "task") return undefined
  return part.metadata?.sessionId ?? part.state?.metadata?.sessionId
}
