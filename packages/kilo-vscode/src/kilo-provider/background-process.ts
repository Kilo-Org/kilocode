import type { KiloClient } from "@kilocode/sdk/v2/client"

export async function stopSessionProcesses(
  client: KiloClient | null,
  sessionID: string,
  directory: string,
): Promise<void> {
  if (!client) return
  await client.backgroundProcess
    .stopSession({ sessionID, directory })
    .catch((err: unknown) => console.warn("[Kilo New] KiloProvider: Failed to stop background processes:", err))
}
