import type { ToWorker } from "./worker/ipc"
import { Config } from "./config"
import { isEligible, type EligibilityInput } from "./eligibility"
import type { Permission } from "@/permission"
import type { ModelMessage, Tool } from "ai"
import { ulid } from "ulid"
import type {
  CompactionCaptured,
  DeltaEntry,
  ExportEvent,
  FileEntry,
  LlmRequestCompleted,
  LlmRequestStarted,
  SessionDegraded,
  CaptureMetadata,
} from "./events"
import { startBaselineFiber, startDeltaFiber } from "./workspace-fiber"

export type CaptureDeps = {
  worker: { postMessage: (msg: ToWorker) => void; terminate: () => void }
  agentVersion: string
  nowMs: () => number
  syncSeq: (sessionId: string) => number
  onPostError?: (err: unknown) => void
  snapshotProvider?: {
    current?: (sessionId: string) => string | undefined
    remember?: (sessionId: string, snapshotHash: string) => void
    baseline: () => Promise<{ snapshotId: string; files: FileEntry[]; capture?: CaptureMetadata }>
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
  workspaceKey?: string
  agentInfo?: unknown
  gitContext?: { branch: string; sha: string; dirtyFileCount: number }
}

export class Capture {
  private firstEligible = new Set<string>()
  private authorized = new Set<string>()
  private degradedAnnounced = new Set<string>()
  private degraded = new Set<string>()
  private roots = new Map<string, string>()
  private snapshots = new Map<string, string>()
  private turns = new Map<string, string>()
  private deltas = new Map<string, Promise<void>>()

  constructor(private readonly deps: CaptureDeps) {}

  markDegraded(sessionId: string): void {
    this.degraded.add(sessionId)
  }

  hasEligibleSession(sessionId: string): boolean {
    return this.authorized.has(sessionId) && !this.degraded.has(sessionId)
  }

  turnId(sessionId: string): string | undefined {
    return this.turns.get(sessionId)
  }

  rootSessionId(sessionId: string): string | undefined {
    return this.roots.get(sessionId)
  }

  beforeRequest(args: {
    input: EligibilityInput & {
      model: EligibilityInput["model"] & {
        providerId?: string
        providerID?: string
        modelId?: string
        modelID?: string
        id?: string
        variant?: string
      }
    }
    requestMeta: RequestMeta
    assembled: {
      system: string[]
      messages: ModelMessage[]
      tools: Record<string, Tool>
      permissions: Permission.Ruleset
      toolChoice?: "auto" | "required" | "none"
      params: Record<string, unknown>
    }
  }): void {
    if (args.requestMeta.agent === "title") return
    const meta = args.requestMeta
    if (!isEligible(args.input)) {
      this.authorized.delete(meta.sessionId)
      this.turns.delete(meta.sessionId)
      return
    }

    if (this.degraded.has(meta.sessionId)) {
      this.announceDegraded(meta)
      return
    }
    this.authorized.add(meta.sessionId)
    this.turns.set(meta.sessionId, meta.userMessageId)

    if (!this.firstEligible.has(meta.sessionId)) {
      this.firstEligible.add(meta.sessionId)
      this.roots.set(meta.sessionId, meta.rootSessionId)
      const previous = this.deps.snapshotProvider?.current?.(meta.sessionId)
      if (previous) {
        this.snapshots.set(meta.sessionId, previous)
        this.startNextDelta(meta)
      } else {
        this.startBaseline(meta)
      }
    } else {
      this.startNextDelta(meta)
    }

    const seq = this.deps.syncSeq(meta.sessionId)
    const env: LlmRequestStarted = {
      id: ulid(),
      schemaVersion: 1,
      type: "llm_request_started",
      sessionId: meta.sessionId,
      rootSessionId: meta.rootSessionId,
      parentSessionId: meta.parentSessionId,
      turnId: meta.userMessageId,
      seq,
      eventSeq: seq,
      ts: this.deps.nowMs(),
      agentVersion: this.deps.agentVersion,
      requestId: meta.requestId,
      userMessageId: meta.userMessageId,
      assistantMessageId: meta.assistantMessageId,
      agent: meta.agent,
      modeId: meta.modeId,
      model: {
        providerId: args.input.model.providerId ?? args.input.model.providerID ?? "",
        modelId: args.input.model.modelId ?? args.input.model.modelID ?? args.input.model.id ?? "",
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
    workspaceKey?: string
  }): void {
    if (!this.authorized.has(args.sessionId)) return
    if (this.degraded.has(args.sessionId)) return
    const seq = this.deps.syncSeq(args.sessionId)
    const env: LlmRequestCompleted = {
      id: ulid(),
      schemaVersion: 1,
      type: "llm_request_completed",
      sessionId: args.sessionId,
      rootSessionId: args.rootSessionId,
      parentSessionId: args.parentSessionId,
      turnId: this.turns.get(args.sessionId),
      seq,
      eventSeq: seq,
      ts: this.deps.nowMs(),
      agentVersion: this.deps.agentVersion,
      requestId: args.requestId,
      output: args.output,
      durationMs: args.durationMs,
      retryCount: args.retryCount,
      time: { completed: this.deps.nowMs() },
    }
    this.dispatch(env)
    void this.startDelta(args.sessionId, args.rootSessionId, "turn_end")
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
    workspaceKey?: string
  }): void {
    if (!this.authorized.has(args.sessionId)) return
    if (this.degraded.has(args.sessionId)) return
    const seq = this.deps.syncSeq(args.sessionId)
    const env: CompactionCaptured = {
      id: ulid(),
      schemaVersion: 1,
      type: "compaction_captured",
      sessionId: args.sessionId,
      rootSessionId: args.rootSessionId,
      parentSessionId: args.parentSessionId,
      turnId: this.turns.get(args.sessionId),
      requestId: args.requestId,
      seq,
      eventSeq: seq,
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
    if (!this.authorized.has(sessionId)) return
    if (this.degraded.has(sessionId)) return
    const root = this.roots.get(sessionId) ?? sessionId
    await this.startDelta(sessionId, root, "session_close").catch((err) => this.deps.onPostError?.(err))
  }

  private async startDelta(
    sessionId: string,
    rootSessionId: string,
    trigger: "next_request" | "turn_end" | "session_close",
  ): Promise<void> {
    const prev = this.deltas.get(sessionId) ?? Promise.resolve()
    const next = prev.then(
      () => this.captureDelta(sessionId, rootSessionId, trigger),
      () => this.captureDelta(sessionId, rootSessionId, trigger),
    )
    this.deltas.set(sessionId, next)
    void next.then(
      () => {
        if (this.deltas.get(sessionId) === next) this.deltas.delete(sessionId)
      },
      (err) => {
        if (this.deltas.get(sessionId) === next) this.deltas.delete(sessionId)
        this.deps.onPostError?.(err)
      },
    )
    return next
  }

  private async captureDelta(
    sessionId: string,
    rootSessionId: string,
    trigger: "next_request" | "turn_end" | "session_close",
  ): Promise<void> {
    const provider = this.deps.snapshotProvider
    if (!provider) return
    const previous = this.snapshots.get(sessionId)
    if (!previous) return
    const next = await startDeltaFiber({
      sessionId,
      rootSessionId,
      turnId: this.turns.get(sessionId),
      trigger,
      prevSnapshotHash: previous,
      now: () => this.deps.nowMs(),
      syncSeq: () => this.deps.syncSeq(sessionId),
      agentVersion: this.deps.agentVersion,
      requestDiff: provider.diff,
      dispatch: (event) => this.dispatchRaw(event),
    })
    if (next) this.snapshots.set(sessionId, next)
    if (next) provider.remember?.(sessionId, next)
  }

  private startNextDelta(meta: RequestMeta): void {
    void this.startDelta(meta.sessionId, meta.rootSessionId, "next_request")
  }

  private announceDegraded(meta: RequestMeta): void {
    if (this.degradedAnnounced.has(meta.sessionId)) return
    this.degradedAnnounced.add(meta.sessionId)
    const seq = this.deps.syncSeq(meta.sessionId)
    const env: SessionDegraded = {
      id: ulid(),
      schemaVersion: 1,
      type: "session_degraded",
      sessionId: meta.sessionId,
      rootSessionId: meta.rootSessionId,
      parentSessionId: meta.parentSessionId,
      turnId: this.turns.get(meta.sessionId),
      seq,
      eventSeq: seq,
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
      turnId: this.turns.get(meta.sessionId),
      timeoutMs: this.deps.baselineTimeoutMs ?? Config.baselineWaitMs,
      now: () => this.deps.nowMs(),
      syncSeq: () => this.deps.syncSeq(meta.sessionId),
      agentVersion: this.deps.agentVersion,
      requestSnapshot: provider.baseline,
      dispatch: (event) => this.dispatchRaw(event),
    }).then((hash) => {
      if (hash) this.snapshots.set(meta.sessionId, hash)
      if (hash) provider.remember?.(meta.sessionId, hash)
    })
  }

  private dispatch(envelope: ExportEvent): void {
    try {
      const safe = cloneable(envelope) as ExportEvent
      this.deps.worker.postMessage({ kind: "event", envelope: safe, approxBytes: JSON.stringify(safe).length })
    } catch (err) {
      this.deps.onPostError?.(err)
    }
  }
}

function cloneable(node: unknown): unknown {
  if (node === null) return null
  if (node === undefined) return undefined
  if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") return node
  if (typeof node === "bigint") return String(node)
  if (typeof node === "function" || typeof node === "symbol") return undefined
  if (node instanceof Error) return { name: node.name, message: node.message, stack: node.stack }
  if (Array.isArray(node)) return node.map(cloneable)
  if (node instanceof Uint8Array) return node
  if (node instanceof ArrayBuffer) return node
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(node)) {
      const next = cloneable(val)
      if (next !== undefined) out[key] = next
    }
    return out
  }
  return String(node)
}
