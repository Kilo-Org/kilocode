import type { KiloClient, Session } from "@kilocode/sdk/v2/client"
import { parseSessionTitle } from "../shared/session-title"

export async function renameSession(input: {
  client: KiloClient | null
  sessionID: string
  title: unknown
  directory: string
}): Promise<Session> {
  if (!input.client) throw new Error("Not connected to CLI backend")
  const result = parseSessionTitle(input.title)
  if ("error" in result) throw new Error("Invalid session title")
  const { data } = await input.client.session.update(
    { sessionID: input.sessionID, directory: input.directory, title: result.value },
    { throwOnError: true },
  )
  return data
}
