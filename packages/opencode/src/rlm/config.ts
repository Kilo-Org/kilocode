/**
 * Sara RLM — Config (Phase 3 extended)
 *
 * RLM configuration schema with verification, reinvestigation, and routing support.
 */

export type ModelRole = "planner" | "executor" | "aggregator" | "verifier"

export interface ModelRef {
  readonly providerID: string
  readonly modelID: string
}

export interface RLMConfig {
  readonly enabled: boolean
  readonly budget?: { readonly maxTokens: number }
  readonly maxDepth?: number
  readonly maxReinvestigations?: number
  readonly modelRouting?: Partial<Record<ModelRole, ModelRef>>
  readonly verification?: { readonly enabled?: boolean }
}

export const DEFAULT_RLM_CONFIG: RLMConfig = {
  enabled: false,
  maxDepth: 4,
  maxReinvestigations: 2,
  verification: { enabled: true },
}

export function fromConfig(config: unknown): RLMConfig {
  const raw = (config as Record<string, unknown> | undefined)?.rlm
  if (!raw || typeof raw !== "object") return DEFAULT_RLM_CONFIG
  const r = raw as Record<string, unknown>

  return {
    enabled: r.enabled === true,
    budget: r.budget && typeof r.budget === "object"
      ? { maxTokens: Number((r.budget as Record<string, unknown>).maxTokens ?? 0) }
      : undefined,
    maxDepth: typeof r.maxDepth === "number" && r.maxDepth > 0 ? r.maxDepth : DEFAULT_RLM_CONFIG.maxDepth,
    maxReinvestigations: typeof r.maxReinvestigations === "number" && r.maxReinvestigations >= 0
      ? r.maxReinvestigations
      : DEFAULT_RLM_CONFIG.maxReinvestigations,
    modelRouting: r.modelRouting && typeof r.modelRouting === "object"
      ? r.modelRouting as Partial<Record<ModelRole, ModelRef>>
      : undefined,
    verification: { enabled: r.verification !== false },
  }
}