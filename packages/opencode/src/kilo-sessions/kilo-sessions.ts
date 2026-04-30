import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Provider } from "@/provider"
import { Session } from "@/session"
import { SessionSummary } from "@/session/summary"
import { KiloSession } from "@/kilocode/session"
import { SessionID } from "@/session/schema"
import { ModelID, ProviderID } from "@/provider/schema"
import { MessageV2 } from "@/session/message-v2"
import { Storage } from "@/storage"
import { Log } from "@/util"
import { Auth } from "@/auth"
import { IngestQueue } from "@/kilo-sessions/ingest-queue"
import { clearInFlightCache, withInFlightCache } from "@/kilo-sessions/inflight-cache"
import type * as SDK from "@kilocode/sdk/v2"
import z from "zod"
import { Schema } from "effect"
import { KILO_API_BASE } from "@kilocode/kilo-gateway"
import { Config } from "@/config"
import { Instance } from "@/project/instance"
import { Vcs } from "@/project"
import simpleGit from "simple-git"
import { RemoteWS } from "@/kilo-sessions/remote-ws"
import { RemoteSender } from "@/kilo-sessions/remote-sender"
import { SessionStatus } from "@/session/status"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { Question } from "@/question"
import { Permission } from "@/permission"
import { withTimeout } from "@/util/timeout"

export namespace KiloSessions {
  export const Event = {
    RemoteStatusChanged: BusEvent.define(
      "kilo-sessions.remote-status-changed",
      Schema.Struct({
        enabled: Schema.Boolean,
        connected: Schema.Boolean,
      }),
    ),
  }

  const log = Log.create({ service: "kilo-sessions" })

  const Uuid = z.uuid()
  type Uuid = z.infer<typeof Uuid>

  const tokenValidKeyTemplate = "kilo-sessions:token-valid:"
  let tokenValidKey = tokenValidKeyTemplate + "unknown"

  const tokenKey = "kilo-sessions:token"
  const orgKey = "kilo-sessions:org"
  const clientKey = "kilo-sessions:client"
  const gitUrlKeyPrefix = "kilo-sessions:git-url:"

  const ttlMs = 10_000

  function clearCache() {
    clearInFlightCache(tokenKey)
    clearInFlightCache(tokenValidKey)
    clearInFlightCache(clientKey)
    clearInFlightCache(orgKey)
    clearInFlightCache(gitUrlKeyPrefix + Instance.worktree)
  }

