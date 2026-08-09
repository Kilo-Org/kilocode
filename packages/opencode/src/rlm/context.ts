/**
 * Sara RLM — Context (Phase 2 extended)
 *
 * RLMContext is execution-scoped state. NO Effect services.
 * Phase 2 adds: budget, permission, crossContext, plan.
 */

import type { SessionID } from "@/session/schema"
import type { RLMTask } from "./task.js"
import type { Agent } from "@/agent/agent"
import type { RLMConfig } from "./config.js"
import type { RLMBudget } from "./budget/budget.js"
import type { RLMPlan } from "./planner/schema.js"
import type { RLMCrossContext } from "./cross-context.js"

export interface RLMContext {
  readonly rootSessionID: SessionID
  readonly abort: AbortSignal
  task: RLMTask
  readonly config: RLMConfig
  readonly agent: Agent.Info
  readonly budget: RLMBudget | null
  readonly permission: unknown | null
  readonly crossContext: RLMCrossContext | null
  readonly plan: RLMPlan | null
}