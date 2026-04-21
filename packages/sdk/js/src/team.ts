/**
 * Team types for external consumers of @devilcode/sdk.
 *
 * NOTE: Manual type definitions mirroring CLI Zod schemas.
 * No generate.ts exists — types defined directly here.
 * Keep in sync with packages/opencode/src/devilcode/team/config.ts
 */

export interface CanonicalPosition {
  id: string
  displayName: string
  description: string
  defaultCapabilities: string[]
  tier: number
  canDelegate: boolean
}

export interface CanonicalTeamRole {
  positionId: string
  displayName: string
  provider: string
  model: string
  effort: "max" | "xhigh" | "high" | "medium" | "low" | "default"
  tier: number
  canDelegate: string[]
  maxConcurrent: number
  capabilities: string[]
  supplementaryCapabilities?: string[]
}

export interface CanonicalTeamRouting {
  strategy: "hierarchical" | "flat"
  defaultRole: string
  escalationEnabled: boolean
  parentRole?: string
  reviewEscalationRole?: string
}

export interface DAGOverride {
  stages?: string[]
  capabilityOverrides?: Record<string, string[]>
}

export interface CanonicalTeamConfig {
  enabled: boolean
  roles: Record<string, CanonicalTeamRole>
  routing: CanonicalTeamRouting
  workflowOverride?: DAGOverride
}

export interface TeamHandle {
  id: string
  name: string
  path: string
  updatedAt: string
  isQuickstart: boolean
}

export interface AggregationResponse {
  successRateByTeam: Record<string, { completed: number; started: number; rate: number }>
  stallRateByPosition: Record<string, { maxWaitMs: number; avgWaitMs: number }>
  costByWorkflow: Array<{ workflowId: string; totalCost: number }>
  durationByStage: Record<string, { avgMs: number; p95Ms: number; count: number }>
  generatedAt: string
}
