import type { KiloRuntimeStatus, SessionActivityStatus, SessionLifecycleStatus } from "./types"

/**
 * Map Kilo `session.status` runtime values onto generic lifecycle/activity.
 *
 * idle     → reachable (safe to deliver or resume)
 * busy     → running (mid-generation; wait)
 * retry    → starting (provider backoff; do not pile on)
 * offline  → paused (network; resume after restore)
 */
export function mapKiloRuntimeStatus(status: KiloRuntimeStatus | string | undefined): SessionLifecycleStatus {
  switch (status) {
    case "idle":
      return "reachable"
    case "busy":
      return "running"
    case "retry":
      return "starting"
    case "offline":
      return "paused"
    default:
      return "unknown"
  }
}

export function mapKiloRuntimeActivity(status: KiloRuntimeStatus | string | undefined): SessionActivityStatus {
  switch (status) {
    case "idle":
      return "idle"
    case "busy":
      return "running"
    case "retry":
      return "waiting"
    case "offline":
      return "blocked"
    default:
      return "stopped"
  }
}
