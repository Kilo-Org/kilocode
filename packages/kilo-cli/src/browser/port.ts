// The extension backend's connection to the browser hub, as the tool plugin sees it: session bookkeeping, tool calls
// and uploads. The transport's JSON-RPC codes never leave this module, which is why the port is semantic.
import { BrowserHub } from "@kilocode/kilo-plugin/browser/hub"
import { OPENCODE_VERSION } from "@opencode/cli/version"
import z from "zod"
import type { Client, Input } from "./client"

/**
 * A tool call can wait inside the extension (a tab lease, a navigation, an explicit wait), so the transport's own
 * request timeout is too short for it.
 */
const CALL_TIMEOUT = 180_000

export type Options = Input & {
  /** The CLI version the extension records with the session. */
  version?: string
  /** The native-messaging installer; a test replaces it so we never write into the developer's browser profiles. */
  install?: () => Promise<unknown>
  /** The hub transport factory; a test replaces it to exercise a client that cannot be created at all. */
  create?: (input: Input) => Client
}

const Need = z
  .object({
    class: z.string(),
    origin: z.string(),
    frame: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .loose()

/** The fields an extension error or a result's `_meta` carries beyond its message. */
const Payload = z
  .object({
    items: z.array(Need).optional(),
    stepToken: z.string().optional(),
    // The action already ran; the CLI asks for the grant and never repeats it.
    afterAction: z.boolean().optional(),
    // `origin_changed` names the origins a redirect moved between.
    from: z.string().optional(),
    to: z.string().optional(),
    url: z.string().optional(),
    origin: z.string().optional(),
    withheldFrames: z.array(z.string()).optional(),
    needs: z.array(Need).optional(),
  })
  .loose()

/** The origin a redirect landed on, when it named one the CLI can grant. */
function landed(value: string | undefined) {
  if (value === undefined) return undefined
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : undefined
  } catch {
    return undefined
  }
}

type Payload = z.infer<typeof Payload>

/** A hub error, read structurally: a malformed frame is not an error object and never becomes one. */
function hubFailure(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined
  const value = error as { kind?: unknown; code?: unknown; message?: unknown; data?: unknown; uncertain?: unknown }
  if (typeof value.kind !== "string" || typeof value.code !== "number") return undefined
  return {
    kind: value.kind,
    message: typeof value.message === "string" ? value.message : "",
    data: Payload.safeParse(value.data).data,
    uncertain: value.uncertain === true,
  }
}

/** One transport failure as the backend reads it. A kind the CLI does not know stays `unknown` and is refused. */
export function failure(error: unknown): BrowserHub.Failure {
  const value = hubFailure(error)
  if (!value) {
    const message = error instanceof Error ? error.message : String(error)
    return new BrowserHub.Failure({ kind: "unknown", message })
  }
  const data = value.data
  const base = { message: value.message, items: data?.items, stepToken: data?.stepToken }
  const meta = (payload: Payload): BrowserHub.Meta => ({
    ...(payload.url === undefined ? {} : { url: payload.url }),
    ...(payload.origin === undefined ? {} : { origin: payload.origin }),
    ...(payload.withheldFrames === undefined ? {} : { withheldFrames: payload.withheldFrames }),
    ...(payload.needs === undefined ? {} : { needs: payload.needs }),
  })
  switch (value.kind) {
    case "browser_unavailable":
      return new BrowserHub.Failure({ kind: "unavailable", message: value.message, uncertain: value.uncertain })
    case "tab_busy":
      return new BrowserHub.Failure({ kind: "busy", message: value.message })
    case "tab_taken":
      return new BrowserHub.Failure({ kind: "taken", message: value.message })
    case "user_stopped":
      return new BrowserHub.Failure({ kind: "stopped", message: value.message })
    case "unsupported_in_browser":
      return new BrowserHub.Failure({ kind: "unsupported", message: value.message })
    case "blocked":
      return new BrowserHub.Failure({ kind: "blocked", message: value.message })
    case "protocol_mismatch":
      return new BrowserHub.Failure({ kind: "mismatch", message: value.message })
    case "origin_changed": {
      // A redirect landed on a new origin: ask to read it, so the retry is not the same navigation again.
      const to = landed(data?.to)
      return new BrowserHub.Failure({ kind: "moved", ...base, ...(to ? { items: [{ class: "read", origin: to }] } : {}) })
    }
    case "needs_permission":
      return new BrowserHub.Failure({
        kind: "permission",
        ...base,
        afterAction: data?.afterAction === true,
        uncertain: value.uncertain,
        ...(data === undefined ? {} : { meta: meta(data) }),
      })
    default:
      return new BrowserHub.Failure({ kind: "unknown", message: value.message })
  }
}

/** The result as the tool layer reads it. Audio and resource blocks are not part of the browser tool contract. */
function reply(value: { content: readonly unknown[]; isError?: boolean; _meta?: Payload }): BrowserHub.Reply {
  const content: BrowserHub.Block[] = []
  for (const block of value.content) {
    if (typeof block !== "object" || block === null) continue
    const entry = block as { type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown }
    if (entry.type === "text" && typeof entry.text === "string") content.push({ type: "text", text: entry.text })
    if (entry.type === "image" && typeof entry.data === "string" && typeof entry.mimeType === "string")
      content.push({ type: "image", data: entry.data, mimeType: entry.mimeType })
  }
  const meta = value._meta
  return {
    content,
    isError: value.isError === true,
    ...(meta === undefined
      ? {}
      : {
          meta: {
            ...(meta.url === undefined ? {} : { url: meta.url }),
            ...(meta.origin === undefined ? {} : { origin: meta.origin }),
            ...(meta.withheldFrames === undefined ? {} : { withheldFrames: meta.withheldFrames }),
            ...(meta.effectsUncertain === true ? { effectsUncertain: true as const } : {}),
            ...(meta.needs === undefined ? {} : { needs: meta.needs }),
          },
        }),
  }
}

/** The hub interface the host provides: one client per profile target, created on the first use of that target. */
export function hub(options: Options = {}): BrowserHub.Interface {
  const { install, create: factory, version, ...input } = options
  const clients = new Map<string, Promise<Client>>()
  const client = (target: string | null) => {
    const key = target ?? ""
    const existing = clients.get(key)
    if (existing) return existing
    const created = (async () => {
      // The hub transport and the installer stay out of the server's module graph: a process that never uses the
      // extension backend (every Playwright user) must not pay their load cost at startup, and a static import
      // cannot express that.
      const { create } = await import("./client")
      // Installation is idempotent and belongs to the extension backend's first use: a Playwright user never gets a
      // native messaging host it does not need.
      const installer = install ?? (async () => (await import("./install")).install())
      await installer().catch(() => undefined)
      return (factory ?? create)({ ...input, ...(key ? { profile: key } : {}) })
    })()
    clients.set(key, created)
    // A transport that could not be created is not a fact: the next call tries again.
    created.catch(() => {
      if (clients.get(key) === created) clients.delete(key)
    })
    return created
  }
  return {
    port(target) {
      // Loading the transport can fail too, and a raw loader error must not escape the backend's error contract.
      const connection = () => client(target ?? null).catch((error: unknown) => Promise.reject(failure(error)))
      return {
        async ready(timeoutMs) {
          const info = await (await connection())
            .ready(timeoutMs)
            .catch((error: unknown) => {
              throw failure(error)
            })
          return {
            protocol: info.protocol,
            contractSha: info.contractSha,
            extensionVersion: info.extensionVersion,
            profileLabel: info.profileLabel,
          }
        },
        async open(params) {
          return (await connection()).session.open({ ...params, cliVersion: version ?? OPENCODE_VERSION }).catch(
            (error: unknown) => {
              throw failure(error)
            },
          )
        },
        async close(sessionHandle) {
          await (await connection()).session.close({ sessionHandle }).catch((error: unknown) => {
            throw failure(error)
          })
        },
        async list() {
          const listed = await (await connection()).tools.list().catch((error: unknown) => {
            throw failure(error)
          })
          return listed.tools.map((tool) => tool.name)
        },
        async reported() {
          // No client yet means nothing is connected; asking here must not start a hub.
          const created = clients.get(target ?? "")
          if (created === undefined) return undefined
          const client = await created.catch(() => undefined)
          if (client === undefined) return undefined
          const state = client.state()
          if (state.kind !== "ready") return undefined
          return {
            protocol: state.extension.protocol,
            contractSha: state.extension.contractSha,
            extensionVersion: state.extension.extensionVersion,
            profileLabel: state.extension.profileLabel,
          }
        },
        async call(params) {
          try {
            const answer = await (await connection()).tools.call(
              {
                sessionHandle: params.sessionHandle,
                name: params.name,
                arguments: params.arguments,
                authorized: params.authorized.map((pair) => ({ class: pair.class, origin: pair.origin })),
                ...(params.sensitive === undefined ? {} : { sensitive: [...params.sensitive] }),
              },
              { timeout: CALL_TIMEOUT, ...(params.signal === undefined ? {} : { signal: params.signal }) },
            )
            return reply(answer)
          } catch (error) {
            throw failure(error)
          }
        },
        async begin(params) {
          await (await connection()).upload.begin(params).catch((error: unknown) => {
            throw failure(error)
          })
        },
        async chunk(params) {
          await (await connection()).upload.chunk(params).catch((error: unknown) => {
            throw failure(error)
          })
        },
        async end(uploadId) {
          await (await connection()).upload.end({ uploadId }).catch((error: unknown) => {
            throw failure(error)
          })
        },
        onRevoked(listener) {
          let off: (() => void) | undefined
          let live = true
          void connection().then((client) => {
            const stop = client.on("session.revoked", (params) => listener(params))
            if (!live) return stop()
            off = stop
          })
          return () => {
            live = false
            off?.()
          }
        },
      }
    },
  }
}
