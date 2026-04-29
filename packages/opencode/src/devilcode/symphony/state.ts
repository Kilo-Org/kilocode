import type { RunningEntry, RetryEntry, TokenAccounting } from "./types"
import type { WorkerHandle } from "./worker"
import type { SymphonyConfig } from "./config/schema"

export interface OrchestratorState {
  running: Map<string, { entry: RunningEntry; handle: WorkerHandle }>
  claimed: Set<string>
  retryQueue: Map<string, RetryEntry & { timerHandle: ReturnType<typeof setTimeout> }>
  tokenTotals: TokenAccounting
  rateLimits: unknown | null
}

export function createState(): OrchestratorState {
  return {
    running: new Map(),
    claimed: new Set(),
    retryQueue: new Map(),
    tokenTotals: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      secondsRunning: 0,
    },
    rateLimits: null,
  }
}

export function availableSlots(state: OrchestratorState, config: SymphonyConfig): number {
  return Math.max(config.agent.max_concurrent_agents - state.running.size, 0)
}

export function availableSlotsForState(
  state: OrchestratorState,
  issueState: string,
  config: SymphonyConfig,
): number {
  const global = availableSlots(state, config)
  const byState = config.agent.max_concurrent_agents_by_state
  const stateKey = issueState.toLowerCase()
  const stateLimit = byState[stateKey]
  if (stateLimit === undefined) return global

  const countInState = Array.from(state.running.values()).filter(
    (r) => r.entry.state.toLowerCase() === stateKey,
  ).length
  const stateSlots = Math.max(stateLimit - countInState, 0)
  return Math.min(global, stateSlots)
}

export function claimIssue(state: OrchestratorState, issueId: string): void {
  state.claimed.add(issueId)
}

export function releaseIssue(state: OrchestratorState, issueId: string): void {
  state.claimed.delete(issueId)
  state.running.delete(issueId)
  const retry = state.retryQueue.get(issueId)
  if (retry) {
    clearTimeout(retry.timerHandle)
    state.retryQueue.delete(issueId)
  }
}

export function addRunning(
  state: OrchestratorState,
  issueId: string,
  entry: RunningEntry,
  handle: WorkerHandle,
): void {
  state.running.set(issueId, { entry, handle })
}

export function removeRunning(state: OrchestratorState, issueId: string): void {
  state.running.delete(issueId)
}

export function updateTokenTotals(state: OrchestratorState, entry: RunningEntry): void {
  state.tokenTotals.inputTokens += entry.tokens.input
  state.tokenTotals.outputTokens += entry.tokens.output
  state.tokenTotals.totalTokens += entry.tokens.total
}
