/**
 * Sara RLM — RLMNode (Phase 4 — compile repair)
 */
import type { RLMTask, RLMTaskID, RLMTaskPhase } from "./task.js"
import { createTask } from "./task.js"
import type { RLMContext } from "./context.js"
import type { RLMResult } from "./result.js"
import { rlmExecutionError, rlmPlanningError, rlmVerificationError } from "./error.js"
import { plan } from "./planner/planner.js"
import { schedule } from "./scheduler.js"
import { run as executeAgent } from "./executor.js"
import { aggregate } from "./aggregator/aggregator.js"
import { verify } from "./verifier/verifier.js"
import { RLMEvent, publishRLMEvent, type RLMEventType, type RLMEventPayload } from "./event.js"
import { Effect, Cause, Context, Layer } from "effect"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"

export interface Interface {
  readonly executeNode: (
    task: RLMTask,
    ctx: RLMContext,
  ) => Effect.Effect<any, any, any>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RLM/Node") {}

export const layer: Layer.Layer<Service, never, EventV2Bridge.Service> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events: any = yield* EventV2Bridge.Service

    const emit = (type: RLMEventType, data: Record<string, unknown>) => {
      const payload: RLMEventPayload = { type, taskID: String(data.taskID ?? ""), timestamp: Date.now(), ...data }
      return publishRLMEvent({ publish: (d: unknown) => (events as any).publish(d) }, payload)
    }

    const transition = (task: RLMTask, to: RLMTaskPhase) =>
      Effect.gen(function* () {
        const from = task.phase
        task.phase = to
        yield* emit(RLMEvent.TaskPhaseTransition, { taskID: task.id, from, to })
      })

    // Recursive executor — Effect.gen without explicit return type avoids Generator/Effect mismatch
    const executeNode = (task: RLMTask, ctx: RLMContext): any =>
      Effect.gen(function* () {
        const maxDepth = ctx.config.maxDepth ?? 4
        const maxReinvestigations = ctx.config.maxReinvestigations ?? 2
        let reinvestigationCount = 0

        while (true) {
          if (task.phase !== "planning" && task.phase !== "reinvestigating") {
            yield* transition(task, "planning")
          }

          let planResult: any

          if (task.depth >= maxDepth || reinvestigationCount > 0) {
            planResult = { strategy: "execute", rationale: `Direct (depth ${task.depth}/${maxDepth})` }
          } else {
            planResult = (yield* plan(task, ctx).pipe(
              // Planner failures must be observable, not silently converted into leaf execution.
              Effect.catchCause((cause: Cause.Cause<unknown>) =>
                Effect.fail(rlmPlanningError("Planner failed", { cause: Cause.squash(cause) })),
              ),
            )) as any
          }

          yield* emit(RLMEvent.TaskPlanGenerated, {
            taskID: task.id,
            strategy: planResult.strategy,
            childCount: planResult.strategy === "decompose" ? (planResult.children?.length ?? 0) : 0,
            rationale: planResult.rationale ?? null,
          })

          let result: RLMResult

          if (planResult.strategy === "execute") {
            yield* transition(task, "executing")
            result = (yield* executeAgent(task, ctx).pipe(
              Effect.catchCause((cause: unknown) =>
                Effect.fail(rlmExecutionError("Execution failed", { cause })),
              ),
            )) as unknown as RLMResult
          } else {
            yield* transition(task, "executing")

            const childSpecs: any[] = planResult.children ?? []
            const waves = schedule(childSpecs)
            const childIDs: RLMTaskID[] = childSpecs.map(() =>
              createTask({ sessionID: task.sessionID, parentID: task.id, description: "", prompt: "", depth: task.depth + 1 }).id,
            )
            const allChildResults: RLMResult[] = []

            for (const wave of waves) {
              const waveEffects = wave.children.map((index: number) =>
                Effect.gen(function* () {
                  const spec = childSpecs[index]
                  const id = childIDs[index]
                  const childTask = createTask({ sessionID: task.sessionID, parentID: task.id, description: spec.description, prompt: spec.prompt, depth: task.depth + 1 })
                  ;(childTask as unknown as Record<string, unknown>).id = id

                  yield* emit(RLMEvent.TaskCreated, { taskID: id, parentID: task.id, sessionID: task.sessionID, description: spec.description, depth: task.depth + 1 })

                  const childCtx: RLMContext = { ...ctx, task: childTask, plan: null, permission: null }
                  return (yield* executeNode(childTask, childCtx).pipe(
                    Effect.map((cr: any) => {
                      allChildResults.push(cr)
                      if (ctx.crossContext) ctx.crossContext.add(id, spec.description, cr.summary)
                      return cr
                    }),
                    Effect.catchCause((cause: unknown) => {
                      const msg = (cause as any)?.message ?? String(cause)
                      const pr: RLMResult = { taskID: id, status: "failure", output: `Child failed: ${msg}`, summary: `Error: ${msg}`.slice(0, 500), usage: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 }, total: 0 }, duration: 0 }
                      allChildResults.push(pr)
                      if (ctx.crossContext) ctx.crossContext.add(id, spec.description, `FAILED: ${msg}`)
                      return Effect.succeed(pr)
                    }),
                  )) as unknown as RLMResult
                }),
              )
              yield* Effect.all(waveEffects, { concurrency: "unbounded" })
            }

            task.children = childIDs as any
            yield* transition(task, "aggregating")
            result = (yield* aggregate(task, allChildResults, ctx, "concat")) as unknown as RLMResult
          }

          if (ctx.config.verification?.enabled !== false) {
            yield* transition(task, "verifying")
            const verification: any = (yield* (verify(result as unknown as any, task.description, ctx) as any).pipe(
              // Verifier failures must be observable — never silently become PASS.
              Effect.catchCause((cause: Cause.Cause<unknown>) =>
                Effect.fail(rlmVerificationError("Verifier failed", { cause: Cause.squash(cause) })),
              ),
            )) as any

            yield* emit(RLMEvent.VerificationCompleted, { taskID: task.id, verdict: verification.verdict, confidence: verification.confidence })

            if (verification.verdict === "reinvestigate" && reinvestigationCount < maxReinvestigations) {
              reinvestigationCount++
              yield* transition(task, "reinvestigating")
              yield* emit(RLMEvent.ReinvestigationStarted, { taskID: task.id, attempt: reinvestigationCount, maxAttempts: maxReinvestigations, reason: verification.reasoning })
              continue
            }
            if (verification.verdict === "fail") {
              task.phase = "failed"
              task.result = result
              task.completedAt = Date.now()
              yield* emit(RLMEvent.TaskFailed, { taskID: task.id, error: verification.reasoning, phase: "verifying" })
              return result
            }
          }

          task.phase = "completed"
          task.result = result
          task.completedAt = Date.now()
          yield* emit(RLMEvent.TaskCompleted, { taskID: task.id, status: result.status, outputLength: result.output.length, usage: result.usage, duration: result.duration })
          return result
        }
      })

    return Service.of({ executeNode })
  }),
)