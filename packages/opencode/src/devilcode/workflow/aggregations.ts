// devilcode_change - new file
// Compute telemetry aggregations from the append-only event log.
import { EventLogger } from "./events"
import type { WorkflowEvent } from "./events"

export interface AggregationResponse {
  successRateByTeam: Record<string, { completed: number; started: number; rate: number }>
  stallRateByPosition: Record<string, { maxWaitMs: number; avgWaitMs: number }>
  costByWorkflow: Array<{ workflowId: string; totalCost: number }>
  durationByStage: Record<string, { avgMs: number; p95Ms: number; count: number }>
  generatedAt: string
}

/**
 * Build a zero-initialized AggregationResponse for use when there are no events.
 */
export function emptyAggregations(): AggregationResponse {
  return {
    successRateByTeam: {},
    stallRateByPosition: {},
    costByWorkflow: [],
    durationByStage: {},
    generatedAt: new Date().toISOString(),
  }
}

/** Calculate the p95 value of an array of numbers. Returns 0 for empty arrays. */
function p95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor(sorted.length * 0.95)
  return sorted[Math.min(idx, sorted.length - 1)]!
}

/** Compute aggregation metrics from a (possibly pre-filtered) events array. */
export function computeAggregationsFromEvents(events: WorkflowEvent[]): AggregationResponse {
  // --- success rate by team ---
  const successRateByTeam: Record<string, { completed: number; started: number; rate: number }> = {}

  function ensureTeam(teamId: string) {
    if (!successRateByTeam[teamId]) {
      successRateByTeam[teamId] = { completed: 0, started: 0, rate: 0 }
    }
    return successRateByTeam[teamId]!
  }

  // --- stall rate by position/role ---
  // Track pending task_started events keyed by taskId, value = { role, startedAt }
  const pendingStarts: Record<string, { role: string; startedAt: number }> = {}
  const stallWaits: Record<string, number[]> = {}

  // --- cost by workflow ---
  const costByWorkflowMap: Record<string, number> = {}

  // --- duration by stage ---
  const durationsByStage: Record<string, number[]> = {}

  for (const event of events) {
    const teamId = (event.metadata?.teamId as string | undefined) ?? "default"
    const role = event.role ?? "unknown"
    const taskId = event.taskId ?? ""

    if (event.eventType === "task_started") {
      ensureTeam(teamId).started += 1
      if (taskId) {
        pendingStarts[taskId] = { role, startedAt: event.timestamp ? Date.parse(event.timestamp) : Date.now() }
      }
    } else if (event.eventType === "task_completed") {
      const entry = ensureTeam(teamId)
      entry.completed += 1
      entry.rate = entry.started > 0 ? entry.completed / entry.started : 0

      // Stall rate: compute wait from paired task_started
      if (taskId && pendingStarts[taskId]) {
        const pending = pendingStarts[taskId]!
        const completedAt = event.timestamp ? Date.parse(event.timestamp) : Date.now()
        const waitMs = completedAt - pending.startedAt
        const r = pending.role
        if (!stallWaits[r]) stallWaits[r] = []
        stallWaits[r]!.push(waitMs)
        delete pendingStarts[taskId]
      }
    }

    // Cost aggregation
    const workflowId = (event.metadata?.workflowId as string | undefined) ?? "default"
    const cost = typeof event.metadata?.cost === "number" ? (event.metadata.cost as number) : 0
    if (cost > 0) {
      costByWorkflowMap[workflowId] = (costByWorkflowMap[workflowId] ?? 0) + cost
    }

    // Duration by stage
    const stage = (event.metadata?.stage as string | undefined) ?? undefined
    const durationMs = event.durationMs
    if (stage && typeof durationMs === "number" && durationMs >= 0) {
      if (!durationsByStage[stage]) durationsByStage[stage] = []
      durationsByStage[stage]!.push(durationMs)
    }
  }

  // Finalize success rates (update rate for all teams after iterating)
  for (const entry of Object.values(successRateByTeam)) {
    entry.rate = entry.started > 0 ? entry.completed / entry.started : 0
  }

  // Build stallRateByPosition
  const stallRateByPosition: Record<string, { maxWaitMs: number; avgWaitMs: number }> = {}
  for (const [r, waits] of Object.entries(stallWaits)) {
    const max = Math.max(...waits)
    const avg = waits.reduce((s, v) => s + v, 0) / waits.length
    stallRateByPosition[r] = { maxWaitMs: max, avgWaitMs: avg }
  }

  // Build costByWorkflow
  const costByWorkflow = Object.entries(costByWorkflowMap).map(([workflowId, totalCost]) => ({
    workflowId,
    totalCost,
  }))

  // Build durationByStage
  const durationByStage: Record<string, { avgMs: number; p95Ms: number; count: number }> = {}
  for (const [stage, durations] of Object.entries(durationsByStage)) {
    const avg = durations.reduce((s, v) => s + v, 0) / durations.length
    durationByStage[stage] = {
      avgMs: avg,
      p95Ms: p95(durations),
      count: durations.length,
    }
  }

  return {
    successRateByTeam,
    stallRateByPosition,
    costByWorkflow,
    durationByStage,
    generatedAt: new Date().toISOString(),
  }
}

export interface ComputeAggregationsOptions {
  /** Only include events at or after this ISO timestamp. */
  since?: string
  /** Maximum number of events to process (default: 10000). */
  limit?: number
}

/**
 * Read events from the event log in planningDir and compute aggregation metrics.
 * Returns zero-initialized response when the event log is empty or missing.
 */
export async function computeAggregations(
  planningDir: string,
  options: ComputeAggregationsOptions = {},
): Promise<AggregationResponse> {
  const logger = new EventLogger(planningDir)
  let events = await logger.readAll()

  // Apply since filter
  if (options.since) {
    const sinceMs = Date.parse(options.since)
    if (!isNaN(sinceMs)) {
      events = events.filter((e) => {
        if (!e.timestamp) return true
        return Date.parse(e.timestamp) >= sinceMs
      })
    }
  }

  // Apply limit (default: 10000)
  const limit = options.limit ?? 10000
  if (events.length > limit) {
    events = events.slice(-limit)
  }

  if (events.length === 0) {
    return emptyAggregations()
  }

  return computeAggregationsFromEvents(events)
}
