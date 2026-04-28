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

// ── Content length ───────────────────────────────────────────────────

function content(part: Part): number {
  switch (part.type) {
    case "text":
      return (part as TextPart).text?.length ?? 1
    case "reasoning":
      return (part as ReasoningPart).text?.length ?? 1
    case "tool": {
      const tp = part as ToolPart
      const input = JSON.stringify(tp.state.input ?? {}).length
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
  if (parts.length === 0) return []

  const raw = parts.map((p) => content(p))
  const max = Math.max(...raw)

  return raw.map((c) => {
    const cr = Math.min(1, c / Math.max(1, max))
    return {
      width: BAR_W,
      height: Math.round(MIN_H + cr * (MAX_HEIGHT - MIN_H - PAD)),
      content: c,
    }
  })
}
