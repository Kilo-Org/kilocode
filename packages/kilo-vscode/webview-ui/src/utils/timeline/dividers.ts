import { DIVIDER_SLOT_W } from "./sizes"

export interface TimelineBar {
  bg: string
  tip: string
  width: number
  height: number
  idx: number
  msgId: string
  partId: string
  type?: string
  divider?: boolean
}

// Insert a divider after each finished step; keep the trailing divider only while running.
export function withDividers(bars: TimelineBar[], ends: string[], tail: boolean): TimelineBar[] {
  const tallest = bars.reduce((max, bar) => Math.max(max, bar.height), 0)
  const marks = new Set(ends)
  const last = ends.length > 0 ? ends[ends.length - 1] : undefined
  const out: TimelineBar[] = []
  for (const bar of bars) {
    out.push(bar)
    if (!marks.has(bar.partId)) continue
    if (bar.partId === last && !tail) continue
    out.push({
      bg: "",
      tip: "",
      width: DIVIDER_SLOT_W,
      height: tallest,
      idx: -1,
      msgId: "",
      partId: "",
      type: "divider",
      divider: true,
    })
  }
  return out
}

export function resolveMenuIndex(hit: number, selected: number, count: number): number {
  if (hit >= 0) return hit
  if (selected >= 0 && selected < count) return selected
  return count - 1
}
