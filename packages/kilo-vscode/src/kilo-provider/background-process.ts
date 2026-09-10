import type { KiloClient } from "../backend/index"

export async function stopSessionProcesses(
  client: KiloClient | null,
  sessionID: string,
  directory: string,
): Promise<void> {
  if (!client) return
  await client.backgroundProcess
    .stopSession({ sessionID, directory }, { throwOnError: true })
    .catch((err: unknown) => console.warn("[Kilo New] KiloProvider: Failed to stop background processes:", err))
}
