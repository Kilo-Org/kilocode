/**
 * Sara RLM — Runtime (Phase 2 extended — compile repair)
 */
import type { RLMError } from "./error.js"
import { rlmAgentNotFound, rlmExecutionError } from "./error.js"
import { createTask } from "./task.js"
import type { RLMContext } from "./context.js"
import { run as executeLeaf } from "./executor.js"
import { fromConfig } from "./config.js"
import type { SessionID } from "@/session/schema"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Effect, Cause, Option } from "effect"
import { RLMCrossContext } from "./cross-context.js"
import { RLMBudget } from "./budget/budget.js"

export interface RLMRuntimeInput {
  readonly sessionID: SessionID
  readonly agent?: string
  readonly description: string
  readonly prompt: string
}

// sara_rlm - reentry guard for the runLoop integration. While an RLM
// orchestration is running for a session, its internal planner/executor/
// verifier prompts run their own loops on the same session. Those loops must
// NOT re-trigger the runLoop-level rlmExecute hook, or the orchestration
// recurses into itself indefinitely.
const activeSessions = new Set<string>()

/** True while an RLM orchestration is running for this session. */
export function isRlmActive(sessionID: string): boolean {
  return activeSessions.has(sessionID)
}

export function execute(input: RLMRuntimeInput) {
  return Effect.gen(function* () {
    activeSessions.add(input.sessionID)
    const agentSvc = yield* Agent.Service
    let agentInfo: Agent.Info
    if (input.agent) {
      agentInfo = (yield* agentSvc.get(input.agent).pipe(
        Effect.catchCause((cause: Cause.Cause<unknown>) =>
          Effect.fail(rlmAgentNotFound("Agent not found: " + input.agent, { agentName: input.agent, cause: Cause.squash(cause) })),
        ),
      )) as unknown as Agent.Info
    } else {
      agentInfo = yield* agentSvc.defaultInfo()
    }

    const configSvc = yield* Config.Service
    const configInfo = yield* configSvc.get()
    const rlmConfig = fromConfig(configInfo)

    const task = createTask({
      sessionID: input.sessionID,
      description: input.description,
      prompt: input.prompt,
      depth: 0,
    })

    let budget: RLMBudget | null = null
    if (rlmConfig.budget?.maxTokens) {
      budget = new RLMBudget(rlmConfig.budget.maxTokens)
    }

    const controller = new AbortController()
    const ctx: RLMContext = {
      rootSessionID: input.sessionID,
      abort: controller.signal,
      task,
      config: rlmConfig,
      agent: agentInfo,
      budget,
      permission: null,
      crossContext: rlmConfig.enabled ? new RLMCrossContext() : null,
      plan: null,
    }

    const rawResult = rlmConfig.enabled
      ? (yield* Effect.serviceOption((yield* Effect.promise<{ Service: typeof import("./node.js").Service }>(() => import("./node.js"))).Service).pipe(
          Effect.flatMap((svc) =>
            Option.isSome(svc as any) ? (svc as any).value.executeNode(task, ctx) : executeLeaf(task, ctx),
          ),
          // RLM failures must remain observable. Do not silently degrade a real
          // node/planner/executor failure into a bare leaf retry.
          Effect.catchCause((cause: Cause.Cause<unknown>) =>
            Effect.fail(rlmExecutionError("Node execution failed", { cause: Cause.squash(cause) })),
          ),
        ))
      : (yield* executeLeaf(task, ctx).pipe(
          Effect.catchCause((cause: Cause.Cause<unknown>) => {
            task.phase = "failed"
            task.completedAt = Date.now()
            return Effect.fail(rlmExecutionError("Leaf execution failed", { cause: Cause.squash(cause) }))
          }),
        ))

    // narrow result through unknown
    const result = (rawResult as unknown) as Record<string, unknown> | null

    if (result && task.phase !== "failed") {
      task.phase = "completed"
      task.result = result
      task.completedAt = Date.now()
    }

    return result
  }).pipe(
    Effect.onExit(() => Effect.sync(() => activeSessions.delete(input.sessionID))),
  )
}