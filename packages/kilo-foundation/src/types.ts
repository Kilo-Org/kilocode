/**
 * Generic managed-session primitives. Safe to contribute upstream.
 * Do not add product roles, task statuses, or milestone policy here.
 */

export type SessionId = string

export type SessionActivityStatus = "idle" | "running" | "waiting" | "blocked" | "stopped"

export type SessionLifecycleStatus =
  | "unknown"
  | "starting"
  | "reachable"
  | "running"
  | "paused"
  | "stalled"
  | "stopped"
  | "failed"

/** Runtime status values emitted by Kilo `session.status`. */
export type KiloRuntimeStatus = "idle" | "busy" | "retry" | "offline"

export const FOUNDATION_EVENT = {
  MESSAGE_RECEIVED: "SESSION_MESSAGE_RECEIVED",
  STATUS_CHANGED: "SESSION_STATUS_CHANGED",
  STALLED: "SESSION_STALLED",
  RESUMABLE: "SESSION_RESUMABLE",
} as const

export type FoundationEventType = (typeof FOUNDATION_EVENT)[keyof typeof FOUNDATION_EVENT]

export const FOUNDATION_WAKE_TYPES: ReadonlySet<FoundationEventType> = new Set([
  FOUNDATION_EVENT.MESSAGE_RECEIVED,
  FOUNDATION_EVENT.RESUMABLE,
  FOUNDATION_EVENT.STALLED,
])

export interface ManagedEvent<TType extends string = string> {
  id: string
  type: TType
  sessionId?: SessionId
  payload: Record<string, unknown>
  createdAt: string
  consumedAt?: string
}

export type Escalation = "retry" | "debug" | "coordinator" | "human"

export interface RetryPolicy {
  workerAttempts: number
  sameErrorRetry: number
  reviewCycles: number
  debugEscalation: number
}

export const GENERIC_RETRY_POLICY: RetryPolicy = {
  workerAttempts: 2,
  sameErrorRetry: 1,
  reviewCycles: 3,
  debugEscalation: 1,
}

export const DEFAULT_STALL_AFTER_MS = 15 * 60 * 1000

export interface GenericTelemetry {
  coordinatorWakes: number
  eventsConsumed: number
  resumes: number
  stallsDetected: number
}

export interface SessionProbeResult {
  reachable: boolean
  status: SessionLifecycleStatus
  sessionCount?: number
  detail?: string
}

export interface ManagedSessionClient {
  listSessions(): Promise<SessionId[]>
  createSession(title: string): Promise<SessionId>
  sendMessage(sessionId: SessionId, message: string): Promise<void>
  resume(sessionId: SessionId): Promise<void>
  probe(): Promise<SessionProbeResult>
}
