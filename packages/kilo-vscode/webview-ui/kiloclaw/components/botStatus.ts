// Bot presence display helpers — ported from the web client so the
// VS Code extension reaches the same conclusions for
// "online / idle / offline / unknown".
//
// Ref: cloud/apps/web/src/app/(app)/claw/kilo-chat/components/BotStatus.tsx

import { createSignal, onCleanup } from "solid-js"

export type BotPresence = { online: boolean; lastAt: number }
export type BotDisplayState = "online" | "idle" | "offline" | "unknown"
export type BotDisplay = { state: BotDisplayState }

export function computeBotDisplay(params: {
  instanceStatus: string | null
  presence: BotPresence | undefined
  now: number
}): BotDisplay {
  if (params.instanceStatus !== "running") return { state: "offline" }
  if (!params.presence) return { state: "unknown" }
  if (!params.presence.online) return { state: "offline" }
  const elapsed = params.now - params.presence.lastAt
  if (elapsed > 90_000) return { state: "offline" }
  if (elapsed > 30_000) return { state: "idle" }
  return { state: "online" }
}

export function useNowTicker(intervalMs: number) {
  const [now, setNow] = createSignal(Date.now())
  const id = setInterval(() => setNow(Date.now()), intervalMs)
  onCleanup(() => clearInterval(id))
  return now
}
