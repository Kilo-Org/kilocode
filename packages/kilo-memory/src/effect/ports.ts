import type { Effect } from "effect"
import type { CaptureDiff } from "../capture/diff"
import type { MemoryError } from "./errors"

/** Runtime ports the capture pipeline depends on. The host (opencode) implements these against its
 * session store and LLM provider; the package orchestration stays free of `ai`/provider types by
 * treating the resolved model as an opaque handle and consuming pre-extracted turn primitives. */
export namespace MemoryPorts {
  export type ModelRef = { providerID: string; modelID: string }

  /** Pre-extracted view of the latest turn. All transcript/message-shape handling happens host-side
   * so the orchestrator never touches the host's message model. */
  export type TurnView = {
    user: string
    assistant: string
    recent: string
    lastAssistantID: string
    sessionModel: ModelRef
    /** True when the turn was answered from targeted recall (digesting it would echo memory back). */
    recalledMemory: boolean
    diffs: CaptureDiff[]
  }

  export interface SessionPort {
    readonly readTurn: (input: {
      sessionID: string
      window: number
    }) => Effect.Effect<TurnView | undefined, MemoryError>
    readonly get: (input: { sessionID: string }) => Effect.Effect<{ parentID?: string } | undefined, MemoryError>
  }

  /** Opaque resolved-model handle. Carries provider/language/options on the host side; the package
   * only passes it back to `run`. */
  export type ModelHandle = unknown

  export type ModelResolution = { handle: ModelHandle; fallback?: { reason: string } }

  export interface ModelPort {
    readonly resolve: (input: { configured?: string; session: ModelRef }) => Effect.Effect<ModelResolution, MemoryError>
    readonly run: (input: {
      handle: ModelHandle
      system: string
      prompt: string
      timeoutMs: number
      signal?: AbortSignal
    }) => Promise<{ text: string; usage: unknown }>
  }
}
