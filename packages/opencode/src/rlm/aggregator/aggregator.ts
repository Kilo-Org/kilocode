/**
 * Sara RLM — Aggregator (Phase 2)
 *
 * Combines child RLMResults into a single parent result.
 * Supports two strategies: "concat" (deterministic) and "llm" (LLM-backed).
 */

import type { RLMResult } from "../result.js"
import type { RLMTask } from "../task.js"
import type { RLMContext } from "../context.js"
import { computeUsage } from "../result.js"
import { rlmExecutionError } from "../error.js"
import { concat } from "./strategies/concat.js"
import { aggregateWithLLM } from "./strategies/llm.js"
import { Effect } from "effect"
import { SessionPrompt } from "@/session/prompt"

export type AggregationStrategy = "concat" | "llm"

/**
 * Aggregate child results into a single parent result.
 */
export function aggregate(
  task: RLMTask,
  childResults: RLMResult[],
  ctx: RLMContext,
  strategy: AggregationStrategy = "concat",
) {
  return Effect.gen(function* () {
    if (childResults.length === 0) {
      // No children — should not happen, but handle gracefully
      return {
        taskID: task.id,
        status: "success" as const,
        output: task.prompt,
        summary: task.prompt.slice(0, 500),
        usage: computeUsage({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }),
        duration: Date.now() - task.createdAt,
      }
    }

    if (childResults.length === 1) {
      // Single child — just promote its result with accumulated cost
      const child = childResults[0]
      // Compute total from child result (which already includes its own children)
      return child
    }

    // Multiple children — aggregate
    switch (strategy) {
      case "concat":
        return concatResults(task, childResults)

      case "llm":
        return yield* aggregateWithLLM(task, childResults, ctx)

      default:
        return concatResults(task, childResults)
    }
  })
}

/**
 * Fallback: deterministic concatenation preserving child identity.
 */
function concatResults(task: RLMTask, childResults: RLMResult[]): RLMResult {
  const sections = childResults.map((r, i) => {
    const label = `[Subtask ${i + 1}]`
    return `${label}\n${r.output}`
  })

  const output = sections.join("\n\n---\n\n")

  // Sum all child usage
  let totalUsage = computeUsage({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

  for (const r of childResults) {
    totalUsage = {
      input: totalUsage.input + r.usage.input,
      output: totalUsage.output + r.usage.output,
      reasoning: totalUsage.reasoning + r.usage.reasoning,
      cache: {
        read: totalUsage.cache.read + r.usage.cache.read,
        write: totalUsage.cache.write + r.usage.cache.write,
      },
      total: totalUsage.total + r.usage.total,
    }
  }

  return {
    taskID: task.id,
    status: childResults.every((r) => r.status === "success") ? "success" : "partial",
    output,
    summary: output.slice(0, 500),
    usage: totalUsage,
    duration: Date.now() - task.createdAt,
  }
}