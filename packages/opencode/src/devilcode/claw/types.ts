// kilocode_change - new file

/**
 * KiloClaw TUI types
 *
 * Types for the KiloClaw chat and dashboard feature in the TUI.
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
  userId?: string
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
  created: Date
  bot: boolean
}
