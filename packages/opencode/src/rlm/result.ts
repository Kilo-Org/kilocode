/**
 * Sara RLM — Phase 1 Result Type
 *
 * RLMResult encapsulates the output of a single RLM task execution.
 * Phase 1: no child results, no aggregation, no tool call summaries.
 */

import type { RLMTaskID } from "./task.js"

// --- RLMTaskStatus ---

export type RLMTaskStatus = "success" | "partial" | "failure" | "cancelled"

// --- RLMTokenUsage ---
// Mirrors the existing SessionV1 token structure used by the agent loop.
// Total is derived from input + output + reasoning.

export interface RLMTokenUsage {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: {
    readonly read: number
    readonly write: number
  }
  readonly total: number
}

export function computeUsage(input: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }): RLMTokenUsage {
  return {
    input: input.input,
    output: input.output,
    reasoning: input.reasoning,
    cache: { read: input.cache.read, write: input.cache.write },
    total: input.input + input.output + input.reasoning,
  }
}

export function emptyUsage(): RLMTokenUsage {
  return { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 }
}

// --- RLMResult ---

export interface RLMResult {
  readonly taskID: RLMTaskID
  readonly status: RLMTaskStatus
  readonly output: string
  /** First 500 characters of output, deterministically derived. */
  readonly summary: string
  readonly usage: RLMTokenUsage
  /** Wall-clock duration in milliseconds. */
  readonly duration: number
}

// --- Helpers ---

export function createResult(input: {
  taskID: RLMTaskID
  status: RLMTaskStatus
  output: string
  usage: RLMTokenUsage
  duration: number
}): RLMResult {
  return {
    taskID: input.taskID,
    status: input.status,
    output: input.output,
    summary: input.output.slice(0, 500),
    usage: input.usage,
    duration: input.duration,
  }
}