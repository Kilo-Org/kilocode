import * as vscode from "vscode"
import type { KiloConnectionService } from "./cli-backend/connection-service"
import type { SessionInfo, SSEEvent } from "./cli-backend/types"

const CONFIG_SECTION = "kilo-code.new"
const PERMISSION_COOLDOWN_MS = 5000

/**
 * Watches SSE events and shows VS Code notifications based on user settings.
 * Mirrors the desktop app's notification behaviour for agent completion,
 * session errors, and permission requests.
 */
export class NotificationService {
  private readonly unsubscribe: () => void
  private readonly sessionCache = new Map<string, SessionInfo>()
  private readonly permissionCooldowns = new Map<string, number>()

  constructor(private readonly connectionService: KiloConnectionService) {
    this.unsubscribe = connectionService.onEvent((event) => {
      this.handleEvent(event)
    })
  }

  dispose(): void {
    this.unsubscribe()
    this.sessionCache.clear()
    this.permissionCooldowns.clear()
  }

  private handleEvent(event: SSEEvent): void {
    // Cache session info so we can check parentID later
    if (event.type === "session.created" || event.type === "session.updated") {
      this.sessionCache.set(event.properties.info.id, event.properties.info)
      return
    }

    switch (event.type) {
      case "session.idle":
        this.handleSessionIdle(event.properties.sessionID)
        break
      case "session.error":
        this.handleSessionError(event.properties.sessionID)
        break
      case "permission.asked":
        this.handlePermissionAsked(event.properties.sessionID)
        break
    }
  }

  private handleSessionIdle(sessionId: string): void {
    if (this.isChildSession(sessionId)) {
      return
    }

    const config = vscode.workspace.getConfiguration(CONFIG_SECTION)
    if (!config.get<boolean>("notifications.agent")) {
      return
    }

    console.log("[Kilo New] Showing agent completion notification")
    void vscode.window.showInformationMessage("Kilo: Agent completed task")
  }

  private handleSessionError(sessionId: string | undefined): void {
    if (sessionId && this.isChildSession(sessionId)) {
      return
    }

    const config = vscode.workspace.getConfiguration(CONFIG_SECTION)
    if (!config.get<boolean>("notifications.errors")) {
      return
    }

    console.log("[Kilo New] Showing session error notification")
    void vscode.window.showWarningMessage("Kilo: Session error occurred")
  }

  private handlePermissionAsked(sessionId: string): void {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION)
    if (!config.get<boolean>("notifications.permissions")) {
      return
    }

    // Cooldown per session to avoid flooding
    const now = Date.now()
    const last = this.permissionCooldowns.get(sessionId) ?? 0
    if (now - last < PERMISSION_COOLDOWN_MS) {
      return
    }
    this.permissionCooldowns.set(sessionId, now)

    console.log("[Kilo New] Showing permission request notification")
    void vscode.window.showInformationMessage("Kilo: Permission requested", "Go to Session").then((selection) => {
      if (selection !== "Go to Session") {
        return
      }
      void vscode.commands.executeCommand("kilo-code.new.sidebarView.focus")
    })
  }

  private isChildSession(sessionId: string): boolean {
    const info = this.sessionCache.get(sessionId)
    return !!info?.parentID
  }
}
