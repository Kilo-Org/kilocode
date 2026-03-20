/**
 * Shared context interface passed to extracted handler functions.
 *
 * This decouples handlers from the KiloProvider class so they can be
 * tested independently without a vscode dependency.
 */

import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend"

export interface HandlerContext {
  readonly client: KiloClient | null
  readonly connectionState: "connecting" | "connected" | "disconnected" | "error"
  currentSession: Session | null
  readonly trackedSessionIds: Set<string>
  readonly sessionDirectories: Map<string, string>
  readonly connectionService: KiloConnectionService
  postMessage(msg: unknown): void
  getWorkspaceDirectory(sessionId?: string): string
  getProjectDirectory(sessionId?: string): string | undefined
}
