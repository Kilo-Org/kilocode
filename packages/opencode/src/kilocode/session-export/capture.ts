import type { ToWorker } from "./worker/ipc"
import { ulid } from "./ulid"
import { isEligible, type EligibilityInput } from "./eligibility"
import type {
  ExportEvent,
  LlmRequestCompleted,
  LlmRequestStarted,
  SessionDegraded,
  WorkspaceBaselineStarted,
} from "./events"

export type CaptureDeps = {
  worker: { postMessage: (msg: ToWorker | { kind: string; [key: string]: unknown }) => void; terminate: () => void }
  agentVersion: string
  nowMs: () => number
  syncSeq: () => number
}

export type RequestMeta = {
  sessionId: string
  rootSessionId: string
  parentSessionId?: string
  requestId: string
  userMessageId: string
  assistantMessageId?: string
  agent: string
  modeId: string
  agentInfo?: unknown
  gitContext?: { branch: string; sha: string; dirtyFileCount: number }
}

export class Capture {
  private firstEligible = new Set<string>()
  private degradedAnnounced = new Set<string>()
  private degraded = new Set<string>()

  constructor(private readonly deps: CaptureDeps) {}

  markDegraded(sessionId: string): void {
    this.degraded.add(sessionId)
  }

  hasEligibleSession(sessionId: string): boolean {
    return this.firstEligible.has(sessionId) && !this.degraded.has(sessionId)
  }

  beforeRequest(args: {
    input: EligibilityInput & { model: EligibilityInput["model"] & { providerId?: string; modelId?: string; variant?: string } }
    requestMeta: RequestMeta
    assembled: {
      system: string[]
      messages: unknown[]
      tools: Record<string, unknown>
      permissions: unknown
      toolChoice?: "auto" | "required" | "none"
      params: Record<string, unknown>
    }
  }): void {
    if (!isEligible(args.input)) return
    const meta = args.requestMeta

    if (this.degraded.has(meta.sessionId)) {
      this.announceDegraded(meta)
      return
    }

    if (!this.firstEligible.has(meta.sessionId)) {
      this.firstEligible.add(meta.sessionId)
      const baseline: WorkspaceBaselineStarted = {
        id: ulid(),
        schemaVersion: 1,
        type: "workspace_baseline_started",
        sessionId: meta.sessionId,
        rootSessionId: meta.rootSessionId,
        parentSessionId: meta.parentSessionId,
        seq: this.deps.syncSeq(),
        ts: this.deps.nowMs(),
        agentVersion: this.deps.agentVersion,
        requestedAt: this.deps.nowMs(),
      }
      this.dispatch(baseline)
    }

    const env: LlmRequestStarted = {
      id: ulid(),
      schemaVersion: 1,
      type: "llm_request_started",
      sessionId: meta.sessionId,
      rootSessionId: meta.rootSessionId,
      parentSessionId: meta.parentSessionId,
      seq: this.deps.syncSeq(),
      ts: this.deps.nowMs(),
      agentVersion: this.deps.agentVersion,
      requestId: meta.requestId,
      userMessageId: meta.userMessageId,
      assistantMessageId: meta.assistantMessageId,
      agent: meta.agent,
      modeId: meta.modeId,
      model: {
        providerId: args.input.model.providerId ?? "",
        modelId: args.input.model.modelId ?? "",
        variant: args.input.model.variant,
        isFree: true,
      },
      input: args.assembled,
      gitContext: meta.gitContext,
      agentInfo: meta.agentInfo,
      time: { created: this.deps.nowMs() },
    }
    this.dispatch(env)
  }

  afterRequest(args: {
    sessionId: string
    rootSessionId: string
    parentSessionId?: string
    requestId: string
    output: LlmRequestCompleted["output"]
    durationMs: number
    retryCount: number
  }): void {
    if (this.degraded.has(args.sessionId)) return
    const env: LlmRequestCompleted = {
      id: ulid(),
      schemaVersion: 1,
      type: "llm_request_completed",
      sessionId: args.sessionId,
      rootSessionId: args.rootSessionId,
      parentSessionId: args.parentSessionId,
      seq: this.deps.syncSeq(),
      ts: this.deps.nowMs(),
      agentVersion: this.deps.agentVersion,
      requestId: args.requestId,
      output: args.output,
      durationMs: args.durationMs,
      retryCount: args.retryCount,
      time: { completed: this.deps.nowMs() },
    }
    this.dispatch(env)
  }

  dispatchRaw(envelope: ExportEvent): void {
    this.dispatch(envelope)
  }

  private announceDegraded(meta: RequestMeta): void {
    if (this.degradedAnnounced.has(meta.sessionId)) return
    this.degradedAnnounced.add(meta.sessionId)
    const env: SessionDegraded = {
      id: ulid(),
      schemaVersion: 1,
      type: "session_degraded",
      sessionId: meta.sessionId,
      rootSessionId: meta.rootSessionId,
      parentSessionId: meta.parentSessionId,
      seq: this.deps.syncSeq(),
      ts: this.deps.nowMs(),
      agentVersion: this.deps.agentVersion,
      reason: "ring_buffer_overflow",
    }
    this.dispatch(env)
  }

  private dispatch(envelope: ExportEvent): void {
    this.deps.worker.postMessage({ kind: "event", envelope, approxBytes: JSON.stringify(envelope).length })
  }
}
