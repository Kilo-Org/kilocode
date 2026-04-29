import { Bus } from "@/bus"
import { SymphonyEvent } from "./events"
import { SymphonyConfigError, SymphonyStallError } from "./errors"
import {
  createState,
  availableSlots,
  availableSlotsForState,
  claimIssue,
  releaseIssue,
  addRunning,
  removeRunning,
  updateTokenTotals,
  type OrchestratorState,
} from "./state"
import { startWorker } from "./worker"
import { WorkspaceManager } from "./workspace/manager"
import type { SymphonyConfig } from "./config/schema"
import type { Tracker } from "./tracker/tracker"
import type { TrackerIssue } from "./tracker/types"
import { Log } from "@/util/log"

const log = Log.create({ service: "symphony.orchestrator" })

export interface OrchestratorHandle {
  start(): Promise<void>
  stop(): Promise<void>
  refresh(): Promise<void>
  getState(): OrchestratorSnapshot
  updateConfig(config: SymphonyConfig, promptTemplate: string): void
}

export interface OrchestratorSnapshot {
  generatedAt: string
  counts: { running: number; retrying: number }
  running: Array<{
    issueId: string
    identifier: string
    state: string
    sessionId: string
    turnCount: number
    startedAt: number
    lastEventAt: number
    tokens: { input: number; output: number; total: number }
  }>
  retrying: Array<{
    issueId: string
    identifier: string
    attempt: number
    dueAt: number
    error: string
  }>
  tokenTotals: { inputTokens: number; outputTokens: number; totalTokens: number; secondsRunning: number }
  rateLimits: unknown | null
}

function sortCandidates(issues: TrackerIssue[]): TrackerIssue[] {
  return [...issues].sort((a, b) => {
    const priA = a.priority ?? Number.MAX_SAFE_INTEGER
    const priB = b.priority ?? Number.MAX_SAFE_INTEGER
    if (priA !== priB) return priA - priB
    const timeA = new Date(a.createdAt).getTime()
    const timeB = new Date(b.createdAt).getTime()
    if (timeA !== timeB) return timeA - timeB
    return a.identifier.localeCompare(b.identifier)
  })
}

function isEligible(
  issue: TrackerIssue,
  state: OrchestratorState,
  config: SymphonyConfig,
): boolean {
  if (!issue.id || !issue.identifier || !issue.title || !issue.state) return false
  if (config.tracker.terminal_states.includes(issue.state)) return false
  if (!config.tracker.active_states.includes(issue.state)) return false
  if (state.running.has(issue.id) || state.claimed.has(issue.id)) return false
  if (state.retryQueue.has(issue.id)) return false

  if (issue.state === "Todo" && issue.blockedBy.length > 0) {
    const hasNonTerminalBlocker = issue.blockedBy.some(
      (b) => !config.tracker.terminal_states.includes(b.state),
    )
    if (hasNonTerminalBlocker) return false
  }

  return true
}

function computeRetryDelay(attempt: number, maxBackoffMs: number): number {
  if (attempt <= 0) return 1000
  return Math.min(10000 * Math.pow(2, attempt - 1), maxBackoffMs)
}

