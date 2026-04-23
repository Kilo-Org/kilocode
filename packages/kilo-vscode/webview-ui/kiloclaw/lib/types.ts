/**
 * KiloClaw webview types.
 *
 * Mirrors the extension host types for use in the SolidJS webview.
 * All data arrives via postMessage — no direct network access.
 *
 * SYNC: These types are mirrored from src/kiloclaw/types.ts — keep both in sync.
 */

export type ClawStatus = {
  status: "provisioned" | "starting" | "restarting" | "running" | "stopped" | "destroying" | null
  sandboxId?: string
  flyRegion?: string
  machineSize?: { cpus: number; memory_mb: number }
  openclawVersion?: string | null
  lastStartedAt?: string | null
  lastStoppedAt?: string | null
  channelCount?: number
  secretCount?: number
}

export type ChatMessage = {
  id: string
  text: string
  user: string
  created: string
  bot: boolean
}

export type KiloClawState =
  | { phase: "loading"; locale: string }
  | { phase: "noInstance"; locale: string }
  | { phase: "needsUpgrade"; locale: string }
  | { phase: "error"; locale: string; error: string }
  | {
      phase: "ready"
      locale: string
      status: ClawStatus | null
      connected: boolean
      online: boolean
      messages: ChatMessage[]
    }

// Messages: Extension Host -> Webview
export type KiloClawOutMessage =
  | { type: "kiloclaw.state"; state: KiloClawState }
  | { type: "kiloclaw.message"; message: ChatMessage }
  | { type: "kiloclaw.messageUpdated"; message: ChatMessage }
  | { type: "kiloclaw.presence"; online: boolean }
  | { type: "kiloclaw.status"; data: ClawStatus | null }
  | { type: "kiloclaw.locale"; locale: string }
  | { type: "kiloclaw.error"; error: string }
