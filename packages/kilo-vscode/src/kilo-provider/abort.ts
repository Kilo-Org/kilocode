import type { KiloClient } from "@kilocode/sdk/v2/client"

export function parseQueued(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is string => typeof id === "string")
}

export async function abortSession(input: {
  client: KiloClient
  sessionID: string
  dir: string
  queuedMessageIDs: string[]
}) {
  await input.client.session.abort({ sessionID: input.sessionID, directory: input.dir }, { throwOnError: true })

  for (const mid of new Set(input.queuedMessageIDs)) {
    await input.client.session
      .deleteMessage({ sessionID: input.sessionID, messageID: mid, directory: input.dir }, { throwOnError: true })
      .catch((err) => console.error("[Kilo New] KiloProvider: Failed to remove queued message:", err))
  }
}
