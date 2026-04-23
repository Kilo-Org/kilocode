/**
 * KiloClaw VS Code extension message types.
 *
 * Defines the postMessage protocol between the extension host (Node.js)
 * and the KiloClaw webview (SolidJS). The extension host owns all network
 * connections (SDK + Stream Chat) and relays data to the webview.
 *
 * SYNC: Shared types (ClawStatus, ChatMessage, KiloClawState, KiloClawOutMessage)
 * are mirrored in webview-ui/kiloclaw/lib/types.ts — keep both in sync.
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

export type ChatCredentials = {
  apiKey: string
  userId: string
  userToken: string
  channelId: string
}

export type ChatMessage = {
  id: string
  text: string
  user: string
  created: string // ISO string (serializable via postMessage)
  bot: boolean
}

// Full state snapshot pushed to the webview
// Every phase carries `locale` so the webview can resolve translations immediately.
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

// Messages: Webview → Extension Host
export type KiloClawInMessage =
  | { type: "kiloclaw.ready" }
  | { type: "kiloclaw.send"; text: string }
  | { type: "kiloclaw.openExternal"; url: string }

// Messages: Extension Host → Webview
export type KiloClawOutMessage =
  | { type: "kiloclaw.state"; state: KiloClawState }
  | { type: "kiloclaw.message"; message: ChatMessage }
  | { type: "kiloclaw.messageUpdated"; message: ChatMessage }
  | { type: "kiloclaw.presence"; online: boolean }
  | { type: "kiloclaw.status"; data: ClawStatus | null }
  | { type: "kiloclaw.locale"; locale: string }
  | { type: "kiloclaw.error"; error: string }
