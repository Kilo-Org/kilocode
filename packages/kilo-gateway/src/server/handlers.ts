import { KILO_API_BASE } from "../api/constants.js"
import { buildKiloHeaders } from "../headers.js"

export type KiloAuth =
  | { type: "api"; key: string }
  | { type: "oauth"; access: string; refresh: string; expires: number; accountId?: string }
  | { type: "wellknown"; key: string; token: string }

export interface CloudSessionsInput {
  cursor?: string
  limit?: number
  gitUrl?: string
}

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function getToken(auth: KiloAuth | undefined) {
  if (auth?.type === "api") return auth.key
  if (auth?.type === "oauth") return auth.access
  return undefined
}

export function getOrganizationId(auth: KiloAuth | undefined) {
  if (auth?.type === "oauth") return auth.accountId
  return undefined
}

export async function getCloudSessions(token: string, input: CloudSessionsInput) {
  const query: Record<string, unknown> = {}
  if (input.cursor) query.cursor = input.cursor
  if (input.limit) query.limit = input.limit
  if (input.gitUrl) query.gitUrl = input.gitUrl

  const params = new URLSearchParams({
    batch: "1",
    input: JSON.stringify({ "0": query }),
  })

  const response = await fetch(`${KILO_API_BASE}/api/trpc/cliSessionsV2.list?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...buildKiloHeaders(),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    console.error("[Kilo Gateway] cloud-sessions: tRPC request failed", {
      status: response.status,
      body: text.slice(0, 500),
    })
    throw new GatewayError(`Cloud sessions fetch failed: ${response.status}`, response.status)
  }

  const raw = await response.text()
  const json = JSON.parse(raw)
  const data = Array.isArray(json) ? json[0]?.result?.data : null
  const result = data?.json ?? data
  if (!result) return { cliSessions: [], nextCursor: null }

  const cliSessions = (result.cliSessions ?? []).map((item: any) => ({
    session_id: item.session_id,
    title: item.title ?? null,
    created_at:
      typeof item.created_at === "string"
        ? item.created_at
        : item.created_at
          ? new Date(item.created_at).toISOString()
          : new Date().toISOString(),
    updated_at:
      typeof item.updated_at === "string"
        ? item.updated_at
        : item.updated_at
          ? new Date(item.updated_at).toISOString()
          : new Date().toISOString(),
    version: item.version ?? 0,
  }))

  return { cliSessions, nextCursor: result.nextCursor ?? null }
}
