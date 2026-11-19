import type { OpenCodeClient } from "@opencode/client"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createSignal } from "solid-js"
import { createHostedChat, type HostedChatModel } from "../hosted-chat-model"
import { hostedActivity } from "./activity"

function identity(directory: string, target: KiloHostedRpc.Target) {
  return JSON.stringify([directory, target.scope, target.providerID, target.workspaceID, target.sessionID])
}

/** Keep recent tabs live briefly so a round trip to another tab doesn't repeat attach + history + stream setup. */
export function createSessionPool(api: OpenCodeClient) {
  type Entry = { directory: string; chat: HostedChatModel; expiry?: ReturnType<typeof setTimeout> }
  const entries = new Map<string, Entry>()
  const [revision, bump] = createSignal(0)
  function discard(key: string, entry: Entry) {
    clearTimeout(entry.expiry)
    entries.delete(key)
    entry.chat.close()
    bump((v) => v + 1)
  }
  return {
    observed(directory: string, target: KiloHostedRpc.Target) {
      revision()
      const chat = entries.get(identity(directory, target))?.chat
      const snapshot = chat?.snapshot()
      // No snapshot yet (or authorization was lost): don't advertise a title or invent an idle state.
      if (!chat || !snapshot) return
      if (snapshot.connection === "disconnected" || chat.phase() === "reconnecting") return "error" as const
      return hostedActivity(chat)
    },
    activity(directory: string, target: KiloHostedRpc.Target) {
      revision()
      const entry = entries.get(identity(directory, target))
      return entry ? hostedActivity(entry.chat) : "idle"
    },
    acquire(directory: string, target: KiloHostedRpc.Target) {
      const key = identity(directory, target)
      const existing = entries.get(key)
      const entry = existing ?? { directory, chat: createHostedChat(api, directory, target), expiry: undefined }
      clearTimeout(entry.expiry)
      entries.delete(key)
      entries.set(key, entry)
      if (!existing) {
        entry.chat.open()
        bump((v) => v + 1)
      }
      if (entries.size > 3) {
        const oldest = entries.entries().next().value!
        discard(...oldest)
      }
      return {
        chat: entry.chat,
        release() {
          if (entries.get(key) === entry) entry.expiry = setTimeout(() => discard(key, entry), 30_000)
        },
      }
    },
    clear(directory?: string) {
      for (const [key, entry] of entries) if (!directory || entry.directory === directory) discard(key, entry)
    },
  }
}

export type CloudSessionPool = ReturnType<typeof createSessionPool>
