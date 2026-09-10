import type { Context } from "@opencode-ai/plugin/effect/plugin"
import type { RpcCallContext, RpcHandlers } from "@opencode-ai/plugin/effect/rpc"
import { KiloSession } from "@opencode-ai/schema/kilocode/session"
import { Location } from "@opencode-ai/schema/location"
import { Session } from "@opencode-ai/schema/session"
import { SessionMessage } from "@opencode-ai/schema/session-message"
import { SessionTransfer } from "@opencode-ai/schema/session-transfer"
import { Effect, Schema } from "effect"
import { serverUrl, type GatewayOptions } from "./gateway.js"

export interface SessionContext {
  readonly location: Context["location"]
  readonly integration: Pick<Context["integration"], "connection">
  readonly rpc: Pick<Context["rpc"], "register">
  readonly storage: Pick<Context["storage"], "get" | "set">
}

export interface SessionServices {
  readonly import: (input: {
    readonly data: SessionTransfer.Data
    readonly location: Location.Ref
  }) => Effect.Effect<Session.Info, unknown>
}

const Bootstrap = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1)),
  ingestPath: Schema.String.check(Schema.isMinLength(1)),
})
const ShareToken = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/))
const isShareToken = Schema.is(ShareToken)
const ShareResponse = Schema.Struct({ share_token: ShareToken })
const Stored = Schema.Struct({
  id: Schema.String,
  server: Schema.String,
  ingestPath: Schema.String,
  url: Schema.optionalKey(Schema.String),
})
const decodeStored = Schema.decodeUnknownOption(Stored)
// SessionIngestDO.getAllStream wraps stored messages, including self-contained v2 messages.
// Separate legacy parts cannot be discarded without losing transcript content.
const decodeShared = Schema.decodeUnknownEffect(
  Schema.Struct({
    info: Session.Info,
    messages: Schema.Array(Schema.Struct({ info: SessionMessage.Info, parts: Schema.Array(Schema.Never) })),
  }),
)
const encodeTransfer = Schema.encodeSync(SessionTransfer.Data)

const UUID_PATTERN =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

const Selection = Schema.NullOr(Schema.String.check(Schema.isMinLength(1)))
const StoredSelection = Schema.Struct({ organizationID: Selection })
const Metadata = Schema.Struct({
  server: Schema.optional(Schema.String),
  organizationID: Schema.optional(Selection),
})

export interface KiloMetaItem {
  readonly type: "kilo_meta"
  readonly data: {
    readonly platform: string
    readonly orgId?: string
  }
}

export interface SessionItem {
  readonly type: "session"
  readonly data: unknown
}

export interface MessageItem {
  readonly type: "message"
  readonly data: unknown
}

export type IngestBatchItem = KiloMetaItem | SessionItem | MessageItem

export interface KiloMetaInput {
  readonly platform?: string
  readonly orgId?: string | null
}

export function buildIngestBatch(data: SessionTransfer.Data, meta?: KiloMetaInput): IngestBatchItem[] {
  const platform = meta?.platform || process.env.KILO_PLATFORM || "cli"
  const orgId = meta?.orgId ?? undefined
  if (orgId && !isUuid(orgId)) {
    throw new Error("Invalid organization ID: must be a valid UUID")
  }
  const metaItem: KiloMetaItem = {
    type: "kilo_meta",
    data: {
      platform,
      ...(orgId ? { orgId } : {}),
    },
  }
  const encoded = encodeTransfer(data)
  return [
    metaItem,
    { type: "session", data: encoded.info },
    ...encoded.messages.map((message) => ({ type: "message" as const, data: message })),
  ]
}

export type AuthorizeShare = Effect.Effect<void | { readonly organizationID?: string | null }, string>

export const registerSessions = Effect.fn(function* (
  ctx: SessionContext,
  options: GatewayOptions,
  oauthMethodID: string,
  services?: SessionServices,
  authorizeShare?: AuthorizeShare,
) {
  const base = sessionServerUrl(options.sessions)
  const app = shareAppUrl(options.shareApp)
  yield* ctx.rpc.register(KiloSession.Definition, handlers(ctx, base, app, oauthMethodID, services, authorizeShare))
})

