/**
 * Sara RLM — Events (Phase 3 — compile repair)
 */
import { Effect, Context } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"

export const RLMEvent = {
  TaskCreated: "rlm.task.created" as const,
  TaskPlanGenerated: "rlm.task.plan_generated" as const,
  TaskPhaseTransition: "rlm.task.phase_transition" as const,
  TaskCompleted: "rlm.task.completed" as const,
  TaskFailed: "rlm.task.failed" as const,
  VerificationCompleted: "rlm.task.verification_completed" as const,
  ReinvestigationStarted: "rlm.task.reinvestigation_started" as const,
  BudgetExceeded: "rlm.budget.exceeded" as const,
} as const

export type RLMEventType = (typeof RLMEvent)[keyof typeof RLMEvent]

export interface RLMEventPayload {
  type: RLMEventType
  taskID: string
  timestamp: number
  [key: string]: unknown
}

/**
 * Publish an RLM event through EventV2Bridge.
 * The bridge service is accessed via Effect Context, typed loosely
 * to avoid exposing the full EventV2.Definition API before RLM
 * event schemas are stabilised.
 */
export function publishRLMEvent(
  events: { publish: ((_: any) => Effect.Effect<void>) },
  payload: RLMEventPayload,
): Effect.Effect<void, never, never> {
  return Effect.ignore(events.publish(payload))
}