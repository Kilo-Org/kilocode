/**
 * Sara RLM — Task Type (Phase 2 extended)
 *
 * RLMTask is the unit of work tracked by the RLM runtime.
 * Phase 2 adds: parentID, children, planning/aggregating phases,
 * and usage accumulators for budget tracking.
 */

import type { SessionID } from "@/session/schema"
import { Identifier } from "@opencode-ai/core/util/identifier"

// --- RLMTaskID ---

export type RLMTaskID = string & { readonly __brand: "RLMTaskID" }

export const RLMTaskID = {
  create: (id?: string): RLMTaskID => (id ?? `rlmtsk_${Identifier.ascending()}`) as RLMTaskID,
  make: (id: string): RLMTaskID => id as RLMTaskID,
}

// --- RLMTaskPhase (Phase 2 extended) ---

export type RLMTaskPhase =
  | "pending"
  | "planning"
  | "executing"
  | "aggregating"
  | "verifying"
  | "reinvestigating"
  | "completed"
  | "failed"

// --- RLMTask (Phase 2 extended) ---

export interface RLMTask {
  readonly id: RLMTaskID
  readonly sessionID: SessionID
  readonly parentID: RLMTaskID | null
  children: RLMTaskID[]
  readonly description: string
  readonly prompt: string
  readonly depth: number
  phase: RLMTaskPhase
  result: unknown | null
  readonly createdAt: number
  completedAt: number
}

// --- Factory ---

export function createTask(input: {
  sessionID: SessionID
  parentID?: RLMTaskID | null
  description: string
  prompt: string
  depth?: number
}): RLMTask {
  return {
    id: RLMTaskID.create(),
    sessionID: input.sessionID,
    parentID: input.parentID ?? null,
    children: [],
    description: input.description,
    prompt: input.prompt,
    depth: input.depth ?? 0,
    phase: "pending",
    result: null,
    createdAt: Date.now(),
    completedAt: 0,
  }
}