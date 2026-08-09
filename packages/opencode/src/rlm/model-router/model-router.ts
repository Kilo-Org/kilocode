/**
 * Sara RLM — Model Router (Phase 2)
 *
 * Routes model selection for planner, executor, and aggregator roles.
 * Fallback chain: configured → agent model → provider default.
 */

import type { ModelRef, ModelRole } from "../config.js"

export type ResolvedModel = {
  providerID: string
  modelID: string
}

/**
 * Resolve a model for a given RLM role.
 *
 * @param role The RLM phase (planner, executor, aggregator)
 * @param configured Optional RLM model routing config
 * @param agentModel The task's agent default model
 * @returns The resolved model reference, or null if provider default should be used
 */
export function resolveModel(
  role: ModelRole,
  configured: Record<string, ModelRef> | undefined,
  agentModel: ResolvedModel | null,
): ResolvedModel | null {
  // 1. Check RLM-specific configuration
  if (configured?.[role]) {
    return {
      providerID: configured[role].providerID,
      modelID: configured[role].modelID,
    }
  }

  // 2. Fall back to the task's agent model
  if (agentModel) {
    return agentModel
  }

  // 3. Let the caller use provider default
  return null
}