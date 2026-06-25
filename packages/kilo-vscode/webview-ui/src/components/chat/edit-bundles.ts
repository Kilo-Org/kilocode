import type { Part as SDKPart, ToolPart } from "@kilocode/sdk/v2"

type PartBundle = {
  key: string
  count: number
  part: SDKPart
}

function path(part: SDKPart) {
  if (part.type !== "tool") return
  const tool = part as unknown as ToolPart
  if (tool.tool !== "edit" || tool.state.status === "error") return
  const value = tool.state.input.filePath
  return typeof value === "string" && value ? value : undefined
}

export function bundleEdits(parts: SDKPart[]) {
  return parts.reduce<PartBundle[]>((result, part) => {
    const file = path(part)
    const prior = result.at(-1)
    if (file && prior && path(prior.part) === file) {
      prior.count += 1
      prior.part = part
      return result
    }
    result.push({ key: `part:${part.id}`, count: 1, part })
    return result
  }, [])
}