export function createOrchestrator(
  tracker: Tracker,
  initialConfig: SymphonyConfig,
  initialPromptTemplate: string,
): OrchestratorHandle {
  let config = initialConfig
  let promptTemplate = initialPromptTemplate
  const state = createState()
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let running = false

  async function reconcile(): Promise<void> {
    if (state.running.size === 0) return

    const issueIds = Array.from(state.running.keys())
    let currentStates: Map<string, string>

    try {
      currentStates = await tracker.fetchIssueStates(issueIds)
    } catch (e) {
      log.error("Failed to fetch issue states during reconciliation", { error: e })
      return
    }

    const now = Date.now()
    for (const [issueId, { entry, handle }] of state.running) {
      const currentState = currentStates.get(issueId)

      if (currentState && config.tracker.terminal_states.includes(currentState)) {
        log.info(`Issue ${entry.identifier} reached terminal state: ${currentState}`)
        await handle.stop()
        updateTokenTotals(state, handle.getStatus())
        releaseIssue(state, issueId)
        await WorkspaceManager.cleanup(entry.identifier, config).catch((e) =>
          log.error(`Failed to cleanup workspace for ${entry.identifier}`, { error: e }),
        )
        Bus.publish(SymphonyEvent.WorkerCompleted, {
          issueId,
          identifier: entry.identifier,
          sessionId: entry.sessionId,
          turnCount: handle.getStatus().turnCount,
          inputTokens: handle.getStatus().tokens.input,
          outputTokens: handle.getStatus().tokens.output,
          totalTokens: handle.getStatus().tokens.total,
        })
        continue
      }

      if (!currentState && !config.tracker.active_states.includes(entry.state)) {
        log.info(`Issue ${entry.identifier} no longer found, releasing`)
        await handle.stop()
        releaseIssue(state, issueId)
        continue
      }

      const status = handle.getStatus()
      const stallTimeout = config.agent.max_retry_backoff_ms > 0 ? 300000 : -1
      if (stallTimeout > 0 && now - status.lastEventAt > stallTimeout) {
        log.warn(`Stall detected for ${entry.identifier}`)
        Bus.publish(SymphonyEvent.StallDetected, {
          issueId,
          identifier: entry.identifier,
          lastEventAt: status.lastEventAt,
        })
        await handle.stop()
        removeRunning(state, issueId)
        scheduleRetry(issueId, entry.identifier, 1, "Stall timeout exceeded")
      }
    }
  }

  function validateConfig(): boolean {
    try {
      if (!config.tracker.api_key) throw new SymphonyConfigError({ message: "Missing tracker API key" })
      if (!config.tracker.project_slug) throw new SymphonyConfigError({ message: "Missing tracker project slug" })
      if (!promptTemplate) throw new SymphonyConfigError({ message: "Missing prompt template" })
      return true
    } catch (e) {
      log.error("Config validation failed, skipping dispatch", { error: e })
      return false
    }
  }

  async function fetchAndDispatch(): Promise<void> {
    if (availableSlots(state, config) <= 0) return

    let candidates: TrackerIssue[]
    try {
      candidates = await tracker.fetchCandidates(
        config.tracker.active_states,
        config.tracker.project_slug,
      )
    } catch (e) {
      log.error("Failed to fetch candidates", { error: e })
      return
    }

    const eligible = candidates.filter((issue) => isEligible(issue, state, config))
    const sorted = sortCandidates(eligible)

    for (const issue of sorted) {
      if (availableSlotsForState(state, issue.state, config) <= 0) continue

      claimIssue(state, issue.id)
      try {
        const handle = await startWorker(issue, config, promptTemplate, null)
        addRunning(state, issue.id, handle.getStatus(), handle)
        log.info(`Dispatched worker for ${issue.identifier}`)
      } catch (e) {
        log.error(`Failed to dispatch worker for ${issue.identifier}`, { error: e })
        releaseIssue(state, issue.id)
        scheduleRetry(issue.id, issue.identifier, 1, e instanceof Error ? e.message : String(e))
      }
    }
  }

  function scheduleRetry(issueId: string, identifier: string, attempt: number, error: string): void {
    const delay = computeRetryDelay(attempt, config.agent.max_retry_backoff_ms)
    const dueAt = Date.now() + delay

    const timerHandle = setTimeout(async () => {
      state.retryQueue.delete(issueId)

      try {
        const states = await tracker.fetchIssueStates([issueId])
        const currentState = states.get(issueId)

        if (!currentState || config.tracker.terminal_states.includes(currentState)) {
          releaseIssue(state, issueId)
          await WorkspaceManager.cleanup(identifier, config).catch(() => {})
          return
        }

        claimIssue(state, issueId)
        const candidates = await tracker.fetchCandidates(config.tracker.active_states, config.tracker.project_slug)
        const issue = candidates.find((c) => c.id === issueId)

        if (!issue) {
          releaseIssue(state, issueId)
          return
        }

        try {
          const handle = await startWorker(issue, config, promptTemplate, attempt)
          addRunning(state, issue.id, handle.getStatus(), handle)
        } catch (e) {
          releaseIssue(state, issueId)
          scheduleRetry(issueId, identifier, attempt + 1, e instanceof Error ? e.message : String(e))
        }
      } catch (e) {
        log.error(`Retry failed for ${identifier}`, { error: e })
        scheduleRetry(issueId, identifier, attempt + 1, e instanceof Error ? e.message : String(e))
      }
    }, delay)

    state.retryQueue.set(issueId, {
      issueId,
      identifier,
      attempt,
      dueAtMs: dueAt,
      error,
      timerHandle,
    })
  }

  async function tick(): Promise<void> {
    try {
      await reconcile()

      if (validateConfig()) {
        await fetchAndDispatch()
      }
    } catch (e) {
      log.error("Tick failed", { error: e })
    }

    if (running) {
      pollTimer = setTimeout(() => tick(), config.polling.interval_ms)
    }
  }

  return {
    async start() {
      if (running) return
      running = true

      log.info("Orchestrator starting", {
        projectSlug: config.tracker.project_slug,
        pollIntervalMs: config.polling.interval_ms,
        maxConcurrent: config.agent.max_concurrent_agents,
      })

      try {
        const terminalIssues = await tracker.fetchTerminalIssues(
          config.tracker.terminal_states,
          config.tracker.project_slug,
        )
        const terminalIdentifiers = terminalIssues.map((i) => i.identifier)
        await WorkspaceManager.cleanupTerminal(terminalIdentifiers, config)
      } catch (e) {
        log.error("Startup cleanup failed", { error: e })
      }

      await tick()
    },

    async stop() {
      running = false
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }

      for (const [, entry] of state.retryQueue) {
        clearTimeout(entry.timerHandle)
      }
      state.retryQueue.clear()

      const stopPromises = Array.from(state.running.values()).map(({ handle }) =>
        handle.stop().catch((e) => log.error("Worker stop failed", { error: e })),
      )
      await Promise.all(stopPromises)

      log.info("Orchestrator stopped")
    },

    async refresh() {
      if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
      }
      await tick()
    },

    getState(): OrchestratorSnapshot {
      const now = Date.now()
      const runningList = Array.from(state.running.values()).map(({ handle }) => {
        const status = handle.getStatus()
        return {
          issueId: status.issueId,
          identifier: status.identifier,
          state: status.state,
          sessionId: status.sessionId,
          turnCount: status.turnCount,
          startedAt: status.startedAt,
          lastEventAt: status.lastEventAt,
          tokens: status.tokens,
        }
      })

      const retryingList = Array.from(state.retryQueue.values()).map((entry) => ({
        issueId: entry.issueId,
        identifier: entry.identifier,
        attempt: entry.attempt,
        dueAt: entry.dueAtMs,
        error: entry.error,
      }))

      const activeSeconds = runningList.reduce(
        (sum, r) => sum + (now - r.startedAt) / 1000,
        0,
      )

      return {
        generatedAt: new Date().toISOString(),
        counts: { running: runningList.length, retrying: retryingList.length },
        running: runningList,
        retrying: retryingList,
        tokenTotals: {
          ...state.tokenTotals,
          secondsRunning: state.tokenTotals.secondsRunning + activeSeconds,
        },
        rateLimits: state.rateLimits,
      }
    },

    updateConfig(newConfig: SymphonyConfig, newPromptTemplate: string) {
      config = newConfig
      promptTemplate = newPromptTemplate
      log.info("Config updated, new settings apply to future dispatches")
    },
  }
}
