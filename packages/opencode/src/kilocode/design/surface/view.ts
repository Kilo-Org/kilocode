// Pure rendering of the voice console. Takes a State (+ a little ambient input)
// and returns the lines to paint. Kept free of ANSI/IO so it can be snapshot-
// tested; the terminal layer adds cursor moves and colors around these strings.

import type { State, InputKind } from "../state"

export type ViewInput = {
  state: State
  input: InputKind
  /** The line the user is currently typing (fake voice only). */
  draft?: string
  width?: number
}

const VOICE_GLYPH: Record<State["voice"], string> = {
  standby: "○",
  "requesting-permission": "◌",
  listening: "●",
  speaking: "◉",
  processing: "◍",
}

/** A small bar meter for mic level, 0..1. */
export function meter(level: number, slots = 12): string {
  const filled = Math.round(Math.min(1, Math.max(0, level)) * slots)
  return "[" + "#".repeat(filled) + ".".repeat(slots - filled) + "]"
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return text.slice(0, width)
  return text.slice(0, width - 1) + "…"
}

/**
 * Build the console lines top-to-bottom:
 *   voice-activity indicator, rolling transcript, status, hint.
 */
export function render(input: ViewInput): string[] {
  const state = input.state
  const width = input.width ?? 80
  const lines: string[] = []

  // Voice-activity indicator — the prominent "I'm listening" signal.
  const glyph = VOICE_GLYPH[state.voice]
  lines.push(`${glyph} voice: ${state.voice}   ${meter(state.level)}`)

  // Rolling live transcript: recent finalized turns, then the in-progress line.
  lines.push("")
  const recent = state.transcript.slice(-5)
  if (recent.length === 0 && !state.partial && !input.draft) {
    lines.push("  (say something — I'm listening)")
  } else {
    for (const turn of recent) {
      const mark = turn.queued ? "⋯" : "›"
      lines.push("  " + truncate(`${mark} ${turn.text}`, width - 2))
    }
    const live = input.input === "fake" ? (input.draft ?? "") : state.partial
    if (live) lines.push("  " + truncate(`… ${live}`, width - 2))
  }

  // Status line.
  lines.push("")
  const latency = state.lastLatencyMs !== undefined ? `${state.lastLatencyMs}ms` : "—"
  const active = state.active ? "working" : "idle"
  lines.push(
    `agent: ${active}  ·  turns: ${state.turns}  ·  queued: ${state.queue.length}  ·  last: ${latency}` +
      (state.target ? `  ·  ${truncate(state.target, 30)}` : ""),
  )
  if (state.error) lines.push(`error: ${truncate(state.error, width - 8)}`)

  // Hint.
  const hint =
    input.input === "fake"
      ? "type a change + Enter · Esc cancels & clears · Ctrl+C exits"
      : "just keep talking · Esc cancels & clears · Ctrl+C exits"
  lines.push(hint)

  return lines
}

export function renderText(input: ViewInput): string {
  return render(input).join("\n")
}
