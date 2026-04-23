/**
 * KiloClaw Stream Chat client wrapper for the VS Code extension host.
 *
 * Port of packages/opencode/src/kilocode/claw/client.ts adapted for Node.js.
 * No Bun patches needed — the extension host runs in standard Node.js.
 * stream-chat resolves to its Node.js CJS entry point automatically.
 */

import type { Channel, Event } from "stream-chat"
import type { ChatCredentials, ChatMessage } from "./types"

export type ClawChatClient = {
  channel: Channel
  disconnect: () => Promise<void>
  send: (text: string) => Promise<void>
  onMessage: (cb: (msg: ChatMessage) => void) => () => void
  onMessageUpdated: (cb: (msg: ChatMessage) => void) => () => void
  onPresence: (cb: (online: boolean) => void) => () => void
}

function botId(creds: ChatCredentials): string {
  return `bot-${creds.channelId.replace(/^default-/, "")}`
}

function toMessage(raw: Record<string, unknown>, bot: string): ChatMessage {
  const user = raw.user as Record<string, unknown> | undefined
  const uid = (user?.id as string) ?? (raw.user_id as string) ?? ""
  return {
    id: (raw.id as string) ?? "",
    text: (raw.text as string) ?? "",
    user: uid,
    created: raw.created_at ? new Date(raw.created_at as string).toISOString() : new Date().toISOString(),
    bot: uid === bot,
  }
}

export async function connect(creds: ChatCredentials): Promise<ClawChatClient> {
  const { StreamChat } = await import("stream-chat")
  // Use a fresh instance instead of the singleton to avoid stale state
  // (cached channels, event listeners) when credentials rotate.
  const client = new StreamChat(creds.apiKey)

  await client.connectUser({ id: creds.userId }, creds.userToken)

  const channel = client.channel("messaging", creds.channelId)
  try {
    await channel.watch({ presence: true })
  } catch (err) {
    // Disconnect the user to avoid leaking a partial connection
    await client.disconnectUser().catch(() => {})
    throw err
  }

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
      const handler = (event: Event) => {
        if (event.message) cb(toMessage(event.message as unknown as Record<string, unknown>, bot))
      }
      channel.on("message.new", handler)
      return () => channel.off("message.new", handler)
    },
    onMessageUpdated(cb) {
      const handler = (event: Event) => {
        if (event.message) cb(toMessage(event.message as unknown as Record<string, unknown>, bot))
      }
      channel.on("message.updated", handler)
      return () => channel.off("message.updated", handler)
    },
    onPresence(cb) {
      const handler = (event: Event) => {
        if (event.user?.id === bot) {
          cb(event.user.online ?? false)
        }
      }
      client.on("user.presence.changed", handler)
      return () => client.off("user.presence.changed", handler)
    },
  }
}

export function history(channel: Channel, bot: string): ChatMessage[] {
  const state = channel.state.messages
  return state.map((raw) => toMessage(raw as unknown as Record<string, unknown>, bot))
}

export function presence(channel: Channel, bot: string): boolean {
  const member = channel.state.members?.[bot]
  return !!member?.user?.online
}
