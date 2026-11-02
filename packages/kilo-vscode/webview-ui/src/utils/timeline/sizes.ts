/**
 * Timeline bar sizing.
 *
 * Width  = uniform (no timing data available on the parts).
 * Height = proportional to content length.
 */

import type { TimelinePart } from "./types"

export const MAX_HEIGHT = 26
const BAR_W = 12
const MIN_H = 8
const PAD = 4

export interface BarSize {
  width: number
  height: number
  content: number
}

export interface TimelineScroll {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

/** Keep following updates when the viewport is within one bar of the right edge. */
export function pinned(scroll: TimelineScroll, slack = BAR_W): boolean {
  return scroll.scrollWidth - scroll.clientWidth - scroll.scrollLeft <= slack
}

function inputLength(input: unknown): number {
  if (!input) return 0
  if (typeof input === "string") return input.length
  if (typeof input !== "object") return 4
  let len = 2
  for (const key in input as Record<string, unknown>) {
    len += key.length + 3
    const val = (input as Record<string, unknown>)[key]
    if (typeof val === "string") len += val.length
    else if (typeof val === "number" || typeof val === "boolean") len += 6
    else if (val && typeof val === "object") len += 20
  }
  return len
}

function content(part: TimelinePart): number {
  if (part.type === "text" || part.type === "reasoning") return part.text.length
  return inputLength(part.input) + part.outputLength
}

export function sizes(parts: readonly TimelinePart[]): BarSize[] {
  const len = parts.length
  if (len === 0) return []

  const raw: number[] = new Array(len)
  let max = 1
  for (let i = 0; i < len; i++) {
    const value = content(parts[i]!)
    raw[i] = value
    if (value > max) max = value
  }

  const range = MAX_HEIGHT - MIN_H - PAD
  const result: BarSize[] = new Array(len)
  for (let i = 0; i < len; i++) {
    const value = raw[i]!
    result[i] = {
      width: BAR_W,
      height: Math.round(MIN_H + Math.min(1, value / max) * range),
      content: value,
    }
  }

  return result
}
