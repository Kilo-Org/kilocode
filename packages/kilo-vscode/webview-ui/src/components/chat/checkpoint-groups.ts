import type { Part, StepFinishPart, StepStartPart, ToolPart } from "@kilocode/sdk/v2"

export interface CheckpointGroup {
  start: StepStartPart
  finish?: StepFinishPart
  parts: Part[]
  tools: ToolPart[]
  active: boolean
  parallel: boolean
  turnStart: boolean
}

export interface CheckpointLayout {
  preamble: Part[]
  groups: CheckpointGroup[]
  tail: Part[]
}

const structural = (part: Part) =>
  part.type === "step-start" || part.type === "step-finish" || part.type === "snapshot" || part.type === "patch"

export function checkpointLayout(parts: Part[]): CheckpointLayout {
  const preamble: Part[] = []
  const groups: CheckpointGroup[] = []
  const tail: Part[] = []
  let group: CheckpointGroup | undefined

  const close = () => {
    if (!group) return
    group.active = !group.finish
    group.parallel = group.tools.length > 1
    group.turnStart = group.tools.length > 0 && !groups.some((item) => item.tools.length > 0)
    groups.push(group)
    group = undefined
  }

  for (const part of parts) {
    if (part.type === "step-start") {
      close()
      group = {
        start: part,
        parts: [],
        tools: [],
        active: true,
        parallel: false,
        turnStart: false,
      }
      continue
    }

    if (!group) {
      if (groups.length === 0) preamble.push(part)
      else tail.push(part)
      continue
    }

    if (part.type === "step-finish") {
      group.finish = part
      close()
      continue
    }

    if (part.type === "tool") {
      const tool = group.tools.findIndex((item) => item.callID === part.callID)
      const rendered = group.parts.findIndex((item) => item.type === "tool" && item.callID === part.callID)
      if (tool >= 0) group.tools[tool] = part
      else group.tools.push(part)
      if (rendered >= 0) group.parts[rendered] = part
      else group.parts.push(part)
    } else if (!structural(part)) group.parts.push(part)
  }

  close()
  return { preamble, groups, tail }
}

function sameParts(a: Part[], b: Part[]) {
  if (a.length !== b.length) return false
  return a.every((part, index) => part === b[index])
}

export function stableCheckpointLayout(next: CheckpointLayout, prev?: CheckpointLayout) {
  if (!prev) return next
  const groups = next.groups.map((group) => {
    const old = prev.groups.find((item) => item.start.id === group.start.id)
    if (!old) return group
    if (old.start !== group.start || old.finish !== group.finish) return group
    if (old.active !== group.active || old.parallel !== group.parallel || old.turnStart !== group.turnStart) return group
    if (!sameParts(old.parts, group.parts) || !sameParts(old.tools, group.tools)) return group
    return old
  })
  return { ...next, groups }
}

export function checkpointBoundary(parts: Part[], partID?: string) {
  if (!partID) return parts
  const index = parts.findIndex((part) => part.id === partID)
  if (index < 0) return parts
  return parts.slice(0, index)
}

export function checkpointPrompt(
  role: "user" | "assistant" | undefined,
  parts: { type: string; text?: string; synthetic?: boolean }[] | undefined,
  partID?: string,
) {
  if (partID || role !== "user" || !parts) return
  const text = parts
    .filter((part) => part.type === "text" && !part.synthetic)
    .map((part) => part.text ?? "")
    .join("")
  return text || undefined
}