function handlers(
  ctx: SessionContext,
  base: string,
  app: string,
  oauthMethodID: string,
  services?: SessionServices,
  authorizeShare?: AuthorizeShare,
) {
  return {
    share: (input, call) =>
      Effect.gen(function* () {
        if (shareDisabled()) return yield* Effect.fail(call.error("kilocode.session", "Session sharing is disabled"))
        if (input.data.info.id !== input.sessionID) {
          return yield* Effect.fail(call.error("kilocode.session", "The session export does not match the session ID"))
        }
        let orgId: string | null | undefined
        if (authorizeShare) {
          const authResult = yield* authorizeShare.pipe(
            Effect.mapError((message) => call.error("kilocode.session", message)),
          )
          if (authResult && "organizationID" in authResult) {
            orgId = authResult.organizationID
          }
        }
        if (orgId === undefined) {
          orgId = yield* resolveHostOrganization(ctx, oauthMethodID).pipe(
            Effect.mapError((message) => call.error("kilocode.session", message)),
          )
        }
        if (orgId) {
          return yield* Effect.fail(
            call.error("kilocode.session", "Team session sharing is not supported in this preview yet"),
          )
        }
        const token = yield* credential(ctx, oauthMethodID).pipe(
          Effect.mapError((message) => call.error("kilocode.session", message)),
        )
        const key = storageKey(input.sessionID)
        const stored = decodeStored(
          yield* ctx.storage
            .get(key)
            .pipe(
              Effect.mapError(() => call.error("kilocode.session_unavailable", "Unable to read Kilo session metadata")),
            ),
        )
        const bootstrap =
          stored._tag === "Some" && stored.value.server === base
            ? stored.value
            : { ...(yield* create(base, token, input.sessionID, call)), server: base }
        yield* upload(base, token, bootstrap.ingestPath, input.data, call, {
          platform: process.env.KILO_PLATFORM ?? "cli",
          orgId,
        })
        const result = yield* post(
          `${base}/api/session/${encodeURIComponent(input.sessionID)}/share`,
          token,
          { sessionId: input.sessionID },
          ShareResponse,
          call,
        )
        const url = `${app}/s/${result.share_token}`
        yield* ctx.storage
          .set(key, { ...bootstrap, url })
          .pipe(
            Effect.mapError(() => call.error("kilocode.session_unavailable", "Unable to save Kilo session metadata")),
          )
        return KiloSession.Share.make({ url })
      }),
    unshare: (input, call) =>
      Effect.gen(function* () {
        const token = yield* credential(ctx, oauthMethodID).pipe(
          Effect.mapError((message) => call.error("kilocode.session", message)),
        )
        yield* postEmpty(
          `${base}/api/session/${encodeURIComponent(input.sessionID)}/unshare`,
          token,
          { sessionId: input.sessionID },
          call,
        )
        const stored = decodeStored(
          yield* ctx.storage
            .get(storageKey(input.sessionID))
            .pipe(
              Effect.mapError(() => call.error("kilocode.session_unavailable", "Unable to read Kilo session metadata")),
            ),
        )
        if (stored._tag === "Some") {
          yield* ctx.storage
            .set(storageKey(input.sessionID), {
              id: stored.value.id,
              server: stored.value.server,
              ingestPath: stored.value.ingestPath,
            })
            .pipe(
              Effect.mapError(() => call.error("kilocode.session_unavailable", "Unable to save Kilo session metadata")),
            )
        }
        return {}
      }),
    fork: (input, call) =>
      Effect.gen(function* () {
        if (!services) {
          return yield* Effect.fail(
            call.error("kilocode.session_unavailable", "This Kilo host cannot import shared sessions"),
          )
        }
        const share = yield* Effect.try({
          try: () => shareToken(input.share, app),
          catch: () => call.error("kilocode.session", "Invalid Kilo share URL or token"),
        })
        const response = yield* request(`${base}/session/${encodeURIComponent(share)}`).pipe(
          Effect.mapError(() => call.error("kilocode.session_unavailable", "Unable to fetch the shared session")),
        )
        if (response.status === 404) {
          return yield* Effect.fail(call.error("kilocode.session", "Shared session not found"))
        }
        if (!response.ok) {
          return yield* Effect.fail(
            call.error("kilocode.session_unavailable", `Unable to fetch the shared session (HTTP ${response.status})`),
          )
        }
        const data = yield* Effect.tryPromise({
          try: () => response.json(),
          catch: () => call.error("kilocode.session_unavailable", "The shared session response was not valid JSON"),
        })
        const source = yield* decodeShared(data).pipe(
          Effect.mapError(() => call.error("kilocode.session", "The shared session is not compatible with Kilo v2")),
        )
        const location = input.location ?? {
          directory: ctx.location.directory,
          ...(ctx.location.workspaceID === undefined ? {} : { workspaceID: ctx.location.workspaceID }),
        }
        return yield* services
          .import({
            data: clone({ info: source.info, messages: source.messages.map((item) => item.info) }, location),
            location,
          })
          .pipe(
            Effect.mapError(() => call.error("kilocode.session_unavailable", "Unable to import the shared session")),
          )
      }),
  } satisfies RpcHandlers<typeof KiloSession.Definition>
}

