import type { ToWorker } from "./worker/ipc"
import { Config } from "./config"
import { ulid } from "./ulid"
import { isEligible, type EligibilityInput } from "./eligibility"
import type {
  CompactionCaptured,
  DeltaEntry,
  ExportEvent,
  FileEntry,
  LlmRequestCompleted,
  LlmRequestStarted,
  SessionDegraded,
  WorkspaceBaselineStarted,
} from "./events"
import { startBaselineFiber, startDeltaFiber } from "./workspace-fiber"

export type CaptureDeps = {
  worker: { postMessage: (msg: ToWorker | { kind: string; [key: string]: unknown }) => void; terminate: () => void }
  agentVersion: string
  nowMs: () => number
  syncSeq: () => number
  snapshotProvider?: {
    baseline: () => Promise<{ snapshotId: string; files: FileEntry[] }>
    diff: (prevSnapshotHash: string) => Promise<{ snapshotHash: string; diff: DeltaEntry[] }>
  }
  baselineTimeoutMs?: number
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
  private roots = new Map<string, string>()
  private snapshots = new Map<string, string>()

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
      this.roots.set(meta.sessionId, meta.rootSessionId)
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
      this.startBaseline(meta)
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
    if (!this.firstEligible.has(args.sessionId)) return
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

  compaction(args: {
    sessionId: string
    rootSessionId: string
    parentSessionId?: string
    requestId: string
    input: CompactionCaptured["input"]
    output: CompactionCaptured["output"]
    modelId: string
    durationMs: number
    usage?: { inputTokens: number; outputTokens: number }
  }): void {
    if (!this.firstEligible.has(args.sessionId)) return
    if (this.degraded.has(args.sessionId)) return
    const env: CompactionCaptured = {
      id: ulid(),
      schemaVersion: 1,
      type: "compaction_captured",
      sessionId: args.sessionId,
      rootSessionId: args.rootSessionId,
      parentSessionId: args.parentSessionId,
      requestId: args.requestId,
      seq: this.deps.syncSeq(),
      ts: this.deps.nowMs(),
      agentVersion: this.deps.agentVersion,
      input: args.input,
      output: args.output,
      modelId: args.modelId,
      durationMs: args.durationMs,
      usage: args.usage,
    }
    this.dispatch(env)
  }

  async onSessionClose(sessionId: string): Promise<void> {
    if (!this.firstEligible.has(sessionId)) return
    if (this.degraded.has(sessionId)) return
    const provider = this.deps.snapshotProvider
    if (!provider) return
    const root = this.roots.get(sessionId) ?? sessionId
    const previous = this.snapshots.get(sessionId) ?? ""
    const next = await startDeltaFiber({
      sessionId,
      rootSessionId: root,
      trigger: "session_close",
      prevSnapshotHash: previous,
      now: () => this.deps.nowMs(),
      syncSeq: () => this.deps.syncSeq(),
      agentVersion: this.deps.agentVersion,
      requestDiff: provider.diff,
      dispatch: (event) => this.dispatchRaw(event),
    })
    if (next) this.snapshots.set(sessionId, next)
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

  private startBaseline(meta: RequestMeta): void {
    const provider = this.deps.snapshotProvider
    if (!provider) return
    void startBaselineFiber({
      sessionId: meta.sessionId,
      rootSessionId: meta.rootSessionId,
      timeoutMs: this.deps.baselineTimeoutMs ?? Config.baselineWaitMs,
      now: () => this.deps.nowMs(),
      syncSeq: () => this.deps.syncSeq(),
      agentVersion: this.deps.agentVersion,
      requestSnapshot: provider.baseline,
      dispatch: (event) => this.dispatchRaw(event),
    }).then((hash) => {
      if (hash) this.snapshots.set(meta.sessionId, hash)
    })
  }

  private dispatch(envelope: ExportEvent): void {
    this.deps.worker.postMessage({ kind: "event", envelope, approxBytes: JSON.stringify(envelope).length })
  }
}
