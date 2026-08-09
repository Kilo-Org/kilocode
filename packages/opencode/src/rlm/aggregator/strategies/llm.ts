/**
 * LLM-backed aggregation strategy.
 * Calls the LLM to synthesize child results into a unified summary.
 */

import type { RLMResult } from "../../result.js"
import type { RLMTask } from "../../task.js"
import type { RLMContext } from "../../context.js"
import { computeUsage } from "../../result.js"
import { rlmExecutionError } from "../../error.js"
import { Effect, Cause } from "effect"
import { SessionPrompt } from "@/session/prompt"
import { Provider } from "@/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

export function aggregateWithLLM(
  task: RLMTask,
  childResults: RLMResult[],
  ctx: RLMContext,
) {
  return Effect.gen(function* () {
    const promptSvc = yield* SessionPrompt.Service
    const providerSvc = yield* Provider.Service

    const model = ctx.agent.model ?? (yield* providerSvc.defaultModel().pipe(Effect.orDie))

    // Build aggregation prompt
    const childSections = childResults
      .map((r, i) => `### Subtask ${i + 1}\n${r.output}`)
      .join("\n\n")

    const prompt = `Synthesize the following subtask results into a unified, coherent report.

Original task: ${task.description}

${childSections}

---
Provide a well-structured summary that:
1. Integrates findings from all subtasks
2. Highlights key conclusions
3. Notes any conflicts or gaps between subtask outputs
4. Is suitable as the final answer to the original task

Return ONLY the synthesized report text. No JSON, no metadata.`

    const aggInput = {
      sessionID: task.sessionID,
      agent: ctx.agent.name, // Use the agent resolved by the runtime (same agent as leaf execution)
      model: {
        providerID: ProviderV2.ID.make(model.providerID),
        modelID: ModelV2.ID.make(model.modelID),
      },
      parts: [{ type: "text" as const, text: prompt }],
    }

    const result = yield* promptSvc
      .prompt(aggInput as SessionPrompt.PromptInput)
      .pipe(
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          Effect.fail(rlmExecutionError("LLM aggregation failed", { cause: Cause.squash(cause) })),
        ),
        Effect.onInterrupt(() =>
          Effect.fail(rlmExecutionError("LLM aggregation interrupted")),
        ),
      )

    // Extract synthesis text
    const narrow = (result as unknown) as any
    const parts = (narrow.parts as Array<{ type: string; text: string; synthetic?: boolean }>)
    const synthesis = parts
      .filter((p: { type: string; synthetic?: boolean }) => p.type === "text" && p.synthetic !== true)
      .map((p: { text: string }) => p.text ?? "")
      .join("\n")
      .trim()

    // Sum all child usage plus the aggregation call cost
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

    // Add aggregation call cost if available
    if (narrow.info?.role === "assistant") {
      const asst = narrow.info
      totalInput += asst.tokens.input
      totalOutput += asst.tokens.output
      totalReasoning += asst.tokens.reasoning
      cacheRead += asst.tokens.cache.read
      cacheWrite += asst.tokens.cache.write
      totalTokens += asst.tokens.input + asst.tokens.output + asst.tokens.reasoning
    }

    return {
      taskID: task.id,
      status: childResults.every((r) => r.status === "success") ? "success" : "partial",
      output: synthesis || "(no output)",
      summary: (synthesis || "(no output)").slice(0, 500),
      usage: {
        input: totalInput,
        output: totalOutput,
        reasoning: totalReasoning,
        cache: { read: cacheRead, write: cacheWrite },
        total: totalTokens,
      },
      duration: Date.now() - task.createdAt,
    }
  })
}