function create(
  base: string,
  token: string,
  sessionID: string,
  call: RpcCallContext<(typeof KiloSession.Definition.methods)["share"]>,
) {
  return post(`${base}/api/session`, token, { sessionId: sessionID }, Bootstrap, call)
}

function upload(
  base: string,
  token: string,
  ingestPath: string,
  data: SessionTransfer.Data,
  call: RpcCallContext<(typeof KiloSession.Definition.methods)["share"]>,
  meta?: KiloMetaInput,
) {
  return Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => ingestUrl(base, ingestPath),
      catch: () => call.error("kilocode.session_unavailable", "Kilo returned an invalid session ingest path"),
    })
    const batch = yield* Effect.try({
      try: () => buildIngestBatch(data, meta),
      catch: (error) =>
        call.error("kilocode.session", error instanceof Error ? error.message : "Failed to build session ingest batch"),
    })
    yield* postEmpty(url, token, { data: batch }, call)
  })
}

function resolveHostOrganization(ctx: SessionContext, oauthMethodID: string) {
  return Effect.gen(function* () {
    const connection = yield* ctx.integration.connection.active("kilo")
    if (connection?.type !== "credential") return null
    const credential = yield* ctx.integration.connection
      .resolve(connection)
      .pipe(Effect.mapError(() => "Unable to read the active Kilo credential"))
    if (!credential || (credential.type === "oauth" && credential.methodID !== oauthMethodID)) {
      return null
    }
    const rawStored = yield* ctx.storage
      .get(`organization:${connection.id}`)
      .pipe(Effect.mapError(() => "Unable to read the Kilo account selection"))
    const metadata = yield* Schema.decodeUnknownEffect(Metadata)(credential.metadata ?? {}).pipe(
      Effect.mapError(() => "The Kilo credential metadata is invalid"),
    )
    const selected =
      rawStored === undefined
        ? metadata.organizationID
        : (yield* Schema.decodeUnknownEffect(StoredSelection)(rawStored).pipe(
            Effect.mapError(() => "The selected Kilo account is not available"),
          )).organizationID
    if (!selected) {
      return null
    }
    if (!isUuid(selected)) {
      return yield* Effect.fail("The selected Kilo account is not available")
    }
    return selected
  })
}

function post<A, I>(
  url: string,
  token: string,
  body: unknown,
  schema: Schema.Decoder<A, I>,
  call: RpcCallContext<(typeof KiloSession.Definition.methods)[keyof typeof KiloSession.Definition.methods]>,
) {
  return Effect.gen(function* () {
    const response = yield* request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).pipe(Effect.mapError(() => call.error("kilocode.session_unavailable", "Kilo session request failed")))
    if (!response.ok) {
      return yield* Effect.fail(
        call.error("kilocode.session_unavailable", `Kilo session request failed (HTTP ${response.status})`),
      )
    }
    const data = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: () => call.error("kilocode.session_unavailable", "Kilo returned an invalid session response"),
    })
    return yield* Schema.decodeUnknownEffect(schema)(data).pipe(
      Effect.mapError(() => call.error("kilocode.session_unavailable", "Kilo returned an invalid session response")),
    )
  })
}

