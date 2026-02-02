import { Bus } from "@/bus"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message-v2"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"
import { Auth } from "@/auth"
import { IngestQueue } from "@/kilo-sessions/ingest-queue"
import { clearInFlightCache, withInFlightCache } from "@/kilo-sessions/inflight-cache"
import type * as SDK from "@kilocode/sdk/v2"
import z from "zod"

export namespace KiloSessions {
  const log = Log.create({ service: "kilo-sessions" })

  const Uuid = z.uuid()
  type Uuid = z.infer<typeof Uuid>

  const tokenValidKeyTemplate = "kilo-sessions:token-valid:"
  let tokenValidKey = tokenValidKeyTemplate + "unknown"

  const tokenKey = "kilo-sessions:token"
  const orgKey = "kilo-sessions:org"
  const clientKey = "kilo-sessions:client"

  const ttlMs = 10_000

  function clearCache() {
    clearInFlightCache(tokenKey)
    clearInFlightCache(tokenValidKey)
    clearInFlightCache(clientKey)
    clearInFlightCache(orgKey)
  }

  async function authValid(token: string) {
    const newTokenValidKey = tokenValidKeyTemplate + token

    if (newTokenValidKey !== tokenValidKey) {
      clearInFlightCache(tokenValidKey)

      tokenValidKey = newTokenValidKey
    }

    return withInFlightCache(tokenValidKey, 15 * 60_000, async () => {
      const response = await fetch("https://app.kilo.ai/api/user", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => undefined)

      // Don't cache transient network failures; allow future calls to retry.
      if (!response) return undefined

      const valid = response.ok
      return valid
    })
  }

  async function kilocodeToken() {
    return withInFlightCache(tokenKey, ttlMs, async () => {
      const auth = await Auth.get("kilo")
      if (auth?.type === "api" && auth.key.length > 0) return auth.key
      if (auth?.type === "oauth" && auth.access.length > 0) return auth.access
      if (auth?.type === "wellknown" && auth.token.length > 0) return auth.token
      return undefined
    })
  }

  type Client = {
    url: string
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }

