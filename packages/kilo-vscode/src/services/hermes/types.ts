/**
 * Types shared across the Hermes pipeline integration.
 *
 * Pipeline architecture (authoritative doc: KILOCODE-HERMES-ZEROCLAW-PIPELINE.md):
 *
 *   KiloCode (cockpit)  ──POST /tasks──►  Hermes (mission control)
 *                                              │
 *                                              ▼
 *                                        ZeroClaw (execution)
 *
 * KiloCode owns the UI + envelope. Hermes owns routing, policy, memory, ledger,
 * and calls ZeroClaw when execution is required. Results flow back through
 * Hermes (which validates) before reaching the KiloCode UI.
 */

export type ApprovalMode = "auto-all" | "auto-low" | "manual"

export interface HermesConfig {
  /** Feature toggle: when false, all pipeline code is a no-op. */
  enabled: boolean
  /** Bridge API base URL, e.g. http://187.77.30.206:18789 */
  baseUrl: string
  /** Which risk tiers auto-approve. */
  approvalMode: ApprovalMode
  /** Restrict execution to the current VS Code workspace folder. */
  workspaceScopeOnly: boolean
}

/**
 * Task envelope (KiloCode → Hermes Bridge API).
 *
 * Hermes receives this and produces a stricter ZeroClaw job from it.
 * KiloCode never constructs the ZeroClaw job itself.
 */
export interface TaskEnvelope {
  task_id: string
  origin: "kilocode"
  user_intent: string
  project_path: string
  requires_execution: boolean
  approval_mode: ApprovalMode
  constraints: {
    allow_network: boolean
    allow_write: boolean
    workspace_scope: string[]
  }
  metadata: {
    submitter: string
    submitted_at: string
    kilo_version?: string
  }
}

/**
 * Task state machine emitted by the Hermes Bridge API via SSE on
 * GET /tasks/{id}/events. KiloCode subscribes and reflects state in UI;
 * KiloCode does not drive transitions.
 */
export type TaskState =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "executing_in_zeroclaw"
  | "validating"
  | "completed"
  | "failed"
  | "rolled_back"

/** Shape returned by POST /tasks. */
export interface TaskCreated {
  task_id: string
  state: TaskState
}

/** Shape returned by GET /tasks/{id}. */
export interface TaskStatus {
  task_id: string
  state: TaskState
  hermes_verdict?: "accepted" | "rejected" | "pending"
  summary?: string
  artifacts_url?: string
  memory_ids_written?: string[]
  ledger_entries?: number
  next_suggested_action?: string | null
  error?: { code: string; message: string }
}

/** Shape of an SSE event on GET /tasks/{id}/events. */
export interface TaskEvent {
  task_id: string
  state: TaskState
  at: string
  detail?: string
  progress?: number
}

/** Shape of health ping. */
export interface HermesHealth {
  ok: boolean
  version?: string
  latency_ms: number
  bridge_reachable: boolean
  error?: string
}

/**
 * Keys used to look up an API key. The resolver tries SecretStorage first,
 * then falls back through the env-var chain in order. First match wins.
 */
export const HERMES_SECRET_KEY = "kilo-code.new.hermes.apiKey"
export const HERMES_ENV_FALLBACKS = [
  "HERMES_API_KEY",
  "KILOCODE_API_KEY",
  "MINIMAX_API_KEY",
  "ANTHROPIC_API_KEY",
] as const
export type HermesEnvFallback = (typeof HERMES_ENV_FALLBACKS)[number]

/** Default Bridge URL — shiba-piggyback per D3 decision. */
export const HERMES_DEFAULT_BASE_URL = "http://187.77.30.206:18789"

/** VS Code setting namespace. */
export const HERMES_CFG_SECTION = "kilo-code.new.hermes"
