// The orchestrator owns the live loop. It holds the reducer state, feeds it
// voice events and agent lifecycle signals, and runs the resulting effects
// against injected sinks (dispatch / cancel). It is plain TypeScript so it can
// be driven in tests by the real fake-voice adapter plus a stub dispatch sink —
// no Effect runtime, no mocks.

import type { VoiceAdapter } from "./voice/adapter"
import type { VoiceEvent } from "./voice/protocol"
import { initialState, reduce, type Action, type Effect, type InputKind, type State, type Turn } from "./state"

export type OrchestratorOpts = {
  adapter: VoiceAdapter
  input: InputKind
  target?: string
  /** Dispatch a turn to the agent. Fire-and-forget; report progress via agentOpen/agentClose. */
  dispatch: (turn: Turn) => void
  /** Interrupt the active agent turn. */
  cancel: () => void
  /** Called after every state change so the surface can repaint. */
  render: (state: State) => void
}

export type Orchestrator = {
  start(): Promise<void>
  /** Feed a typed line (fake voice) — becomes a finalized turn. */
  submitLine(text: string): void
  /** Escape: interrupt + clear queue, keep listening. */
  escape(): void
  /** Agent run started (from the session bus). */
  agentOpen(): void
  /** Agent run finished (from the session bus). */
  agentClose(reason: "completed" | "error" | "interrupted"): void
  /** Surface an error (e.g. a failed dispatch) on the console. */
  reportError(message: string): void
  stop(): Promise<void>
  /** Current snapshot — exposed for tests and the surface. */
  current(): State
}

export function createOrchestrator(opts: OrchestratorOpts): Orchestrator {
  let state = initialState({ target: opts.target })
  // When the active turn was dispatched, for real loop-latency (dispatch → close).
  let dispatchAt = 0

  function runEffect(effect: Effect) {
    switch (effect.type) {
      case "dispatch":
        dispatchAt = Date.now()
        opts.dispatch(effect.turn)
        return
      case "cancel":
        opts.cancel()
        return
      case "reset-voice":
        opts.adapter.reset()
        return
    }
  }

  function apply(action: Action) {
    const result = reduce(state, action)
    state = result.state
    for (const effect of result.effects) runEffect(effect)
    opts.render(state)
  }

  function onVoice(event: VoiceEvent) {
    apply({ type: "voice", event })
  }

  return {
    async start() {
      await opts.adapter.start(onVoice)
      opts.render(state)
    },
    submitLine(text) {
      // In fake mode this injects a turn event; real sources segment audio
      // themselves and don't implement inject, so typed lines are ignored.
      opts.adapter.inject?.(text)
    },
    escape() {
      apply({ type: "escape" })
    },
    agentOpen() {
      apply({ type: "agent-open" })
    },
    agentClose(reason) {
      const latencyMs = dispatchAt ? Date.now() - dispatchAt : undefined
      apply({ type: "agent-close", reason, latencyMs })
    },
    reportError(message) {
      apply({ type: "error", message })
    },
    async stop() {
      await opts.adapter.shutdown()
    },
    current() {
      return state
    },
  }
}
