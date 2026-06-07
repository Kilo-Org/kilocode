// Terminal IO for the voice console: raw-mode keypress handling plus in-place
// repaint of the pure `view` lines. Deliberately lightweight (ANSI redraw, not
// a full reactive OpenTUI tree) so the exploratory MVP is robust and easy to
// reason about; the view itself is pure and unit-tested in view.ts.

import { resolveInteractiveStdin } from "@/cli/cmd/run/runtime.stdin"
import type { InputKind, State } from "../state"
import { initialState } from "../state"
import { renderText } from "./view"

export type TerminalSurface = {
  start(): void
  setState(state: State): void
  stop(): void
}

export type SurfaceHandlers = {
  input: InputKind
  target?: string
  /** A finalized typed line (fake voice). */
  onLine(text: string): void
  /** Escape pressed. */
  onEscape(): void
  /** Ctrl+C — quit. */
  onQuit(): void
}

const ESC = "\x1b"
const HIDE_CURSOR = `${ESC}[?25l`
const SHOW_CURSOR = `${ESC}[?25h`

export function createTerminalSurface(handlers: SurfaceHandlers): TerminalSurface {
  const source = resolveInteractiveStdin()
  const stdin = source.stdin
  let state: State = initialState({ target: handlers.target })
  let draft = ""
  let lastLineCount = 0
  let started = false

  function frame(): string {
    return renderText({ state, input: handlers.input, draft })
  }

  function paint() {
    const text = frame()
    const lines = text.split("\n")
    const out: string[] = []
    if (lastLineCount > 0) {
      // Move to the top of the previous frame and clear downward.
      out.push(`${ESC}[${lastLineCount - 1}A`)
      out.push(`${ESC}[0G`)
      out.push(`${ESC}[0J`)
    }
    out.push(lines.join("\r\n"))
    lastLineCount = lines.length
    process.stdout.write(out.join(""))
  }

  function onData(chunk: Buffer) {
    // Lone Escape (not a CSI sequence like arrow keys).
    if (chunk.length === 1 && chunk[0] === 0x1b) {
      handlers.onEscape()
      return
    }
    // Ignore multi-byte control sequences (arrows, function keys).
    if (chunk[0] === 0x1b) return

    for (const byte of chunk) {
      if (byte === 0x03) {
        handlers.onQuit()
        return
      }
      if (byte === 0x0d || byte === 0x0a) {
        const line = draft.trim()
        draft = ""
        paint()
        if (line) handlers.onLine(line)
        continue
      }
      if (byte === 0x7f || byte === 0x08) {
        if (draft.length > 0) {
          draft = draft.slice(0, -1)
          paint()
        }
        continue
      }
      // Printable ASCII — only meaningful for typed (fake) input.
      if (byte >= 0x20 && byte < 0x7f && handlers.input === "fake") {
        draft += String.fromCharCode(byte)
        paint()
      }
    }
  }

  return {
    start() {
      if (started) return
      started = true
      if (stdin.isTTY) stdin.setRawMode?.(true)
      stdin.resume()
      stdin.on("data", onData)
      process.stdout.write(HIDE_CURSOR)
      paint()
    },
    setState(next) {
      state = next
      if (started) paint()
    },
    stop() {
      if (!started) return
      started = false
      stdin.off("data", onData)
      if (stdin.isTTY) stdin.setRawMode?.(false)
      process.stdout.write("\r\n" + SHOW_CURSOR)
      source.cleanup?.()
    },
  }
}
