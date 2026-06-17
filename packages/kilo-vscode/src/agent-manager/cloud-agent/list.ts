import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { CloudAgentSessionSummary } from "./types"

type ListOptions = {
  client: KiloClient
  gitUrl: string
}

const INVALID_RESPONSE = "Cloud Agent session list returned an invalid response"

export async function listCloudAgentSessions(opts: ListOptions): Promise<CloudAgentSessionSummary[]> {
  const res = await opts.client.kilo.cloudSessions({ gitUrl: opts.gitUrl, limit: 100 }, { throwOnError: true })
  if (!res.data || !Array.isArray(res.data.cliSessions)) throw new Error(INVALID_RESPONSE)
  return res.data.cliSessions.map((item) => ({
    id: item.session_id,
    title: item.title?.trim() || "Untitled Cloud Agent",
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  }))
}
