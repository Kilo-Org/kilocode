// kilocode_change - new file

/**
 * KiloClaw Stream Chat client wrapper
 *
 * Headless Stream Chat JS SDK integration for the TUI.
 * Uses the same channel/credentials as the web dashboard's ChatTab.
 *
 * stream-chat is dynamically imported to avoid crashing Bun at module
 * load time (follow-redirects uses Error.captureStackTrace in a way
 * that is incompatible with Bun's runtime).
 */

import type { ChatCredentials, ChatMessage } from "./types"
import { Log } from "@/util/log"

const log = Log.create({ service: "claw-chat" })

export type ClawChatClient = {
  channel: any
  disconnect: () => Promise<void>
  send: (text: string) => Promise<void>
  onMessage: (cb: (msg: ChatMessage) => void) => () => void
  onMessageUpdated: (cb: (msg: ChatMessage) => void) => () => void
  onPresence: (cb: (online: boolean) => void) => () => void
}

export function botId(creds: ChatCredentials): string {
  return `bot-${creds.channelId.replace(/^default-/, "")}`
}

function toMessage(raw: any, bot: string): ChatMessage {
  return {
    id: raw.id ?? "",
    text: raw.text ?? "",
    user: raw.user?.id ?? raw.user_id ?? "",
    created: raw.created_at ? new Date(raw.created_at) : new Date(),
    bot: (raw.user?.id ?? raw.user_id ?? "") === bot,
  }
}

/**
 * Apply Bun compatibility patches for stream-chat and its dependencies.
 *
 * 1. Error.captureStackTrace — follow-redirects passes a plain object with
 *    Error.prototype in its chain which crashes Bun.
 * 2. net.Socket.prototype.destroy — Bun throws "First argument must be an
 *    Error object" when destroy() receives a non-Error. The ws library and
 *    stream-chat internals can trigger this during WebSocket lifecycle events.
 *
 * Both patches are applied once and remain active for the process lifetime.
 */
let patched = false
function applyBunPatches() {
  if (patched) return
  patched = true

  const orig = Error.captureStackTrace
  if (orig) {
    Error.captureStackTrace = function safe(target: any, ctor?: Function) {
      try {
        return orig.call(Error, target, ctor)
      } catch {
        // Bun throws when target is not a real Error (e.g. follow-redirects
        // CustomError which has Error.prototype in its chain but is not
        // constructed via `new Error()`). Silently skip.
      }
    } as typeof Error.captureStackTrace
  }

  try {
    const net = require("net")
    const origDestroy = net.Socket.prototype.destroy
    net.Socket.prototype.destroy = function (err: any, cb: any) {
      if (err != null && !(err instanceof Error)) {
        err = new Error(String(err))
      }
      return origDestroy.call(this, err, cb)
    }
  } catch {
    // net module unavailable — skip socket patch
  }
}

async function loadStreamChat() {
  applyBunPatches()
  const mod = await import("stream-chat")
  return mod.StreamChat
}

export async function connect(creds: ChatCredentials): Promise<ClawChatClient> {
  log.info("loading stream-chat")
  const StreamChat = await loadStreamChat()
  log.info("getInstance", { key: creds.apiKey?.substring(0, 8) + "..." })
  const client = StreamChat.getInstance(creds.apiKey)

  // getInstance returns a singleton — ensure any stale connection is
  // cleaned up before (re-)connecting so navigate-away-and-back works.
  if (client.userID) {
    log.info("disconnecting stale user", { user: client.userID })
    await client.disconnectUser()
  }

  log.info("connectUser", { user: creds.userId })
  await client.connectUser({ id: creds.userId }, creds.userToken)

  log.info("watching channel", { channel: creds.channelId })
  const channel = client.channel("messaging", creds.channelId)
  await channel.watch({ presence: true })

  log.info("connected successfully")
  const bot = botId(creds)

  return {
    channel,
    async disconnect() {
      await client.disconnectUser()
    },
    async send(text: string) {
      await channel.sendMessage({ text })
    },
    onMessage(cb) {
      const handler = (event: any) => {
        if (event.message) cb(toMessage(event.message, bot))
      }
      channel.on("message.new", handler)
      return () => channel.off("message.new", handler)
    },
    onMessageUpdated(cb) {
      const handler = (event: any) => {
        if (event.message) cb(toMessage(event.message, bot))
      }
      channel.on("message.updated", handler)
      return () => channel.off("message.updated", handler)
    },
    onPresence(cb) {
      const handler = (event: any) => {
        if (event.user?.id === bot) {
          cb(event.user.online ?? false)
        }
      }
      client.on("user.presence.changed", handler)
      return () => client.off("user.presence.changed", handler)
    },
  }
}

export async function history(channel: any, bot: string): Promise<ChatMessage[]> {
  const state = channel.state.messages
  return state.map((raw: any) => toMessage(raw, bot))
}

/**
 * Read the bot's initial online status from channel member state.
 * Mirrors the cloud's `useBotOnlineStatus` which reads
 * `channel.state.members[botUserId]?.user?.online`.
 */
export function presence(channel: any, bot: string): boolean {
  const member = channel.state.members?.[bot]
  return !!member?.user?.online
}
