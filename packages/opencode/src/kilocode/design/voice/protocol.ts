// Voice Helper Protocol — the contract between the orchestrator and any voice
// source (the fake adapter, a scripted JSONL helper, or the Swift sidecar).
//
// A voice source emits newline-delimited JSON ("JSONL") on stdout. Each line is
// one event. This module defines the event shape and a streaming parser that
// turns raw stdout chunks into normalized events, tolerating partial lines and
// silently dropping malformed ones (a noisy sidecar must never crash the loop).

/** Lifecycle states a voice source reports. Mirrors Yoke's status vocabulary. */
export type VoiceState = "standby" | "requesting-permission" | "loading" | "listening" | "speaking" | "processing"

export const VOICE_STATES: readonly VoiceState[] = [
  "standby",
  "requesting-permission",
  "loading",
  "listening",
  "speaking",
  "processing",
]

/** A normalized event from a voice source. */
export type VoiceEvent =
  | { type: "state"; value: VoiceState }
  /** Live, non-final transcript shown while the user is still speaking. */
  | { type: "partial"; text: string }
  /** A finalized utterance (automatic end-of-utterance, or a typed line in fake mode). */
  | { type: "turn"; text: string; turnId?: string; latencyMs?: number }
  /** Mic activity level 0..1, for the on-screen meter. */
  | { type: "level"; peak: number }
  | { type: "error"; message: string }

/** Commands the orchestrator can send back to a voice source (over stdin). */
export type VoiceCommand =
  | { type: "stop" }
  | { type: "reset" }
  | { type: "shutdown" }
  | { type: "set-activation"; value: "continuous" | "push-to-talk" }

function isState(value: unknown): value is VoiceState {
  return typeof value === "string" && (VOICE_STATES as readonly string[]).includes(value)
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * Normalize one parsed JSON value into a VoiceEvent. Returns undefined for
 * anything we don't recognize, so callers can drop junk without branching.
 */
export function normalize(raw: unknown): VoiceEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const obj = raw as Record<string, unknown>
  switch (obj.type) {
    case "state":
      return isState(obj.value) ? { type: "state", value: obj.value } : undefined
    case "partial":
      return typeof obj.text === "string" ? { type: "partial", text: obj.text } : undefined
    case "turn": {
      if (typeof obj.text !== "string") return undefined
      const text = obj.text.trim()
      if (!text) return undefined
      return {
        type: "turn",
        text,
        ...(typeof obj.turnId === "string" ? { turnId: obj.turnId } : {}),
        ...(typeof obj.latencyMs === "number" && Number.isFinite(obj.latencyMs) ? { latencyMs: obj.latencyMs } : {}),
      }
    }
    case "level":
      return { type: "level", peak: clamp01(Number(obj.peak)) }
    case "error":
      return { type: "error", message: typeof obj.message === "string" ? obj.message : "voice error" }
    default:
      return undefined
  }
}

/** Parse a single JSONL line into a VoiceEvent, or undefined if blank/malformed. */
export function parseLine(line: string): VoiceEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  try {
    return normalize(JSON.parse(trimmed))
  } catch {
    // A malformed frame is expected occasionally (interleaved logging, partial
    // flush). Dropping it is correct; the next valid frame recovers the stream.
    return undefined
  }
}

export type JsonlParser = {
  /** Feed a raw chunk; returns any complete events it produced. */
  write(chunk: string): VoiceEvent[]
  /** Flush a trailing line with no newline (e.g. on stream end). */
  flush(): VoiceEvent[]
}

/**
 * Streaming JSONL parser. Buffers partial lines across chunks so a frame split
 * over two reads still parses once its newline arrives.
 */
export function createJsonlParser(): JsonlParser {
  let buffer = ""
  return {
    write(chunk) {
      buffer += chunk
      const events: VoiceEvent[] = []
      let index = buffer.indexOf("\n")
      while (index !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        const event = parseLine(line)
        if (event) events.push(event)
        index = buffer.indexOf("\n")
      }
      return events
    },
    flush() {
      const rest = buffer
      buffer = ""
      const event = parseLine(rest)
      return event ? [event] : []
    },
  }
}

export function encodeCommand(cmd: VoiceCommand): string {
  return JSON.stringify(cmd) + "\n"
}
