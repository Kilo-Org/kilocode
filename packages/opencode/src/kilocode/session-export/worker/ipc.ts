import type { ExportEvent } from "../events"

export type ToWorker =
  | {
      kind: "init"
      dbPath: string
      agentVersion?: string
      endpoint?: string
      allowCustomEndpoint?: boolean
      surface?: string
      anonId?: string
    }
  | { kind: "event"; envelope: ExportEvent; approxBytes: number }
  | { kind: "shutdown"; timeoutMs: number }
  | { kind: "network_reconnect" }
  | { kind: "test_event_count" }

export type FromWorker =
  | { kind: "pressure"; sessionId: string }
  | { kind: "ready" }
  | { kind: "telemetry"; name: string; props?: Record<string, unknown> }
  | { kind: "shutdown_done" }
  | { kind: "kill_switch"; reason: string }
