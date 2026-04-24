import type { Message } from "../types/messages"

export function resolveSessionAgent(messages: Message[], names: Set<string>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const name = messages[i]?.agent?.trim()
    if (!name) continue
    if (!names.has(name)) continue
    return name
  }
}
