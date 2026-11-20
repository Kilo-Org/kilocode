import { KiloAccount, KiloServer } from "@kilocode/gateway-core"
import { KiloCloudHistoryRpc } from "@opencode/schema/kilocode/cloud-history"
import { createHash } from "node:crypto"
import { Schema } from "effect"

const origin = "https://session-sync.kiloapps.io"
const natural = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Tenant = Schema.Struct({ type: Schema.Literals(["user", "organization"]), id: Schema.NonEmptyString })
const Grant = Schema.Struct({
  version: Schema.Literal(1),
  token: Schema.NonEmptyString,
  userID: Schema.NonEmptyString,
  tenant: Tenant,
})
const Catalog = Schema.Struct({
  version: Schema.Literal(1),
  cursor: Schema.NullOr(Schema.String),
  items: Schema.Array(Schema.Struct({ sessionID: KiloCloudHistoryRpc.CloudID, tenant: Tenant, createdAt: natural })),
})
export const Blob = Schema.Struct({
  hash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  bytes: natural.check(Schema.isLessThanOrEqualTo(8 * 1024 * 1024)),
})
const Header = { kind: Schema.String, id: Schema.NonEmptyString, revision: natural }
const Page = Schema.Struct({
  version: Schema.Literal(1),
  sessionID: KiloCloudHistoryRpc.CloudID,
  revision: natural,
  position: natural,
  next: Schema.NullOr(Schema.String),
  entities: Schema.Array(
    Schema.Union([Schema.Struct({ ...Header, value: Schema.Json }), Schema.Struct({ ...Header, blob: Blob })]),
  ),
})
export type Entity = { kind: string; id: string; value: Schema.Json }
export type BlobReader = (blob: typeof Blob.Type) => Promise<Buffer>

export class CloudError extends Error {}
export const invalid = () =>
  new CloudError("Kilo Cloud returned an invalid or incomplete native transcript. Nothing was imported.")

export function decode<S extends Schema.Top>(schema: S & { readonly DecodingServices: never }, value: unknown) {
  const result = Schema.decodeUnknownOption(schema)(value)
  if (result._tag === "None") throw invalid()
  return result.value
}

async function bounded(response: Response, limit: number) {
  const reader = response.body?.getReader()
  if (!reader) throw invalid()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return Buffer.concat(chunks, size)
      size += value.length
      if (size > limit) throw new CloudError("Cloud history exceeds the supported import size. Nothing was imported.")
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function eligible(account: KiloAccount.Info | undefined) {
  if (!account || account.token === KiloAccount.ANONYMOUS_KEY)
    throw new CloudError("Sign in to Kilo Gateway to open cloud history.")
  if (
    account.server !== KiloServer.DEFAULT_API_URL ||
    ![KiloServer.DEFAULT_AI_GATEWAY_URL, `${KiloServer.DEFAULT_API_URL}/api/gateway/v1`].includes(account.baseURL) ||
    KiloServer.fromToken(account.token)
  )
    throw new CloudError("Native cloud history requires the production Kilo Gateway.")
  return account
}

export async function reader(
  readAccount: () => KiloAccount.Info | undefined,
  signal: AbortSignal,
  transport: typeof fetch = fetch,
) {
  const account = eligible(readAccount())
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)])
  const current = () => {
    const now = eligible(readAccount())
    if (now.token !== account.token || now.organizationID !== account.organizationID)
      throw new CloudError("The active Kilo account changed. Reopen cloud history.")
  }
  const send = async (route: string, token: string, limit: number, body?: string) => {
    current()
    const response = await transport(origin + route, {
      method: body ? "POST" : "GET",
      body,
      redirect: "error",
      signal: deadline,
      headers: { authorization: `Bearer ${token}`, ...(body && { "content-type": "application/json" }) },
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw new CloudError(
        response.status === 409
          ? "Cloud history changed while reading. Retry the import."
          : `Cloud history request failed (HTTP ${response.status}). Verify your active Kilo account and team.`,
      )
    }
    const bytes = await bounded(response, limit)
    current()
    return bytes
  }
  const grant = decode(
    Grant,
    JSON.parse(
      (
        await send(
          "/v1/auth/exchange",
          account.token,
          16_384,
          JSON.stringify({ version: 1, ...(account.organizationID && { organizationID: account.organizationID }) }),
        )
      ).toString(),
    ),
  )
  if (
    grant.tenant.id !== (account.organizationID ?? grant.userID) ||
    grant.tenant.type !== (account.organizationID ? "organization" : "user")
  )
    throw invalid()
  const get = (route: string, limit: number) => send(route, grant.token, limit)
  return {
    list: async (input: typeof KiloCloudHistoryRpc.List.Type) => {
      const query = new URLSearchParams({ limit: String(input.limit), ...(input.cursor && { cursor: input.cursor }) })
      const page = decode(Catalog, JSON.parse((await get(`/v1/sessions?${query}`, 256 * 1024)).toString()))
      return {
        items: page.items
          .filter((item) => item.tenant.id === grant.tenant.id && item.tenant.type === grant.tenant.type)
          .map(({ sessionID, createdAt }) => ({ sessionID, createdAt })),
        cursor: page.cursor,
      }
    },
    snapshot: (sessionID: string) => snapshot(get, decode(KiloCloudHistoryRpc.CloudID, sessionID)),
  }
}

async function snapshot(get: (route: string, limit: number) => Promise<Buffer>, sessionID: string) {
  const root = `/v1/sessions/${encodeURIComponent(sessionID)}`
  const entities: Entity[] = []
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let budget = 32 * 1024 * 1024
  let revision: number | undefined
  let position: number | undefined
  let cursor: string | null = null
  const bytes = async (route: string, limit: number) => {
    const buffer = await get(route, Math.min(budget, limit))
    budget -= buffer.byteLength
    return buffer
  }
  const blob: BlobReader = async (ref) => {
    const data = await bytes(`${root}/blobs/${ref.hash}`, ref.bytes)
    if (data.length !== ref.bytes || createHash("sha256").update(data).digest("hex") !== ref.hash) throw invalid()
    return data
  }
  do {
    const query = new URLSearchParams({ limit: "100" })
    if (revision !== undefined) query.set("revision", String(revision))
    if (cursor) query.set("cursor", cursor)
    const page = decode(Page, JSON.parse((await bytes(`${root}/entities?${query}`, 2 * 1024 * 1024)).toString()))
    revision ??= page.revision
    position ??= page.position
    if (page.sessionID !== sessionID || revision !== page.revision || position !== page.position) throw invalid()
    for (const item of page.entities) {
      if (!["session", "message", "message-part", "asset"].includes(item.kind)) continue
      const key = `${item.kind}:${item.id}`
      if (ids.has(key) || item.revision > revision) throw invalid()
      ids.add(key)
      const value = "value" in item ? item.value : decode(Schema.Json, JSON.parse((await blob(item.blob)).toString()))
      entities.push({ kind: item.kind, id: item.id, value })
    }
    cursor = page.next
    if (cursor !== null) {
      if (!cursor || cursors.has(cursor) || cursors.size >= 1024) throw invalid()
      cursors.add(cursor)
    }
  } while (cursor !== null)
  return { sessionID, entities, position, blob }
}
