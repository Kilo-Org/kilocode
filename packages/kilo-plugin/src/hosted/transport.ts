import { KiloHeaders, KiloServer, type KiloAccount } from "@kilocode/gateway-core"
import { Schema } from "effect"
import { HostedError, SessionUnavailable, invalid } from "./error"

const Token = Schema.Struct({
  token: Schema.String.check(Schema.isPattern(/^[\x21-\x7e]{1,8192}$/)),
  expiresAt: Schema.String,
})
const web = "https://kilo.ai"
const cloud = "https://cloud-agent-next.kilosessions.ai"

/** Configuration comes only from the server process. HTTP is restricted to explicit loopback fixtures. */
function origin(raw: string) {
  if (!/^https?:\/\/[^/?#\\@%\s]+\/?$/.test(raw) || !URL.canParse(raw)) return
  const url = new URL(raw)
  if (url.hostname.endsWith(".")) return
  if (url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url.origin
}

export function deployment(account: KiloAccount.Info, env: NodeJS.ProcessEnv) {
  const issuer = origin(env.KILO_WEB_APP_URL ?? web)
  const worker = origin(env.CLOUD_AGENT_NEXT_BASE_URL ?? cloud)
  if (!issuer || !worker || issuer === worker) return
  // Never forward a customer-server or URL-bound token to the public issuer.
  const server = origin(account.server)
  if (
    !server ||
    server !== origin(env.KILO_API_URL ?? KiloServer.DEFAULT_API_URL) ||
    KiloServer.fromToken(account.token)
  )
    return
  if (
    server !== KiloServer.DEFAULT_API_URL &&
    (!env.KILO_WEB_APP_URL || !env.CLOUD_AGENT_NEXT_BASE_URL || issuer === web)
  )
    return
  if (account.organizationID !== null && !Schema.is(Schema.String.check(Schema.isUUID()))(account.organizationID))
    return
  return { issuer, worker }
}

export async function json(response: Response, limit: number): Promise<unknown> {
  if (!response.body) return invalid()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.length
      if (bytes > limit) {
        await reader.cancel()
        return invalid()
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return invalid()
  }
}

export function responseError(response: Response): never {
  void response.body?.cancel().catch(() => {})
  if (response.status === 401 || response.status === 403)
    throw new SessionUnavailable("Kilo Cloud denied access to this account or workspace")
  if (response.status === 404) throw new HostedError("Cloud workspace or session was not found")
  if (response.status === 402) throw new HostedError("Kilo Cloud requires credit for this operation")
  if (response.status === 409) throw new HostedError("Kilo Cloud reported a conflict; refresh the workspace")
  throw new HostedError(`Kilo Cloud request failed (HTTP ${response.status})`)
}

export function createTransport(
  account: KiloAccount.Info,
  origins: { issuer: string; worker: string },
  version: string,
  lifetime: AbortSignal,
) {
  let cached: { token: string; expires: number } | undefined
  const org = account.organizationID
  const headers = KiloHeaders.provider({ organizationID: org, version, platform: "agent-manager" })

  async function token(signal: AbortSignal) {
    if (cached && cached.expires > Date.now() + 60_000) return cached.token
    const response = await fetch(`${origins.issuer}/api/cloud-agent-next/token`, {
      method: "POST",
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { ...headers, "Content-Type": "application/json", Authorization: `Bearer ${account.token}` },
      body: JSON.stringify(org ? { organizationId: org } : {}),
    })
    if (!response.ok) return responseError(response)
    const value = await json(response, 64 * 1024)
    if (!Schema.is(Token)(value)) return invalid()
    const expires = Date.parse(value.expiresAt)
    if (!(expires > Date.now()) || value.token === account.token) return invalid()
    signal.throwIfAborted()
    cached = { token: value.token, expires }
    return value.token
  }

  return async function request(path: string, init: RequestInit) {
    const url = new URL(path, origins.worker)
    if (
      url.origin !== origins.worker ||
      !/^\/(?:trpc|kilo)\//.test(url.pathname) ||
      url.username ||
      url.password ||
      url.hash
    ) {
      throw new HostedError("Invalid Kilo Cloud route")
    }
    const signal = init.signal ? AbortSignal.any([init.signal, lifetime]) : lifetime
    const control = await token(signal)
    signal.throwIfAborted()
    const workerHeaders = new Headers(init.headers)
    for (const [key, value] of Object.entries(headers)) workerHeaders.set(key, value)
    workerHeaders.set("Authorization", `Bearer ${control}`)
    const response = await fetch(url, {
      ...init,
      headers: workerHeaders,
      credentials: "omit",
      redirect: "error",
      signal,
    })
    // No implicit retry: a mutation may already have been accepted.
    if (response.status === 401) cached = undefined
    return response
  }
}
