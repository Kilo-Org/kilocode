import * as vscode from "vscode"
import type { Event } from "@kilocode/sdk/v2/client"
import type { KiloConnectionService } from "../services/cli-backend/connection-service"
import { playSound, resolveSoundId } from "./sound"

const COOLDOWN_MS = 700
const COOLDOWN_TTL_MS = COOLDOWN_MS * 10
const MAX_COOLDOWNS = 200

export class SoundNotificationService {
  private readonly cooldowns = new Map<string, number>()
  private readonly busySessions = new Map<string, number>()
  private readonly cleanupTimer: NodeJS.Timeout
  private focused: boolean | undefined = undefined
  private unsubscribeFocus: vscode.Disposable | null = null

  constructor(private readonly connectionService: KiloConnectionService) {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now()
      for (const [key, timestamp] of this.cooldowns) {
        if (now - timestamp > COOLDOWN_TTL_MS) {
          this.cooldowns.delete(key)
        }
      }
      if (this.cooldowns.size > MAX_COOLDOWNS) {
        const sorted = [...this.cooldowns.entries()].sort((a, b) => a[1] - b[1])
        const removeCount = this.cooldowns.size - MAX_COOLDOWNS
        for (let i = 0; i < removeCount; i++) {
          this.cooldowns.delete(sorted[i][0])
        }
      }
      this.pruneStaleBusySessions()
    }, COOLDOWN_MS * 2)
  }

  /**
   * Set up window focus tracking.
   * Sounds should only play when VS Code is not focused.
   */
  setupFocusTracking(): void {
    if (vscode.window.onDidChangeWindowState) {
      this.unsubscribeFocus = vscode.window.onDidChangeWindowState((state) => {
        this.focused = state.focused
      })
      this.focused = vscode.window.state.focused
    }
  }

  private pruneStaleBusySessions(): void {
    const now = Date.now()
    for (const [sid, startTime] of this.busySessions) {
      if (now - startTime > COOLDOWN_TTL_MS * 2) {
        this.busySessions.delete(sid)
      }
    }
  }

  playSoundForEvent(event: Event, sessionID: string | undefined, trackedSessionIds: Set<string>): void {
    this.pruneStaleBusySessions()
    const now = Date.now()
    const eventType = event.type

    if (eventType === "session.status") {
      const sid = event.properties.sessionID
      const status = event.properties.status.type

      if (status === "busy") {
        this.busySessions.set(sid, now)
        return
      }

      if (status === "idle" && this.busySessions.has(sid) && trackedSessionIds.has(sid)) {
        this.busySessions.delete(sid)
        if (this.connectionService.shouldNotify(sid, "session.status:idle")) {
          this.playWithCooldown("agent", now, sid, eventType)
        }
      }
      return
    }

    if (eventType === "permission.asked" && sessionID && trackedSessionIds.has(sessionID)) {
      if (this.connectionService.shouldNotify(sessionID, "permission.asked", event.properties.id)) {
        this.playWithCooldown("permissions", now, sessionID, eventType)
      }
      return
    }

    if (eventType === "question.asked" && sessionID && trackedSessionIds.has(sessionID)) {
      if (this.connectionService.shouldNotify(sessionID, "question.asked", event.properties.id)) {
        this.playWithCooldown("permissions", now, sessionID, eventType)
      }
      return
    }

    if (eventType === "session.error" && sessionID && trackedSessionIds.has(sessionID)) {
      if (this.connectionService.shouldNotify(sessionID, "session.error")) {
        this.playWithCooldown("errors", now, sessionID, eventType)
      }
    }
  }

  private playWithCooldown(
    setting: "agent" | "permissions" | "errors",
    now: number,
    sessionID?: string,
    eventType?: string,
  ): void {
    // Don't play sounds when VS Code is focused (only when undefined/not explicit focused)
    if (this.focused === true) return

    const sessionKey = `${setting}:${eventType}:${sessionID}`
    const cooldownKey = sessionID ? sessionKey : setting
    const last = this.cooldowns.get(cooldownKey) ?? 0
    if (now - last < COOLDOWN_MS) return
    this.cooldowns.set(cooldownKey, now)

    const config = vscode.workspace.getConfiguration("kilo-code.new.notifications")
    if (!config.get<boolean>(setting, true)) return

    const soundConfig = vscode.workspace.getConfiguration("kilo-code.new.sounds")
    const soundSetting = soundConfig.get<string>(setting, "system")
    const soundId = resolveSoundId(soundSetting, setting)
    if (soundId) {
      void playSound(soundId)
    }
  }

  handleTestNotification(settingType: "agent" | "permissions" | "errors"): void {
    const sounds = vscode.workspace.getConfiguration("kilo-code.new.sounds")
    const soundSetting = sounds.get<string>(settingType, "system")
    const soundId = resolveSoundId(soundSetting, settingType)
    if (soundId) {
      void playSound(soundId)
    }
  }

  dispose(): void {
    clearInterval(this.cleanupTimer)
    this.cooldowns.clear()
    this.busySessions.clear()
    if (this.unsubscribeFocus) {
      this.unsubscribeFocus.dispose()
    }
    this.unsubscribeFocus = null
  }
}
