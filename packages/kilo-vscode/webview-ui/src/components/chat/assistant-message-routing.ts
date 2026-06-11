import type { Part, ToolPart } from "@kilocode/sdk/v2"

export const UPSTREAM_SUPPRESSED_TOOLS = new Set(["todowrite", "todoread"])

export function isKiloToolRenderable(part: ToolPart) {
  if (!UPSTREAM_SUPPRESSED_TOOLS.has(part.tool)) return true
  return part.state.status === "completed"
}

export function matchToolRequest<T extends { tool?: { callID: string; messageID: string } }>(
  part: Part,
  name: string,
  requests: T[],
): T | undefined {
  if (part.type !== "tool") return undefined
  if (part.tool !== name) return undefined
  return requests.find((request) => request.tool?.callID === part.callID && request.tool?.messageID === part.messageID)
}