  async function getClient(): Promise<Client | undefined> {
    return withInFlightCache(clientKey, ttlMs, async () => {
      const token = await kilocodeToken()
      if (!token) return undefined

      const valid = await authValid(token)
      if (!valid) return undefined

      const base = process.env["KILO_SESSION_INGEST_URL"] ?? "https://ingest.kilosessions.ai"
      const baseHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      }

      const withHeaders = (init?: RequestInit) => {
        const headers = new Headers(init?.headers)
        for (const [k, v] of Object.entries(baseHeaders)) headers.set(k, v)
        return {
          ...init,
          headers,
        } satisfies RequestInit
      }

      return {
        url: base,
        fetch: (input, init) => fetch(input, withHeaders(init)),
      }
    })
  }

  const ingest = IngestQueue.create({
    getShare: async (sessionId) => get(sessionId).catch(() => undefined),
    getClient,
    log,
    onAuthError: () => {
      // Non-retryable until credentials are fixed.
      // Clearing caches prevents repeated use of a now-invalid token/client.
      clearCache()
    },
  })

  const shareDisabled = process.env["KILO_DISABLE_SHARE"] === "true" || process.env["KILO_DISABLE_SHARE"] === "1"
  const ingestDisabled =
    process.env["KILO_DISABLE_SESSION_INGEST"] === "true" || process.env["KILO_DISABLE_SESSION_INGEST"] === "1"

  export async function init() {
    if (ingestDisabled) return

    Bus.subscribe(Session.Event.Created, (evt) => {
      const sessionId = evt.properties.info.id
      void create(sessionId).catch((error) => log.error("share init create failed", { sessionId, error }))
    })

    Bus.subscribe(Session.Event.Updated, async (evt) => {
      await ingest.sync(evt.properties.info.id, [
        {
          type: "kilo_meta",
          data: await meta(),
        },
        {
          type: "session",
          data: evt.properties.info,
        },
      ])
    })

    Bus.subscribe(MessageV2.Event.Updated, async (evt) => {
      await ingest.sync(evt.properties.info.sessionID, [
        {
          type: "message",
          data: evt.properties.info,
        },
      ])

      if (evt.properties.info.role === "user") {
        await ingest.sync(evt.properties.info.sessionID, [
          {
            type: "model",
            data: [
              await Provider.getModel(evt.properties.info.model.providerID, evt.properties.info.model.modelID).then(
                (m) => m,
              ),
            ],
          },
        ])
      }
    })

    Bus.subscribe(MessageV2.Event.PartUpdated, async (evt) => {
      await ingest.sync(evt.properties.part.sessionID, [
        {
          type: "part",
          data: evt.properties.part,
        },
      ])
    })

    Bus.subscribe(Session.Event.Diff, async (evt) => {
      await ingest.sync(evt.properties.sessionID, [
        {
          type: "session_diff",
          data: evt.properties.diff,
        },
      ])
    })
  }

  export async function create(sessionId: string) {
    const client = await getClient()
    if (!client) return { id: "", ingestPath: "" }

    log.info("creating session", { sessionId })

    const response = await client.fetch(`${client.url}/api/session`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    })

    if (!response.ok) {
      throw new Error(`Unable to create session ${sessionId}: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as { id: string; ingestPath: string }

    await Storage.write(["session_share", sessionId], result)

    void fullSync(sessionId).catch((error) => log.error("share full sync failed", { sessionId, error }))

    return result
  }

  export async function share(sessionId: string) {
    if (ingestDisabled) {
      throw new Error("Session ingest is disabled (KILO_DISABLE_SESSION_INGEST=1)")
    }

    if (shareDisabled) {
      throw new Error("Sharing is disabled (KILO_DISABLE_SHARE=1)")
    }

    const client = await getClient()
    if (!client) {
      throw new Error("Unable to share session: no Kilo credentials found. Run `kilo auth login`.")
    }

    const current = (await get(sessionId).catch(() => undefined)) ?? (await create(sessionId))
    if (!current.id || !current.ingestPath) {
      throw new Error(`Unable to share session ${sessionId}: failed to initialize session sync.`)
    }

    log.info("sharing", { sessionId })

    const response = await client.fetch(`${client.url}/api/session/${encodeURIComponent(sessionId)}/share`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    })

    if (!response.ok) {
      throw new Error(`Unable to share session ${sessionId}: ${response.status} ${response.statusText}`)
    }

    const result = (await response.json()) as { public_id?: string }
    if (!result.public_id) {
      throw new Error(`Unable to share session ${sessionId}: server did not return a public id`)
    }

    const url = `https://app.kilo.ai/s/${result.public_id}`

    await Storage.write(["session_share", sessionId], {
      ...current,
      url,
    })

    return { url }
  }

  export async function unshare(sessionId: string) {
    if (ingestDisabled) {
      throw new Error("Session ingest is disabled (KILO_DISABLE_SESSION_INGEST=1)")
    }

    if (shareDisabled) {
      throw new Error("Unshare is disabled (KILO_DISABLE_SHARE=1)")
    }

    const client = await getClient()
    if (!client) {
      throw new Error("Unable to unshare session: no Kilo credentials found. Run `kilo auth login`.")
    }

    log.info("unsharing", { sessionId })

    const response = await client.fetch(`${client.url}/api/session/${encodeURIComponent(sessionId)}/unshare`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    })

    if (!response.ok) {
      throw new Error(`Unable to unshare session ${sessionId}: ${response.status} ${response.statusText}`)
    }

    const current = await get(sessionId).catch(() => undefined)
    if (!current) return

    const next = {
      ...current,
    }
    delete next.url

    await Storage.write(["session_share", sessionId], next)
  }

  function get(sessionId: string) {
    return Storage.read<{
      id: string
      url?: string
      ingestPath: string
    }>(["session_share", sessionId])
  }

  export async function remove(sessionId: string) {
    const client = await getClient()
    if (!client) return

    log.info("removing share", { sessionId })

    const share = await get(sessionId)
    if (!share) return

    const response = await client
      .fetch(`${client.url}/api/session/${encodeURIComponent(share.id)}`, {
        method: "DELETE",
      })
      .catch(() => undefined)

    if (!response) {
      log.error("share remove failed", { sessionId, error: "network" })
      return
    }

    if (!response.ok) {
      log.error("share remove failed", {
        sessionId,
        status: response.status,
        statusText: response.statusText,
      })
      return
    }

    await Storage.remove(["session_share", sessionId])
  }

  async function fullSync(sessionId: string) {
    log.info("full sync", { sessionId })

    const session = await Session.get(sessionId)
    const diffs = await Session.diff(sessionId)
    const messages = await Array.fromAsync(MessageV2.stream(sessionId))
    const models = await Promise.all(
      messages
        .filter((m) => m.info.role === "user")
        .map((m) => (m.info as SDK.UserMessage).model)
        .map((m) => Provider.getModel(m.providerID, m.modelID).then((m) => m)),
    )

    await ingest.sync(sessionId, [
      {
        type: "kilo_meta",
        data: await meta(),
      },
      {
        type: "session",
        data: session,
      },
      ...messages.map((x) => ({
        type: "message" as const,
        data: x.info,
      })),
      ...messages.flatMap((x) => x.parts.map((y) => ({ type: "part" as const, data: y }))),
      {
        type: "session_diff",
        data: diffs,
      },
      {
        type: "model",
        data: models,
      },
    ])
  }

  async function meta() {
    const platform = process.env["KILO_PLATFORM"] || "cli"
    const orgId = await getOrgId()

    return {
      platform,
      ...(orgId ? { orgId } : {}),
    }
  }

  async function getOrgId(): Promise<Uuid | undefined> {
    const env = process.env["KILO_ORG_ID"]
    if (isUuid(env)) return env

    return withInFlightCache(orgKey, ttlMs, async () => {
      const auth = await Auth.get("kilo")
      if (auth?.type === "oauth" && isUuid(auth.accountId)) return auth.accountId
      return undefined
    })
  }

  function isUuid(value: string | undefined): value is Uuid {
    if (!value) return false
    return Uuid.safeParse(value).success
  }
}
