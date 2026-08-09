/**
 * Sara RLM — Planner (Phase 2)
 *
 * Calls the LLM to produce a structured decomposition plan.
 * Always validates output before returning.
 */

import type { RLMPlan, RLMChildSpec } from "./schema.js"
import { validateDecomposePlan } from "./schema.js"
import { buildPlannerPrompt } from "./prompt.js"
import { rlmPlanningError } from "../error.js"
import type { RLMTask } from "../task.js"
import type { RLMContext } from "../context.js"
import { Effect, Cause } from "effect"
import { SessionPrompt } from "@/session/prompt"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

/**
 * Invoke the planner agent to produce a decomposition plan.
 * If maxDepth is reached, skips the LLM call and returns { strategy: "execute" }.
 */
export function plan(task: RLMTask, ctx: RLMContext) {
  return Effect.gen(function* () {
    const maxDepth = ctx.config.maxDepth ?? 4

    // If we're at or beyond max depth, execute directly
    if (task.depth >= maxDepth) {
      return { strategy: "execute" as const, rationale: `Depth ${task.depth} >= maxDepth ${maxDepth}` }
    }

    const promptSvc = yield* SessionPrompt.Service
    const providerSvc = yield* Provider.Service

    // Use the planner model or fall back to agent model
    const plannedModel = ctx.config.modelRouting?.planner ?? ctx.agent.model
    const model = plannedModel ?? (yield* providerSvc.defaultModel().pipe(Effect.orDie))

    // Build planner prompt
    const crossContextStr = ctx.crossContext
      ? JSON.stringify(ctx.crossContext, null, 2)
      : undefined
    const promptText = buildPlannerPrompt({
      description: task.description,
      prompt: task.prompt,
      depth: task.depth,
      maxDepth,
      crossContext: crossContextStr,
    })

    // Call the LLM through the existing session prompt
    const plannerInput = {
      sessionID: task.sessionID,
      agent: ctx.agent.name, // Use the agent resolved by the runtime (same agent as leaf execution)
      model: {
        providerID: ProviderV2.ID.make(model.providerID),
        modelID: ModelV2.ID.make(model.modelID),
      },
      parts: [
        {
          type: "text" as const,
          text: promptText,
        },
      ],
    }

    const result = yield* promptSvc
      .prompt(plannerInput as SessionPrompt.PromptInput)
      .pipe(
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          Effect.fail(rlmPlanningError("Planner LLM call failed", { cause: Cause.squash(cause) })),
        ),
        Effect.onInterrupt(() =>
          Effect.fail(rlmPlanningError("Planner interrupted")),
        ),
      )

    // Extract the response text
    const narrow = (result as unknown) as any
    const parts = (narrow.parts as Array<{ type: string; text: string; synthetic?: boolean }>)
    const textParts = parts
      .filter((p: { type: string; synthetic?: boolean }) => p.type === "text" && p.synthetic !== true)
      .map((p: { text: string }) => p.text ?? "")
    const responseText = textParts.join("\n").trim()

    // Parse JSON from the planner response
    let parsed: any
    try {
      parsed = JSON.parse(responseText)
    } catch (e) {
      return yield* Effect.fail(
        rlmPlanningError("Planner did not return valid JSON", {
          reason: responseText.slice(0, 200),
          cause: e,
        }),
      )
    }

    // Validate plan structure
    if (!parsed.strategy || !["execute", "decompose"].includes(parsed.strategy)) {
      return yield* Effect.fail(
        rlmPlanningError("Planner returned invalid strategy", {
          reason: `strategy must be "execute" or "decompose", got: ${String(parsed.strategy)}`,
        }),
      )
    }

    if (parsed.strategy === "execute") {
      return {
        strategy: "execute" as const,
        rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
      }
    }

    // Validate decompose plan
    const children = Array.isArray(parsed.children) ? parsed.children : []
    if (children.length === 0) {
      return yield* Effect.fail(
        rlmPlanningError("Decompose strategy must have at least 1 child"),
      )
    }

    const spec: RLMChildSpec[] = children.map((c: any, i: number) => ({
      description: String(c.description ?? ""),
      prompt: String(c.prompt ?? ""),
      parallelizable: Boolean(c.parallelizable),
      dependsOn: Array.isArray(c.dependsOn) ? c.dependsOn.map((d: any) => Number(d)) : [],
    }))

    const errors = validateDecomposePlan(spec)
    if (errors.length > 0) {
      return yield* Effect.fail(
        rlmPlanningError("Invalid decomposition plan", {
          reason: errors.map((e) => e.message).join("; "),
        }),
      )
    }

    return {
      strategy: "decompose" as const,
      children: spec,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined,
    }
  })
}