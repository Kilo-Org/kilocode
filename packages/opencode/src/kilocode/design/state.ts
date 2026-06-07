// Pure reducer for Design Mode turn handling.
//
// Everything stateful about the loop lives here as `(state, action) -> {state,
// effects}`. No timers, no IO, no randomness — so the whole turn lifecycle
// (continuous capture, queue-while-busy, ordered drain, Escape barge-in) is
// exhaustively unit-testable without mocks. The orchestrator runs the returned
// effects against the real session/voice adapter.

import type { VoiceEvent, VoiceState } from "./voice/protocol"

export type AgentState = "idle" | "busy"
export type InputKind = "voice" | "fake"

export type Turn = {
  id: string
  text: string
  /** True if it waited in the queue rather than dispatching immediately. */
  queued: boolean
  latencyMs?: number
}

export type State = {
  voice: VoiceState
  agent: AgentState
  /** The turn currently dispatched and awaiting completion, if any. */
  active?: Turn
  /** Finalized turns waiting for the agent to free up. */
  queue: Turn[]
  /** Live partial transcript while the user is speaking. */
  partial: string
  /** Recent finalized turns, newest last — the rolling transcript. */
  transcript: Turn[]
  /** Count of finalized turns this session. */
  turns: number
  /** Mic level 0..1 for the meter. */
  level: number
  lastLatencyMs?: number
  /** Monotonic counter used to mint turn ids deterministically. */
  seq: number
  target?: string
  error?: string
}

export type Action =
  | { type: "voice"; event: VoiceEvent }
  | { type: "agent-open" }
  | { type: "agent-close"; reason: "completed" | "error" | "interrupted"; latencyMs?: number }
  | { type: "error"; message: string }
  | { type: "escape" }

export type Effect =
  | { type: "dispatch"; turn: Turn }
  | { type: "cancel" }
  | { type: "reset-voice" }

export type Reduced = { state: State; effects: Effect[] }

const TRANSCRIPT_LIMIT = 50

export function initialState(input?: { target?: string; voice?: VoiceState }): State {
  return {
    voice: input?.voice ?? "standby",
    agent: "idle",
    queue: [],
    partial: "",
    transcript: [],
    turns: 0,
    level: 0,
    seq: 0,
    target: input?.target,
  }
}

function pushTranscript(transcript: Turn[], turn: Turn): Turn[] {
  const next = [...transcript, turn]
  return next.length > TRANSCRIPT_LIMIT ? next.slice(next.length - TRANSCRIPT_LIMIT) : next
}

/** Build a finalized turn from a voice `turn` event, minting an id if needed. */
function makeTurn(state: State, event: Extract<VoiceEvent, { type: "turn" }>, queued: boolean): Turn {
  const seq = state.seq + 1
  return {
    id: event.turnId ?? `turn_${String(seq).padStart(3, "0")}`,
    text: event.text,
    queued,
    ...(event.latencyMs !== undefined ? { latencyMs: event.latencyMs } : {}),
  }
}

function onTurn(state: State, event: Extract<VoiceEvent, { type: "turn" }>): Reduced {
  // Nothing in flight: dispatch immediately.
  if (!state.active) {
    const turn = makeTurn(state, event, false)
    return {
      state: {
        ...state,
        active: turn,
        partial: "",
        transcript: pushTranscript(state.transcript, turn),
        turns: state.turns + 1,
        seq: state.seq + 1,
      },
      effects: [{ type: "dispatch", turn }],
    }
  }
  // Agent busy: queue as a follow-up — "kept active while the agent edits".
  const turn = makeTurn(state, event, true)
  return {
    state: {
      ...state,
      queue: [...state.queue, turn],
      partial: "",
      transcript: pushTranscript(state.transcript, turn),
      turns: state.turns + 1,
      seq: state.seq + 1,
    },
    effects: [],
  }
}

function onVoice(state: State, event: VoiceEvent): Reduced {
  switch (event.type) {
    case "state":
      return { state: { ...state, voice: event.value }, effects: [] }
    case "partial":
      return { state: { ...state, partial: event.text }, effects: [] }
    case "level":
      return { state: { ...state, level: event.peak }, effects: [] }
    case "error":
      return { state: { ...state, error: event.message }, effects: [] }
    case "turn":
      return onTurn(state, event)
  }
}

function onAgentClose(state: State, latencyMs?: number): Reduced {
  const last = latencyMs ?? state.lastLatencyMs
  const [next, ...rest] = state.queue
  if (!next) {
    return { state: { ...state, agent: "idle", active: undefined, lastLatencyMs: last }, effects: [] }
  }
  // Drain the next queued turn in order.
  return {
    state: { ...state, agent: "busy", active: next, queue: rest, lastLatencyMs: last },
    effects: [{ type: "dispatch", turn: next }],
  }
}

/** Escape = hard interrupt: cancel active work, clear the queue, keep listening. */
function onEscape(state: State): Reduced {
  return {
    state: {
      ...state,
      agent: "idle",
      active: undefined,
      queue: [],
      partial: "",
      error: undefined,
    },
    effects: [{ type: "cancel" }, { type: "reset-voice" }],
  }
}

export function reduce(state: State, action: Action): Reduced {
  switch (action.type) {
    case "voice":
      return onVoice(state, action.event)
    case "agent-open":
      return { state: { ...state, agent: "busy" }, effects: [] }
    case "agent-close":
      return onAgentClose(state, action.latencyMs)
    case "error":
      return { state: { ...state, error: action.message }, effects: [] }
    case "escape":
      return onEscape(state)
  }
}