  async function authValid(token: string) {
    const newTokenValidKey = tokenValidKeyTemplate + token

    if (newTokenValidKey !== tokenValidKey) {
      clearInFlightCache(tokenValidKey)

      tokenValidKey = newTokenValidKey
    }

    return withInFlightCache(tokenValidKey, 15 * 60_000, async () => {
      const response = await fetch(`${KILO_API_BASE}/api/user`, {
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

  const shareDisabled = process.env["KILO_DISABLE_SHARE"] === "true" || process.env["KILO_DISABLE_SHARE"] === "1"
  const ingestDisabled =
    process.env["KILO_DISABLE_SESSION_INGEST"] === "true" || process.env["KILO_DISABLE_SESSION_INGEST"] === "1"
  const debugIngest =
    process.env["KILO_DEBUG_SESSION_INGEST"] === "true" || process.env["KILO_DEBUG_SESSION_INGEST"] === "1"

  const ingest = IngestQueue.create({
    getShare: async (sessionId) => get(sessionId).catch(() => undefined),
    getClient,
    log: {
      ...(debugIngest ? { info: log.info.bind(log) } : {}),
      error: log.error.bind(log),
    },
    onAuthError: () => {
      // Non-retryable until credentials are fixed.
      // Clearing caches prevents repeated use of a now-invalid token/client.
      clearCache()
    },
  })

  const remoteEnabled = process.env["KILO_REMOTE"] === "1"
  let remote: { conn: RemoteWS.Connection; sender: RemoteSender.Sender; heartbeat: () => Promise<void> } | undefined
  let enabling: Promise<void> | undefined
  let remoteSeq = 0
  const focused = new Set<string>()
  const opened = new Set<string>()
  const statusSyncs = new Map<string, { running: boolean; dirty: boolean }>()
  const STATUS_TIMEOUT_MS = 3_000

  async function deriveStatus(sessionID: string): Promise<"idle" | "busy" | "question" | "permission" | "retry"> {
    const permissions = (await Permission.list()).filter((p) => p.sessionID === sessionID)
    if (permissions.length > 0) return "permission"

    const questions = (await Question.list()).filter((q) => q.sessionID === sessionID)
    if (questions.length > 0) return "question"

    const status = await SessionStatus.get(SessionID.make(sessionID))
    if (status.type === "offline") return "retry"
    return status.type
  }

  async function deriveAndSyncStatus(sessionID: string) {
    const status = await withTimeout(deriveStatus(sessionID), STATUS_TIMEOUT_MS)
    await ingest.sync(sessionID, [{ type: "session_status", data: { status } }])
  }

  export async function init() {
    if (ingestDisabled) return

    // kilocode_change start - Same type-erasure upstream uses in share/share-next.ts:165-169.
    const watch = <D extends { type: string }>(def: D, fn: (evt: { properties: any }) => unknown) =>
      Bus.subscribe(def as never, fn as never)
    // kilocode_change end

    Bus.subscribe(Session.Event.Created, (evt) => {
      const sessionId = evt.properties.info.id
      void create(sessionId).catch((error) => log.error("share init create failed", { sessionId, error }))
    })

    Bus.subscribe(Session.Event.Updated, async (evt) => {
      const sessionID = evt.properties.sessionID // kilocode_change
      const session = await Session.get(sessionID).catch(() => null) // kilocode_change
      if (!session) return
      await ingest.sync(sessionID, [
        {
          type: "kilo_meta",
          data: await meta(sessionID),
        },
        {
          type: "session",
          data: session,
        },
      ])
    })

    watch(MessageV2.Event.Updated, async (evt) => {
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

    watch(MessageV2.Event.PartUpdated, async (evt) => {
      await ingest.sync(evt.properties.part.sessionID, [
        {
          type: "part",
          data: evt.properties.part,
        },
      ])
    })

    watch(Session.Event.Diff, async (evt) => {
      await ingest.sync(evt.properties.sessionID, [
        {
          type: "session_diff",
          data: evt.properties.diff,
        },
      ])
    })

    Bus.subscribe(Session.Event.TurnOpen, async (evt) => {
      await ingest.sync(evt.properties.sessionID, [{ type: "session_open", data: {} }])
    })

    Bus.subscribe(Session.Event.TurnClose, async (evt) => {
      await ingest.sync(evt.properties.sessionID, [{ type: "session_close", data: { reason: evt.properties.reason } }])
    })

    // Session status changes (busy/idle/retry), question lifecycle, permission lifecycle.
    const syncStatus = (evt: { properties: { sessionID: string } }) => {
      const sessionID = evt.properties.sessionID
      const current = statusSyncs.get(sessionID)
      if (current?.running) {
        current.dirty = true
        return
      }

      const state = current ?? { running: false, dirty: false }
      statusSyncs.set(sessionID, state)

      const fail = (error: unknown) => {
        const dirty = state.dirty
        statusSyncs.delete(sessionID)
        log.error("status sync failed", { sessionID, error: String(error) })
        if (dirty) syncStatus(evt)
      }

      const loop = async () => {
        state.running = true
        state.dirty = false
        await deriveAndSyncStatus(sessionID)
        if (state.dirty) {
          void loop().catch(fail)
          return
        }
        statusSyncs.delete(sessionID)
      }

      void loop().catch(fail)
    }
    Bus.subscribe(SessionStatus.Event.Status, syncStatus)
    Bus.subscribe(Question.Event.Asked, syncStatus)
    Bus.subscribe(Question.Event.Replied, syncStatus)
    Bus.subscribe(Question.Event.Rejected, syncStatus)
    Bus.subscribe(Permission.Event.Asked, syncStatus)
    Bus.subscribe(Permission.Event.Replied, syncStatus)

    const cfg = await Config.getGlobal()
    if (remoteEnabled || cfg.remote_control)
      enableRemote().catch((err) => log.warn("remote not enabled", { error: String(err) }))
    // Use wildcard subscription so the dispose handler actually fires —
    // Bus.state dispose only notifies "*" subscribers, not event-type ones.
    Bus.subscribeAll((evt) => {
      if (evt.type === Bus.InstanceDisposed.type) disableRemote()
    })
  }

  export async function enableRemote() {
    if (remote) return
    if (ingestDisabled) return
    if (enabling) return enabling
    const seq = ++remoteSeq
    void Bus.publish(Event.RemoteStatusChanged, { enabled: true, connected: false })
    enabling = (async () => {
      const token = await kilocodeToken()
      if (!token) {
        throw new Error("Unable to enable remote: no Kilo credentials found. Run `kilo auth login`.")
      }

      const valid = await authValid(token)
      if (valid === false) {
        throw new Error("Unable to enable remote: invalid or expired Kilo credentials. Run `kilo auth login`.")
      }
      if (valid === undefined) throw new Error("Unable to enable remote: failed to verify Kilo credentials.")

      const url = (process.env["KILO_SESSION_INGEST_URL"] ?? "https://ingest.kilosessions.ai")
        .replace(/^https:\/\//, "wss://")
        .replace(/^http:\/\//, "ws://")

      // Capture directory so the heartbeat timer can re-enter the Instance context
      // (setInterval runs outside AsyncLocalStorage scope)
      const directory = Instance.directory
      const getSessions = async () => {
        const [gitUrl, gitBranch] = await Promise.all([
          getGitUrl().catch(() => undefined),
          Vcs.branch().catch(() => undefined),
        ])
        const statusMap = await SessionStatus.list()
        const statuses: Record<string, SessionStatus.Info> = Object.fromEntries(statusMap)
        const ids = new Set(Object.keys(statuses))
        for (const id of focused) ids.add(id)
        for (const id of opened) ids.add(id)
        const results = await Promise.all(
          [...ids].map(async (id) => {
            const session = await Session.get(SessionID.make(id)).catch(() => undefined)
            if (!session) return undefined
            return {
              id,
              status: statuses[id]?.type ?? "idle",
              title: session.title,
              parentSessionId: session.parentID,
              gitUrl,
              gitBranch,
            }
          }),
        )
        const sessions = results.filter((r): r is NonNullable<typeof r> => !!r)
        return {
          sessions,
          focused: focused.size > 0 ? [...focused] : undefined,
          open: opened.size > 0 ? [...opened] : undefined,
        }
      }

      const conn = RemoteWS.connect({
        url,
        getToken: kilocodeToken,
        withContext: (fn) => Instance.provide({ directory, fn }),
        getSessions,
        log,
        onOpen: () => {
          void Bus.publish(Event.RemoteStatusChanged, { enabled: true, connected: true })
        },
        onDisconnect: () => {
          void Bus.publish(Event.RemoteStatusChanged, { enabled: !!remote, connected: false })
        },
        onMessage: (msg) => {
          // Must run inside Instance.provide so Bus.subscribeAll can access
          // the instance-scoped subscription map via Instance.state().
          void Instance.provide({ directory, fn: () => sender.handle(msg) })
        },
        onClose: () => disableRemote(),
      })

      const sender = RemoteSender.create({
        conn,
        directory: Instance.directory,
        log,
      })

      const heartbeat = async () => {
        conn.send({ type: "heartbeat", ...(await getSessions()) })
      }

      if (seq !== remoteSeq) {
        sender.dispose()
        conn.close()
        return
      }

      remote = { conn, sender, heartbeat }
      log.info("remote connection enabled", { connected: conn.connected })
      Telemetry.trackRemoteConnectionOpened()
      void Bus.publish(Event.RemoteStatusChanged, { enabled: true, connected: conn.connected })
    })()
      .catch((err) => {
        if (remoteSeq === seq && !remote)
          void Bus.publish(Event.RemoteStatusChanged, { enabled: false, connected: false })
        throw err
      })
      .finally(() => {
        if (remoteSeq === seq) enabling = undefined
      })

    return enabling
  }

  export function disableRemote() {
    remoteSeq += 1
    const pending = !!enabling
    enabling = undefined
    if (!remote) {
      if (pending) void Bus.publish(Event.RemoteStatusChanged, { enabled: false, connected: false })
      return
    }
    remote.sender.dispose()
    remote.conn.close()
    remote = undefined
    log.info("remote connection disabled")
    void Bus.publish(Event.RemoteStatusChanged, { enabled: false, connected: false })
  }

  export function remoteStatus() {
    return {
      enabled: !!remote || !!enabling,
      connected: remote?.conn.connected ?? false,
    }
  }
  export function setViewedSessions(input: { focused: string[]; open?: string[] }) {
    focused.clear()
    opened.clear()
    for (const id of input.focused) {
      focused.add(id)
    }
    for (const id of input.open ?? []) {
      opened.add(id)
    }
    if (remote) void remote.heartbeat().catch((err) => log.warn("heartbeat failed", { error: String(err) }))
  }

  export async function create(sessionId: string) {
    const result = await bootstrap(sessionId)
    if (!result) return { id: "", ingestPath: "" }

    void fullSync(sessionId).catch((error) => log.error("share full sync failed", { sessionId, error }))

    return result
  }

  export async function bootstrap(sessionId: string) {
    if (ingestDisabled) {
      log.info("session bootstrap skipped: ingest disabled", { sessionId })
      return
    }

    const client = await getClient()
    if (!client) {
      log.info("session bootstrap skipped: no client", { sessionId })
      return
    }

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

    log.info("session bootstrap completed", { sessionId })

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

    const session = await Session.get(SessionID.make(sessionId))
    const diffs = await SessionSummary.diff({ sessionID: SessionID.make(sessionId) })
    const messages = await Array.fromAsync(MessageV2.stream(SessionID.make(sessionId)))
    messages.reverse()
    const models = await Promise.all(
      messages
        .filter((m) => m.info.role === "user")
        .map((m) => (m.info as SDK.UserMessage).model)
        .map((m) => Provider.getModel(ProviderID.make(m.providerID), ModelID.make(m.modelID)).then((m) => m)),
    )

    await ingest.sync(sessionId, [
      {
        type: "kilo_meta",
        data: await meta(sessionId),
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
      {
        type: "session_status",
        data: { status: await deriveStatus(sessionId) },
      },
    ])
  }

  /** Normalize a git remote URL: strip credentials, query params, and hash. Returns undefined for unrecognized formats. */
  function normalizeGitUrl(raw: string): string | undefined {
    const ssh = raw.match(/^git@([^:]+):(.+)$/)
    if (ssh) return `git@${ssh[1]}:${ssh[2].split("?")[0]}`
    try {
      const parsed = new URL(raw)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
      parsed.username = ""
      parsed.password = ""
      parsed.search = ""
      parsed.hash = ""
      return parsed.toString()
    } catch {
      return undefined
    }
  }

  async function getGitUrl(): Promise<string | undefined> {
    return withInFlightCache(gitUrlKeyPrefix + Instance.worktree, ttlMs, async () => {
      const repo = simpleGit(Instance.worktree)
      const remotes = await repo.getRemotes(true).catch(() => [])
      if (remotes.length === 0) return undefined

      const names = remotes.map((r) => r.name)
      const remote = names.includes("origin")
        ? "origin"
        : remotes.length === 1
          ? names[0]
          : names.includes("upstream")
            ? "upstream"
            : undefined

      if (!remote) return undefined

      const url = remotes.find((r) => r.name === remote)?.refs.fetch ?? ""
      return url ? normalizeGitUrl(url) : undefined
    })
  }

  async function meta(sessionId?: string) {
    const override = sessionId ? KiloSession.getPlatformOverride(sessionId) : undefined
    const platform = override || process.env["KILO_PLATFORM"] || "cli"
    const orgId = await getOrgId()
    const gitBranch = await Vcs.branch().catch(() => undefined)
    const gitUrl = await getGitUrl().catch(() => undefined)

    return {
      platform,
      ...(orgId ? { orgId } : {}),
      ...(gitUrl ? { gitUrl } : {}),
      ...(gitBranch ? { gitBranch } : {}),
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
