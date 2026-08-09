/**
 * Deterministic concat aggregation.
 * Simply joins child outputs with labeled separators.
 */

import type { RLMResult } from "../../result.js"
import type { RLMTaskID } from "../../task.js"

export function concat(taskID: RLMTaskID, childResults: RLMResult[]): RLMResult {
  const sections = childResults.map((r, i) => `[Subtask ${i + 1}]\n${r.output}`)
  const output = sections.join("\n\n---\n\n")

  let totalInput = 0
  let totalOutput = 0
  let totalReasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let totalTokens = 0

  for (const r of childResults) {
    totalInput += r.usage.input
    totalOutput += r.usage.output
    totalReasoning += r.usage.reasoning
    cacheRead += r.usage.cache.read
    cacheWrite += r.usage.cache.write
    totalTokens += r.usage.total
  }

  return {
    taskID,
    status: childResults.every((r) => r.status === "success") ? "success" : "partial",
    output,
    summary: output.slice(0, 500),
    usage: {
      input: totalInput,
      output: totalOutput,
      reasoning: totalReasoning,
      cache: { read: cacheRead, write: cacheWrite },
      total: totalTokens,
    },
    duration: 0, // caller sets this
  }
}