function postEmpty(
  url: string,
  token: string,
  body: unknown,
  call: RpcCallContext<(typeof KiloSession.Definition.methods)[keyof typeof KiloSession.Definition.methods]>,
) {
  return Effect.gen(function* () {
    const response = yield* request(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).pipe(Effect.mapError(() => call.error("kilocode.session_unavailable", "Kilo session request failed")))
    if (!response.ok) {
      return yield* Effect.fail(
        call.error("kilocode.session_unavailable", `Kilo session request failed (HTTP ${response.status})`),
      )
    }
    return yield* Effect.void
  })
}

function request(url: string, init?: RequestInit) {
  return Effect.tryPromise({
    try: (signal) => fetch(url, { ...init, signal, redirect: "error" }),
    catch: () => new Error("Kilo session request failed"),
  })
}

function credential(ctx: SessionContext, oauthMethodID: string) {
  return Effect.gen(function* () {
    const connection = yield* ctx.integration.connection.active("kilo")
    if (connection?.type !== "credential") return yield* Effect.fail("Sign in with Kilo before sharing a session")
    const value = yield* ctx.integration.connection
      .resolve(connection)
      .pipe(Effect.mapError(() => "Unable to read the active Kilo credential"))
    if (!value) return yield* Effect.fail("Unable to read the active Kilo credential")
    if (value.type === "oauth" && value.methodID !== oauthMethodID) {
      return yield* Effect.fail("The active Kilo credential uses an unsupported sign-in method")
    }
    return value.type === "oauth" ? value.access : value.key
  })
}

function sessionServerUrl(input?: string) {
  return serverUrl(input ?? process.env.KILO_SESSION_INGEST_URL ?? "https://ingest.kilosessions.ai")
}

function shareAppUrl(input?: string) {
  return serverUrl(input ?? "https://app.kilo.ai")
}

function ingestUrl(base: string, ingestPath: string) {
  if (!ingestPath.startsWith("/") || ingestPath.startsWith("//")) throw new Error("Invalid ingest path")
  const url = new URL(base + ingestPath)
  if (url.origin !== new URL(base).origin || url.search || url.hash) throw new Error("Invalid ingest path")
  url.searchParams.set("v", "2")
  return url.href
}

function shareToken(input: string, app: string) {
  const value = input.trim()
  const url = URL.parse(value)
  if (!url) {
    if (isShareToken(value)) return value
    throw new Error("Invalid share token")
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  ) {
    throw new Error("Invalid share URL")
  }
  const base = new URL(app)
  const prefix = `${base.pathname.replace(/\/$/, "")}/s/`
  const token = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : ""
  if (url.origin !== base.origin || !isShareToken(token) || url.search || url.hash) {
    throw new Error("Invalid share URL")
  }
  return token
}

function clone(data: SessionTransfer.Data, location: Location.Ref) {
  return SessionTransfer.Data.make({
    info: Session.Info.make({
      ...data.info,
      id: Session.ID.create(),
      parentID: undefined,
      fork: undefined,
      revert: undefined,
      location,
    }),
    // Public exports contain no snapshot trees to restore in the destination repository.
    messages: data.messages.map((message) =>
      SessionMessage.Info.make({
        ...message,
        id: SessionMessage.ID.create(),
        ...(message.type === "assistant" ? { snapshot: undefined } : {}),
      }),
    ),
  })
}

function shareDisabled() {
  return (
    ["1", "true"].includes(process.env.KILO_DISABLE_SHARE ?? "") ||
    ["1", "true"].includes(process.env.KILO_DISABLE_SESSION_INGEST ?? "")
  )
}

function storageKey(sessionID: string) {
  return `session:${sessionID}`
}
