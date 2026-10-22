/**
 * Timeline bar sizing.
 *
 * Width  = uniform (no timing data available on Part types).
 * Height = proportional to content length.
 */

import type { Part, ToolPart, TextPart, ReasoningPart, StepFinishPart } from "../../types/messages"

// ── Constants ────────────────────────────────────────────────────────

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

// ── Content length ───────────────────────────────────────────────────

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

function content(part: Part): number {
  switch (part.type) {
    case "text":
      return (part as TextPart).text?.length ?? 1
    case "reasoning":
      return (part as ReasoningPart).text?.length ?? 1
    case "tool": {
      const tp = part as ToolPart
      const input = inputLength(tp.state.input)
      const output = tp.state.status === "completed" ? (tp.state.output?.length ?? 0) : 0
      return Math.max(1, input + output)
    }
    case "step-finish": {
      const sf = part as StepFinishPart
      return sf.tokens ? sf.tokens.input + sf.tokens.output + (sf.tokens.reasoning ?? 0) : 1
    }
    default:
      return 1
  }
}

// ── Calculate sizes for all bars ─────────────────────────────────────

export function sizes(parts: Part[]): BarSize[] {
  const len = parts.length
  if (len === 0) return []

  const raw: number[] = new Array(len)
  let max = 1
  for (let i = 0; i < len; i++) {
    const c = content(parts[i]!)
    raw[i] = c
    if (c > max) max = c
  }

  const range = MAX_HEIGHT - MIN_H - PAD
  const result: BarSize[] = new Array(len)
  for (let i = 0; i < len; i++) {
    const c = raw[i]!
    const cr = Math.min(1, c / max)
    result[i] = {
      width: BAR_W,
      height: Math.round(MIN_H + cr * range),
      content: c,
    }
  }

  return result
}
