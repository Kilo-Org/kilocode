import { color, label } from "./colors"
import { sizes } from "./sizes"
import type { TimelinePart } from "./types"

export interface TimelineBar {
  bg: string
  tip: string
  width: number
  height: number
  idx: number
  msgId: string
  partId: string
}

export function timelineBars(parts: readonly TimelinePart[]): TimelineBar[] {
  const sz = sizes(parts)
  return parts.map((part, idx) => ({
    bg: color(part),
    tip: label(part),
    width: sz[idx]!.width,
    height: sz[idx]!.height,
    idx,
    msgId: part.messageID,
    partId: part.key,
  }))
}
